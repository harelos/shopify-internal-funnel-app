#!/usr/bin/env python3
"""Create idempotent, unpaid CJ rescue orders for a frozen NovaHair batch.

The command is a dry run unless --apply is supplied. It never confirms, pays,
deletes, or fulfills an order and never prints recipient data.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cj_auth import cj_request as _cj_request  # noqa: E402
from cj_auth import get_token, request_json  # noqa: E402
from novahair_manifest import (  # noqa: E402
    BUNDLE_SKU_RE as SKU_RE,
    COMPONENTS,
    GIFT,
    actual_products,
    expected_products,
)


APP_DIR = Path(__file__).resolve().parent
ENV_PATH = APP_DIR / ".env"
AUDIT_PATH = APP_DIR / "cj_rescue_batch_2026-08-31.json"
SUPPLEMENT_PATH = APP_DIR / "recipient_supplement.json"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SHOP_DOMAIN_DEFAULT = "jacobfelipe.myshopify.com"
SHOPIFY_API_VERSION = "2024-10"
# 4358 was found by find_unrescued_orders.py on 2026-08-31: paid 2026-08-21 and
# left unfulfilled with no rescue, outside the original frozen range.
TARGET_ORDER_NUMBERS = {4358, 4378, 4379, 4380, 4381, 4382, 4383}
# --auto replaces the frozen batch with discovery of every eligible NovaHair
# order. run() sets this before any validation happens, so validate_order stays
# the single authority on what may be pushed.
ACTIVE_TARGETS: set[int] = set(TARGET_ORDER_NUMBERS)
LOGISTIC_NAME = "CJPacket YP Special Line"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(ENV_PATH)
CJ_API_KEY = os.getenv("CJ_API_KEY")
# Prefer the Partner Dashboard app token: a store-admin custom app cannot read
# customer name/address/phone on a Basic plan, so without this every order
# falls back to CJ's imported copy and a placeholder postcode.
SHOPIFY_TOKEN = os.getenv("SHOPIFY_PII_TOKEN") or os.getenv("SHOPIFY_ACCESS_TOKEN")
SHOPIFY_DOMAIN = os.getenv("SHOPIFY_SHOP_DOMAIN", SHOP_DOMAIN_DEFAULT)
if not CJ_API_KEY or not SHOPIFY_TOKEN:
    raise SystemExit("Missing CJ_API_KEY or SHOPIFY_ACCESS_TOKEN in app/.env")


# TLS verification and token caching now live in cj_auth. This module previously
# used its own ssl.CERT_NONE context, which disabled certificate verification on
# every call; cj_auth verifies against certifi instead.
def cj_token() -> str:
    return get_token()


def cj_request(token: str, method: str, endpoint: str, payload: Any | None = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
    return _cj_request(method, endpoint, payload=payload, params=params, token=token)


def shopify_orders() -> list[dict[str, Any]]:
    url = f"https://{SHOPIFY_DOMAIN}/admin/api/{SHOPIFY_API_VERSION}/orders.json?status=any&limit=250"
    response = request_json("GET", url, {"X-Shopify-Access-Token": SHOPIFY_TOKEN})
    return response.get("orders") or []


def existing_cj_orders(token: str) -> dict[str, list[dict[str, Any]]]:
    by_number: dict[str, list[dict[str, Any]]] = {}
    for page in range(1, 8):
        response = cj_request(token, "GET", "shopping/order/list", params={"pageNum": page, "pageSize": 100})
        data = response.get("data") or {}
        rows = data.get("content") or data.get("list") or data.get("data") or []
        if isinstance(data, list):
            rows = data
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            number = str(row.get("orderNum") or row.get("orderNumber") or "").strip()
            # CJ soft-deletes: a deleted order stays in the list as TRASH. Counting
            # it as an existing rescue would permanently block a legitimate retry.
            if number and str(row.get("orderStatus") or "").upper() != "TRASH":
                by_number.setdefault(number, []).append(row)
        if len(rows) < 100:
            break
    return by_number


def cj_variant_catalog(token: str) -> dict[str, dict[str, Any]]:
    catalog: dict[str, dict[str, Any]] = {}
    for pid in ("2412030839551623800", "9DFCE47E-7533-4C5A-AE61-B653745D643D"):
        response = cj_request(token, "GET", "product/query", params={"pid": pid})
        for variant in ((response.get("data") or {}).get("variants") or []):
            vid = str(variant.get("vid") or "")
            if vid:
                catalog[vid] = variant
    return catalog


def cj_variant_by_vid(token: str, vid: str) -> dict[str, Any]:
    response = cj_request(token, "GET", "product/variant/queryByVid", params={"vid": vid})
    variant = response.get("data") or {}
    if not response.get("result") or str(variant.get("vid") or "") != vid:
        raise DataGapError(f"CJ variant lookup failed for {vid}")
    return variant


def normalize_phone(value: str) -> str:
    raw = re.sub(r"[^0-9+]", "", value or "")
    if raw.startswith("00972"):
        raw = "+972" + raw[5:]
    elif raw.startswith("972"):
        raw = "+" + raw
    if raw.startswith("+9720"):
        raw = "+972" + raw[5:]
    return raw


def parse_composition(order: dict[str, Any]) -> tuple[str, dict[str, int], int]:
    matching = [line for line in (order.get("line_items") or []) if str(line.get("sku") or "").startswith("NOVASALE-")]
    if len(matching) != 1:
        raise DataGapError("Expected exactly one NovaHair bundle line")
    line = matching[0]
    sku = str(line.get("sku") or "")
    match = SKU_RE.fullmatch(sku)
    if not match:
        raise DataGapError(f"Unsupported bundle SKU {sku}")
    bundle_size, *counts = (int(value) for value in match.groups())
    if sum(counts) != bundle_size:
        raise DataGapError("Shade quantities do not equal bundle size")
    bundle_quantity = int(line.get("quantity") or 0)
    if bundle_quantity < 1:
        raise DataGapError("Bundle quantity must be positive")
    composition = {name: count * bundle_quantity for (name, _, _), count in zip(COMPONENTS, counts) if count}
    composition[GIFT[0]] = bundle_quantity
    return sku, composition, bundle_size * bundle_quantity


def validate_order(order: dict[str, Any]) -> tuple[str, dict[str, int], int]:
    number = int(order.get("order_number") or 0)
    if number not in ACTIVE_TARGETS:
        raise DataGapError("Order is outside the active batch")
    if order.get("financial_status") != "paid":
        raise DataGapError("Shopify order is not paid")
    if order.get("cancelled_at"):
        raise DataGapError("Shopify order is cancelled")
    if order.get("fulfillment_status") not in (None, "partial"):
        raise DataGapError("Shopify order is already fulfilled")
    tags = {tag.strip().upper() for tag in str(order.get("tags") or "").split(",") if tag.strip()}
    if tags.intersection({"INTERNAL", "TEST", "CANARY", "DO_NOT_FULFILL"}):
        raise DataGapError("Order is excluded by safety tag")
    return parse_composition(order)


def build_products(composition: dict[str, int], catalog: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    products = []
    for name, vid, expected_sku in (*COMPONENTS, GIFT):
        quantity = composition.get(name, 0)
        if not quantity:
            continue
        variant = catalog.get(vid) or {}
        actual_sku = str(variant.get("variantSku") or "")
        if actual_sku != expected_sku:
            raise DataGapError(f"CJ mapping mismatch for {name}")
        price = variant.get("variantSellPrice")
        if price is None:
            raise DataGapError(f"CJ price missing for {name}")
        products.append({"vid": vid, "quantity": quantity, "unitPrice": float(price)})
    return products


def build_manifest_products(
    token: str,
    manifest_items: list[dict[str, Any]],
    catalog: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Validate and price every expected physical line for createOrderV2."""
    products: list[dict[str, Any]] = []
    for item in manifest_items:
        vid = str(item.get("vid") or "")
        expected_sku = str(item.get("sku") or "")
        quantity = int(item.get("quantity") or 0)
        if not vid or not expected_sku or quantity < 1:
            raise DataGapError("Manifest contains an invalid physical item")

        variant = catalog.get(vid)
        if not variant:
            variant = cj_variant_by_vid(token, vid)
            catalog[vid] = variant
        actual_sku = str(variant.get("variantSku") or "")
        if actual_sku != expected_sku:
            raise DataGapError(f"CJ mapping mismatch for {item.get('key') or vid}")
        price = variant.get("variantSellPrice")
        if price is None:
            raise DataGapError(f"CJ price missing for {item.get('key') or vid}")

        product: dict[str, Any] = {
            "vid": vid,
            "quantity": quantity,
            "unitPrice": float(price),
        }
        store_line_item_id = str(item.get("store_line_item_id") or "").strip()
        if store_line_item_id:
            product["storeLineItemId"] = store_line_item_id
        products.append(product)
    return products


