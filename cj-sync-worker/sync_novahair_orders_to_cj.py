#!/usr/bin/env python3
"""Continuously sync paid NovaHair bundle orders from Shopify into CJ.

This is the permanent replacement for the frozen rescue batch. It does NOT rely
on CJ product connections, Combined Products, or a Shopify Cart Transform:
CJ's createOrderV2 accepts raw {vid, quantity} components, so we decode the
bundle SKU ourselves and push the physical components directly. That is the same
path that delivered the 24 orders already in CJ.

Safety model is inherited unchanged from rescue_current_novahair_orders.py:
  * dry run unless --apply
  * never confirms, pays, deletes or fulfills
  * idempotent on CJ orderNum RESCUE-{shopify order number}
  * skips unpaid / cancelled / fulfilled / test-tagged orders
  * never prints recipient PII

Usage:
    python sync_novahair_orders_to_cj.py                 # dry run, last 60 days
    python sync_novahair_orders_to_cj.py --days 14
    python sync_novahair_orders_to_cj.py --apply
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import rescue_current_novahair_orders as rescue  # noqa: E402
from cj_auth import _build_ssl_context, get_token  # noqa: E402
import novahair_manifest as manifest  # noqa: E402

APP_DIR = Path(__file__).resolve().parent
LOG_PATH = APP_DIR / "novahair_cj_sync_log.json"

# The 24 orders already in CJ use this prefix. Keeping it is what makes the
# sync idempotent against work the rescue script already did - a new prefix
# would re-create every one of them as a duplicate.
ORDER_PREFIX = "RESCUE-"

LINK_NEXT = re.compile(r'<([^>]+)>;\s*rel="next"')


def reconcile_mode() -> str:
    mode = os.getenv("CJ_RECONCILE_MODE", "report").strip().lower()
    if mode != "report":
        raise RuntimeError(
            "Only CJ_RECONCILE_MODE=report is available before Gate B approval"
        )
    return mode


def order_settle_seconds() -> int:
    try:
        seconds = int(os.getenv("ORDER_SETTLE_SECONDS", "600"))
    except ValueError as exc:
        raise RuntimeError("ORDER_SETTLE_SECONDS must be an integer") from exc
    if seconds < 0:
        raise RuntimeError("ORDER_SETTLE_SECONDS cannot be negative")
    return seconds


def shopify_paid_orders(days: int) -> list[dict[str, Any]]:
    """Every paid Shopify order in the window, following REST pagination."""
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat()
    url = (
        f"https://{rescue.SHOPIFY_DOMAIN}/admin/api/{rescue.SHOPIFY_API_VERSION}"
        f"/orders.json?status=any&financial_status=paid&limit=250&created_at_min={since}"
    )
    ctx = _build_ssl_context()
    orders: list[dict[str, Any]] = []
    while url:
        req = urllib.request.Request(
            url, headers={"X-Shopify-Access-Token": rescue.SHOPIFY_TOKEN}, method="GET"
        )
        with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            link = resp.headers.get("Link") or ""
        orders.extend(body.get("orders") or [])
        match = LINK_NEXT.search(link)
        url = match.group(1) if match else None
    return orders


def validate(order: dict[str, Any]) -> dict[str, Any]:
    """Same gates as the rescue script, minus the frozen-batch restriction."""
    if order.get("financial_status") != "paid":
        raise rescue.DataGapError("Shopify order is not paid")
    if order.get("cancelled_at"):
        raise rescue.DataGapError("Shopify order is cancelled")
    if order.get("fulfillment_status") not in (None, "partial"):
        raise rescue.DataGapError("Shopify order is already fulfilled")
    tags = {t.strip().upper() for t in str(order.get("tags") or "").split(",") if t.strip()}
    if tags.intersection({"INTERNAL", "TEST", "CANARY", "DO_NOT_FULFILL"}):
        raise rescue.DataGapError("Order is excluded by safety tag")
    try:
        return manifest.build_order_manifest(order)
    except manifest.NeedsMappingError:
        raise
    except manifest.ManifestError as exc:
        raise rescue.DataGapError(str(exc)) from exc


def _detail_with_products(token: str, row: dict[str, Any]) -> dict[str, Any]:
    if row.get("productList"):
        return row
    order_id = str(row.get("orderId") or "")
    return rescue.detail_for(token, order_id) if order_id else row


def _is_replaceable_report_candidate(cj_order: dict[str, Any]) -> bool:
    status = str(cj_order.get("orderStatus") or "").strip().upper()
    payment_date = str(cj_order.get("paymentDate") or "").strip()
    tracking = str(
        cj_order.get("trackNumber")
        or cj_order.get("trackingNumber")
        or ""
    ).strip()
    return status in {"CREATED", "IN_CART"} and not payment_date and not tracking


def run(apply: bool, days: int, limit: int, emit_rows: bool = True) -> int:
    mode = reconcile_mode()
    settle_seconds = order_settle_seconds()
    token = get_token()
    existing = rescue.existing_cj_orders(token)
    catalog = rescue.cj_variant_catalog(token)
    supplement = rescue.load_supplement()
    orders = shopify_paid_orders(days)

    rows: list[dict[str, Any]] = []
    created = 0
    for order in sorted(orders, key=lambda o: int(o.get("order_number") or 0)):
        number = int(order.get("order_number") or 0)
        if not number:
            continue
        # Cheap pre-filter: ignore anything without a NovaHair bundle line.
        if not any(str(li.get("sku") or "").startswith("NOVASALE-") for li in (order.get("line_items") or [])):
            continue

        key = f"{ORDER_PREFIX}{number}"
        try:
            expected_manifest = validate(order)
            sku = str(expected_manifest["bundle_sku"])
            composition = dict(expected_manifest["composition"])
            bottle_count = int(expected_manifest["bottle_count"])
        except manifest.NeedsMappingError as exc:
            rows.append({"order": f"#{number}", "action": "NEEDS_MAPPING", "reason": str(exc)})
            continue
        except rescue.DataGapError as exc:
            rows.append({"order": f"#{number}", "action": "SKIPPED", "reason": str(exc)})
            continue

        duplicates = existing.get(key) or []
        if len(duplicates) > 1:
            rows.append({"order": f"#{number}", "action": "BLOCKED", "reason": "multiple CJ orders"})
            continue
        if duplicates:
            existing_row = duplicates[0]
            base = {
                "order": f"#{number}",
                "sku": sku,
                "cj_order_id": str(existing_row.get("orderId") or ""),
                "cj_status": existing_row.get("orderStatus"),
                "manifest_fingerprint": expected_manifest["fingerprint"],
            }
            if not expected_manifest["has_physical_addons"]:
                rows.append({**base, "action": "ALREADY_IN_CJ"})
                continue

            detail = _detail_with_products(token, existing_row)
            difference = manifest.manifest_diff(
                expected_manifest["items"], detail.get("productList") or []
            )
            if difference["matches"]:
                rows.append({**base, "action": "ALREADY_IN_CJ_VERIFIED"})
            else:
                rows.append(
                    {
                        **base,
                        "action": "CJ_MANIFEST_DRIFT_REPORT",
                        "reconcile_mode": mode,
                        "replaceable_candidate": _is_replaceable_report_candidate(detail),
                        "expected_products": difference["expected"],
                        "actual_products": difference["actual"],
                        "expected_product_fingerprint": difference[
                            "expected_product_fingerprint"
                        ],
                        "actual_product_fingerprint": difference[
                            "actual_product_fingerprint"
                        ],
                    }
                )
            continue

        if limit and created >= limit:
            rows.append({"order": f"#{number}", "sku": sku, "action": "DEFERRED_LIMIT"})
            continue

        settle_remaining = manifest.settle_remaining_seconds(order, settle_seconds)
        if settle_remaining is None:
            rows.append(
                {
                    "order": f"#{number}",
                    "sku": sku,
                    "action": "NEEDS_DATA",
                    "reason": "Shopify created_at is missing or invalid",
                }
            )
            continue
        if settle_remaining > 0:
            rows.append(
                {
                    "order": f"#{number}",
                    "sku": sku,
                    "action": "WAITING_FOR_ORDER_SETTLE",
                    "remaining_seconds": settle_remaining,
                }
            )
            continue

        if not apply:
            rows.append({"order": f"#{number}", "sku": sku, "composition": composition,
                         "manifest_fingerprint": expected_manifest["fingerprint"],
                         "ignored_shopify_only_lines": len(expected_manifest["ignored"]),
                         "action": "DRY_RUN_WOULD_CREATE"})
            created += 1
            continue

        try:
            result = rescue.create_one(
                token,
                order,
                sku,
                composition,
                catalog,
                supplement,
                bottle_count,
                existing,
                manifest_items=expected_manifest["items"],
            )
            rows.append(
                {
                    "order": f"#{number}",
                    "sku": sku,
                    "composition": composition,
                    "manifest_fingerprint": expected_manifest["fingerprint"],
                    "ignored_shopify_only_lines": len(expected_manifest["ignored"]),
                    **result,
                }
            )
            created += 1
        except rescue.DataGapError as exc:
            # Nothing reached CJ (bad address, missing postcode, ...). One bad
            # order must not block every other customer, so skip and continue.
            rows.append({"order": f"#{number}", "sku": sku, "action": "NEEDS_DATA", "reason": str(exc)})
            continue
        except Exception as exc:
            # CJ state is uncertain after a create/verify failure. Stop the batch.
            rows.append({"order": f"#{number}", "sku": sku, "action": "ERROR", "reason": str(exc)[:200]})
            break

    if emit_rows:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    summary: dict[str, int] = {}
    for r in rows:
        summary[r["action"]] = summary.get(r["action"], 0) + 1
    print(f"\n# summary: {summary}", file=sys.stderr)
    LOG_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Actually create CJ orders.")
    ap.add_argument("--days", type=int, default=60, help="Look-back window in days.")
    ap.add_argument("--limit", type=int, default=0, help="Max orders to create in one run (0 = no cap).")
    args = ap.parse_args()
    return run(args.apply, args.days, args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