def recipient_from_shopify(order: dict[str, Any]) -> dict[str, str] | None:
    address = order.get("shipping_address") or {}
    recipient = {
        "name": str(address.get("name") or "").strip(),
        "address": " ".join(part.strip() for part in (address.get("address1") or "", address.get("address2") or "") if part.strip()),
        "city": str(address.get("city") or "").strip(),
        "province": str(address.get("province") or address.get("province_code") or address.get("city") or "").strip(),
        "zip": str(address.get("zip") or "").strip(),
        "phone": normalize_phone(str(address.get("phone") or order.get("phone") or "")),
        "email": str(order.get("email") or "").strip(),
    }
    return recipient if all(recipient[key] for key in ("name", "address", "city", "phone")) else None


def recipient_from_cj(token: str, original_rows: list[dict[str, Any]]) -> dict[str, str]:
    if len(original_rows) != 1:
        raise DataGapError("Expected exactly one original CJ import for recipient recovery")
    row = original_rows[0]
    order_id = str(row.get("orderId") or "")
    detail = detail_for(token, order_id) if order_id else {}

    def first(*keys: str) -> str:
        for source in (detail, row):
            for key in keys:
                value = str(source.get(key) or "").strip()
                if value:
                    return value
        return ""

    recipient = {
        "name": first("shippingCustomerName", "customerName"),
        "address": first("shippingAddress", "address"),
        "city": first("shippingCity", "city"),
        "province": first("shippingProvince", "province") or first("shippingCity", "city"),
        "zip": first("shippingZip", "shippingZipCode", "zipCode", "zip"),
        "phone": normalize_phone(first("shippingPhone", "phone")),
        "email": first("email", "shippingEmail", "customerEmail"),
    }
    missing = [key for key in ("name", "address", "city", "phone") if not recipient[key]]
    if missing:
        raise DataGapError("Original CJ import is missing recipient fields: " + ", ".join(missing))
    return recipient


class DataGapError(ValueError):
    """Missing/unusable input data found BEFORE any CJ write.

    Safe to skip and continue to the next order: nothing was sent to CJ, so the
    batch is still in a known state. Distinct from a failure during or after
    createOrderV2, which halts the batch because CJ's state is then uncertain.
    """


def load_supplement() -> dict[str, Any]:
    """Postcode/email that no API on this store's plan will return.

    Shopify strips zip and email from every Admin API surface below the Shopify
    plan, and CJ's getOrderDetail does not carry them either, so CJ's Israel
    validation (sub-codes 4001/3001) can only be satisfied from this file.
    """
    if not SUPPLEMENT_PATH.exists():
        return {}
    try:
        return json.loads(SUPPLEMENT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{SUPPLEMENT_PATH.name} is not valid JSON: {exc}")


def apply_supplement(recipient: dict[str, str], number: int, supplement: dict[str, Any]) -> dict[str, str]:
    entry = ((supplement.get("orders") or {}).get(str(number))) or {}
    zip_code = str(entry.get("zip") or recipient.get("zip") or "").strip()
    email = str(entry.get("email") or recipient.get("email") or supplement.get("default_email") or "").strip()

    # A per-order postcode is always preferred. default_zip is an explicit merchant
    # opt-in placeholder: Israeli last-mile couriers route on street/city and phone
    # the recipient, so a placeholder is tolerable here, but it is recorded in the
    # audit as placeholder_zip=True rather than passed off as real data.
    placeholder = False
    if not zip_code and supplement.get("default_zip"):
        zip_code = str(supplement["default_zip"]).strip()
        placeholder = True

    if not zip_code:
        raise DataGapError(
            f"Postcode missing for #{number}. Add it to {SUPPLEMENT_PATH.name} "
            "(copy from Shopify admin; the API cannot return it on this plan)."
        )
    if not re.fullmatch(r"[0-9 \-]{4,12}", zip_code):
        raise DataGapError(f"Postcode for #{number} must be digits, spaces or hyphens only (CJ rule 4001)")
    if not EMAIL_RE.fullmatch(email) or email.startswith("REPLACE_WITH"):
        raise DataGapError(
            f"Valid email missing for #{number}. Set default_email in {SUPPLEMENT_PATH.name} (CJ rule 3001)."
        )

    # A street address cannot be placeholdered the way a postcode can - a parcel
    # with no real street line simply cannot be delivered. CJ's own stored address
    # is sometimes just a house number (rule 10002), so gate on it explicitly and
    # let the merchant supply the real line from the Shopify admin.
    address = str(entry.get("address") or recipient.get("address") or "").strip()
    if not address:
        raise DataGapError(f"Address missing for #{number}")
    if re.fullmatch(r"[0-9\s\-]+", address):
        raise DataGapError(
            f"Address for #{number} is digits only ({len(address)} chars) and cannot be delivered. "
            f"Copy the real street line from Shopify admin into orders.{number}.address "
            f"in {SUPPLEMENT_PATH.name}."
        )
    if len(address) < 5 and not entry.get("address_confirmed"):
        raise DataGapError(
            f"Address for #{number} is only {len(address)} chars, too short to be a real street line. "
            f"Set orders.{number}.address in {SUPPLEMENT_PATH.name} to override, or "
            f"orders.{number}.address_confirmed=true if it really is correct."
        )

    merged = dict(recipient)
    merged["address"] = address
    if entry.get("city"):
        merged["city"] = str(entry["city"]).strip()
    merged["zip"] = zip_code
    merged["email"] = email
    merged["_placeholder_zip"] = "yes" if placeholder else "no"
    merged["_address_source"] = "supplement" if entry.get("address") else "cj_import"
    return merged


def create_payload(order: dict[str, Any], recipient: dict[str, str], products: list[dict[str, Any]]) -> dict[str, Any]:
    number = int(order["order_number"])
    payload = {
        "orderNumber": f"RESCUE-{number}",
        "shippingCustomerName": recipient["name"],
        "shippingCountry": "Israel",
        "shippingCountryCode": "IL",
        "shippingProvince": recipient["province"],
        "shippingCity": recipient["city"],
        "shippingAddress": recipient["address"],
        "shippingPhone": recipient["phone"],
        "logisticName": LOGISTIC_NAME,
        "fromCountryCode": "CN",
        "payType": 3,
        "products": products,
        "remark": f"Manual NovaHair rescue for Shopify order #{number}; exact shade variants plus free kit.",
    }
    if recipient.get("zip"):
        payload["shippingZip"] = recipient["zip"]
    if recipient.get("email"):
        payload["email"] = recipient["email"]
    return payload


def detail_for(token: str, order_id: str) -> dict[str, Any]:
    response = cj_request(token, "GET", "shopping/order/getOrderDetail", params={"orderId": order_id})
    return response.get("data") or {}


def audit_row(order: dict[str, Any], sku: str, composition: dict[str, int], action: str, **extra: Any) -> dict[str, Any]:
    row = {
        "shopify_order": f"#{order['order_number']}",
        "shopify_order_id": str(order["id"]),
        "sku": sku,
        "composition": composition,
        "action": action,
    }
    row.update(extra)
    return row


def create_one(
    token: str,
    order: dict[str, Any],
    sku: str,
    composition: dict[str, int],
    catalog: dict[str, dict[str, Any]],
    supplement: dict[str, Any],
    bottle_count: int,
    existing: dict[str, list[dict[str, Any]]],
    manifest_items: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Create and verify one unpaid CJ order. Mirrors the audited path in run().

    Raises on any verification failure so the caller can stop the batch: after a
    failed create/verify, CJ state is uncertain and must not be retried blindly.
    """
    number = int(order.get("order_number") or 0)
    rescue_number = f"RESCUE-{number}"

    original_rows = existing.get(f"#{number}") or []
    recipient = recipient_from_shopify(order) or recipient_from_cj(token, original_rows)
    recipient = apply_supplement(recipient, number, supplement)

    products = (
        build_manifest_products(token, manifest_items, catalog)
        if manifest_items is not None
        else build_products(composition, catalog)
    )
    bottle_vids = {vid for _, vid, _ in COMPONENTS}
    if sum(item["quantity"] for item in products if item["vid"] in bottle_vids) != bottle_count:
        raise ValueError("CJ bottle quantities do not reconcile")

    response = cj_request(
        token, "POST", "shopping/order/createOrderV2",
        payload=create_payload(order, recipient, products),
    )
    data = response.get("data") or {}
    cj_order_id = str(data.get("orderId") or "")
    if not response.get("result") or not cj_order_id:
        # The request may have committed despite an uncertain response.
        refreshed = existing_cj_orders(token).get(rescue_number) or []
        if len(refreshed) == 1:
            cj_order_id = str(refreshed[0].get("orderId") or "")
        else:
            raise ValueError(f"CJ create failed: {response.get('code')} {response.get('message')}")

    detail = detail_for(token, cj_order_id)
    if str(detail.get("orderNum") or "") != rescue_number:
        raise ValueError("CJ verification returned the wrong order number")
    actual = actual_products(detail.get("productList") or [])
    expected = expected_products(products)
    if actual != expected or int(detail.get("isComplete") or 0) != 1:
        raise ValueError("CJ product verification failed")

    return {
        "action": "CREATED_ORDER_PICKING",
        "cj_order_id": cj_order_id,
        "cj_status": detail.get("orderStatus"),
        "is_complete": detail.get("isComplete"),
        "placeholder_zip": recipient.get("_placeholder_zip"),
    }


def discover_targets(
    orders: dict[int, dict[str, Any]], existing: dict[str, list[dict[str, Any]]], limit: int
) -> tuple[set[int], list[dict[str, Any]]]:
    """Pick every NovaHair order that still needs a CJ order.

    Eligibility is deliberately conservative: a bundle SKU must be present, and
    anything already carrying a live RESCUE-* order is skipped so a rerun can
    never double-ship. validate_order re-checks paid/open/unfulfilled after this.
    """
    picked: set[int] = set()
    skipped: list[dict[str, Any]] = []
    for number, order in sorted(orders.items()):
        skus = [str(li.get("sku") or "") for li in (order.get("line_items") or [])]
        if not any(SKU_RE.match(sku) for sku in skus):
            continue
        if existing.get(f"RESCUE-{number}"):
            continue
        if order.get("financial_status") != "paid" or order.get("cancelled_at"):
            skipped.append({"shopify_order": f"#{number}", "action": "SKIPPED", "reason": "NOT_PAID_OR_CANCELLED"})
            continue
        if order.get("fulfillment_status") not in (None, "partial"):
            continue
        picked.add(number)
    if len(picked) > limit:
        dropped = sorted(picked)[limit:]
        picked = set(sorted(picked)[:limit])
        skipped.append({"action": "DEFERRED_BY_LIMIT", "orders": [f"#{n}" for n in dropped], "limit": limit})
    return picked, skipped


def run(apply: bool, auto: bool = False, limit: int = 25) -> int:
    token = cj_token()
    supplement = load_supplement()
    existing = existing_cj_orders(token)
    catalog = cj_variant_catalog(token)
    orders = {int(order.get("order_number") or 0): order for order in shopify_orders()}
    audit: list[dict[str, Any]] = []

    global ACTIVE_TARGETS
    if auto:
        ACTIVE_TARGETS, deferred = discover_targets(orders, existing, limit)
        audit.extend(deferred)
        print(
            f"# auto mode: {len(ACTIVE_TARGETS)} order(s) need a CJ order: "
            + (", ".join(f"#{n}" for n in sorted(ACTIVE_TARGETS)) or "none"),
            file=sys.stderr,
        )
    else:
        ACTIVE_TARGETS = set(TARGET_ORDER_NUMBERS)

    for number in sorted(ACTIVE_TARGETS):
        order = orders.get(number)
        if not order:
            audit.append({"shopify_order": f"#{number}", "action": "BLOCKED", "reason": "SHOPIFY_ORDER_NOT_FOUND"})
            continue
        try:
            sku, composition, bottle_count = validate_order(order)
            rescue_number = f"RESCUE-{number}"
            duplicates = existing.get(rescue_number) or []
            if len(duplicates) > 1:
                raise ValueError("Multiple existing CJ rescue orders")
            if duplicates:
                existing_id = str(duplicates[0].get("orderId") or "")
                detail = detail_for(token, existing_id) if existing_id else duplicates[0]
                audit.append(audit_row(order, sku, composition, "SKIPPED_EXISTING", cj_order_id=existing_id, cj_status=detail.get("orderStatus")))
                continue
            original_rows = existing.get(f"#{number}") or []
            recipient = recipient_from_shopify(order) or recipient_from_cj(token, original_rows)
            # Validated in the dry run too, so a missing postcode fails before any write.
            recipient = apply_supplement(recipient, number, supplement)
            products = build_products(composition, catalog)
            if sum(item["quantity"] for item in products if item["vid"] != GIFT[1]) != bottle_count:
                raise ValueError("CJ bottle quantities do not reconcile")
            if not apply:
                audit.append(
                    audit_row(
                        order, sku, composition, "DRY_RUN_WOULD_CREATE",
                        placeholder_zip=recipient.get("_placeholder_zip"),
                    )
                )
                continue
            response = cj_request(token, "POST", "shopping/order/createOrderV2", payload=create_payload(order, recipient, products))
            data = response.get("data") or {}
            cj_order_id = str(data.get("orderId") or "")
            if not response.get("result") or not cj_order_id:
                # The request may have committed despite an uncertain response. Re-list before allowing a retry.
                refreshed = existing_cj_orders(token).get(rescue_number) or []
                if len(refreshed) == 1:
                    cj_order_id = str(refreshed[0].get("orderId") or "")
                else:
                    raise ValueError(f"CJ create failed: {response.get('code')} {response.get('message')}")
            detail = detail_for(token, cj_order_id)
            if str(detail.get("orderNum") or "") != rescue_number:
                raise ValueError("CJ verification returned the wrong order number")
            actual = {str(item.get("vid")): int(item.get("quantity") or 0) for item in (detail.get("productList") or [])}
            expected = {str(item["vid"]): int(item["quantity"]) for item in products}
            if actual != expected or int(detail.get("isComplete") or 0) != 1:
                raise ValueError("CJ product verification failed")
            audit.append(
                audit_row(
                    order,
                    sku,
                    composition,
                    "CREATED_ORDER_PICKING",
                    cj_order_id=cj_order_id,
                    cj_status=detail.get("orderStatus"),
                    is_complete=detail.get("isComplete"),
                    placeholder_zip=recipient.get("_placeholder_zip"),
                )
            )
        except DataGapError as exc:
            # Nothing was sent to CJ; record and keep going.
            audit.append({"shopify_order": f"#{number}", "action": "BLOCKED", "reason": str(exc)})
        except Exception as exc:
            # CJ state is uncertain after a create/verify failure. Stop the batch.
            audit.append({"shopify_order": f"#{number}", "action": "BLOCKED", "reason": str(exc)})
            if apply:
                break

    AUDIT_PATH.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(audit, ensure_ascii=False, indent=2))
    return 1 if any(row.get("action") == "BLOCKED" for row in audit) else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Create missing CJ orders without confirming or paying them.")
    parser.add_argument("--auto", action="store_true", help="Discover every eligible NovaHair order instead of the frozen batch.")
    parser.add_argument("--limit", type=int, default=25, help="Maximum orders to handle in one --auto run (default 25).")
    args = parser.parse_args()
    return run(apply=args.apply, auto=args.auto, limit=args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
