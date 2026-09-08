#!/usr/bin/env python3
"""Audit, apply, verify, and roll back TigerBrandsGlobal's USD -> ILS migration.

The migration target for each variant is its current Israel contextual price.
The script never changes the shop currency itself; that owner-only action is
performed in Shopify Admin between `audit` and `apply-prices`.
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import certifi


ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[1]
ENV_PATH = WORKSPACE / "app" / ".env"
BACKUP_DIR = ROOT / "backups"
API_VERSION = "2026-07"


def load_env() -> None:
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def credentials() -> tuple[str, str]:
    shop = os.getenv("SHOPIFY_SHOP_DOMAIN") or os.getenv("SHOP_DOMAIN")
    token = os.getenv("SHOPIFY_ACCESS_TOKEN") or os.getenv("SHOPIFY_ADMIN_ACCESS_TOKEN")
    if not shop or not token:
        raise RuntimeError("Shopify credentials are missing")
    return shop, token


def request_json(method: str, url: str, payload: dict[str, Any] | None = None) -> tuple[dict[str, Any], Any]:
    _, token = credentials()
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
        },
    )
    context = ssl.create_default_context(cafile=certifi.where())
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, context=context, timeout=90) as response:
                raw = response.read().decode("utf-8")
                return (json.loads(raw) if raw else {}), response.headers
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            if exc.code != 429 and exc.code < 500:
                raise RuntimeError(f"Shopify HTTP {exc.code}: {detail[:500]}") from exc
            if attempt == 5:
                raise RuntimeError(f"Shopify HTTP {exc.code} after retries: {detail[:500]}") from exc
        except urllib.error.URLError as exc:
            if attempt == 5:
                raise RuntimeError(f"Shopify network error after retries: {exc}") from exc
        time.sleep(min(1.5 * (2**attempt), 12))
    raise RuntimeError("Shopify request retry loop exhausted")


def graphql(query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    shop, _ = credentials()
    for attempt in range(6):
        result, _ = request_json(
            "POST",
            f"https://{shop}/admin/api/{API_VERSION}/graphql.json",
            {"query": query, "variables": variables or {}},
        )
        errors = result.get("errors") or []
        throttled = errors and all((row.get("extensions") or {}).get("code") == "THROTTLED" for row in errors)
        if not throttled:
            if errors:
                raise RuntimeError(json.dumps(errors, ensure_ascii=False))
            return result.get("data") or {}
        if attempt == 5:
            raise RuntimeError(json.dumps(errors, ensure_ascii=False))
        time.sleep(min(1.5 * (2**attempt), 12))
    raise RuntimeError("Shopify GraphQL retry loop exhausted")


def rest_get(path: str) -> dict[str, Any]:
    shop, _ = credentials()
    result, _ = request_json("GET", f"https://{shop}/admin/api/{API_VERSION}/{path.lstrip('/')}")
    return result


def fetch_shop_and_markets() -> dict[str, Any]:
    query = """
    query CurrencyMigrationShop {
      shop { id name currencyCode enabledPresentmentCurrencies }
      markets(first: 50) {
        nodes {
          id name status
          currencySettings { baseCurrency { currencyCode } }
          priceList { id name currency }
          regions(first: 50) { nodes { ... on MarketRegionCountry { code } } }
        }
      }
    }
    """
    return graphql(query)


def fetch_variants() -> list[dict[str, Any]]:
    query = """
    query CurrencyMigrationVariants($cursor: String) {
      productVariants(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id title sku price compareAtPrice
          product { id title handle status }
          contextualPricing(context: { country: IL }) {
            price { amount currencyCode }
            compareAtPrice { amount currencyCode }
          }
        }
      }
    }
    """
    rows: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        connection = graphql(query, {"cursor": cursor})["productVariants"]
        rows.extend(connection["nodes"])
        if not connection["pageInfo"]["hasNextPage"]:
            return rows
        cursor = connection["pageInfo"]["endCursor"]


def fetch_price_list(price_list_id: str) -> dict[str, Any]:
    query = """
    query CurrencyMigrationPriceList($id: ID!, $cursor: String) {
      node(id: $id) {
        ... on PriceList {
          id name currency fixedPricesCount
          parent {
            adjustment { type value }
            settings { compareAtMode }
          }
          prices(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              originType
              price { amount currencyCode }
              compareAtPrice { amount currencyCode }
              variant { id sku product { id handle } }
            }
          }
        }
      }
    }
    """
    cursor: str | None = None
    rows: list[dict[str, Any]] = []
    metadata: dict[str, Any] | None = None
    while True:
        node = graphql(query, {"id": price_list_id, "cursor": cursor})["node"]
        if not node:
            raise RuntimeError(f"Price list not found: {price_list_id}")
        if metadata is None:
            metadata = {key: node.get(key) for key in ("id", "name", "currency", "fixedPricesCount", "parent")}
        connection = node["prices"]
        rows.extend(connection["nodes"])
        if not connection["pageInfo"]["hasNextPage"]:
            return {**(metadata or {}), "prices": rows}
        cursor = connection["pageInfo"]["endCursor"]


def fetch_pending_orders() -> dict[str, Any]:
    query = """
    query PendingCurrencyOrders {
      orders(first: 100, query: "financial_status:pending OR financial_status:authorized OR financial_status:partially_paid", sortKey: CREATED_AT, reverse: true) {
        nodes {
          id name displayFinancialStatus createdAt
          totalOutstandingSet {
            shopMoney { amount currencyCode }
            presentmentMoney { amount currencyCode }
          }
        }
      }
    }
    """
    return graphql(query)["orders"]


def fetch_gift_cards() -> dict[str, Any]:
    query = """
    query OpenGiftCards {
      giftCards(first: 100, query: "balance:>0") {
        nodes {
          id enabled expiresOn
          initialValue { amount currencyCode }
          balance { amount currencyCode }
        }
      }
    }
    """
    return graphql(query)["giftCards"]


def safe_fetch(label: str, fetcher: Any) -> dict[str, Any]:
    try:
        return {"ok": True, "data": fetcher()}
    except Exception as exc:
        return {"ok": False, "error": f"{label}: {str(exc)[:500]}"}


def build_snapshot() -> dict[str, Any]:
    shop_and_markets = fetch_shop_and_markets()
    variants = fetch_variants()
    israel_market = next(
        (
            market
            for market in shop_and_markets["markets"]["nodes"]
            if any(region.get("code") == "IL" for region in (market.get("regions") or {}).get("nodes", []))
        ),
        None,
    )
    israel_price_list_id = ((israel_market or {}).get("priceList") or {}).get("id")
    targets = []
    target_errors = []
    for variant in variants:
        contextual = variant.get("contextualPricing") or {}
        price = contextual.get("price")
        compare_at = contextual.get("compareAtPrice")
        if not price or price.get("currencyCode") != "ILS":
            target_errors.append({"variantId": variant["id"], "reason": "Missing ILS contextual price"})
            continue
        targets.append(
            {
                "productId": variant["product"]["id"],
                "productHandle": variant["product"]["handle"],
                "productTitle": variant["product"]["title"],
                "productStatus": variant["product"]["status"],
                "variantId": variant["id"],
                "variantTitle": variant["title"],
                "sku": variant.get("sku"),
                "baseBefore": {
                    "price": variant["price"],
                    "compareAtPrice": variant.get("compareAtPrice"),
                    "currencyCode": shop_and_markets["shop"]["currencyCode"],
                },
                "israelBefore": {
                    "price": price["amount"],
                    "compareAtPrice": compare_at["amount"] if compare_at else None,
                    "currencyCode": "ILS",
                },
                "targetBaseILS": {
                    "price": price["amount"],
                    "compareAtPrice": compare_at["amount"] if compare_at else None,
                },
            }
        )

    return {
        "schemaVersion": 1,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "shop": shop_and_markets["shop"],
        "markets": shop_and_markets["markets"]["nodes"],
        "counts": {
            "products": len({row["productId"] for row in targets}),
            "variants": len(targets),
            "novaVariants": sum(1 for row in targets if str(row.get("sku") or "").startswith("NOVASALE-")),
        },
        "targetErrors": target_errors,
        "targets": targets,
        "israelPriceList": safe_fetch(
            "Israel price list",
            lambda: fetch_price_list(israel_price_list_id) if israel_price_list_id else (_ for _ in ()).throw(RuntimeError("Israel price list missing")),
        ),
        "discountPriceRules": safe_fetch("price rules", lambda: rest_get("price_rules.json?limit=250")),
        "shippingZones": safe_fetch("shipping zones", lambda: rest_get("shipping_zones.json")),
        "pendingOrders": safe_fetch("pending orders", fetch_pending_orders),
        "giftCards": safe_fetch("gift cards", fetch_gift_cards),
    }


def write_snapshot(snapshot: dict[str, Any]) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = BACKUP_DIR / f"usd-to-ils-before-{stamp}.json"
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "LATEST_BACKUP.txt").write_text(str(path), encoding="utf-8")
    return path


def load_snapshot(path: str | None) -> tuple[Path, dict[str, Any]]:
    if path:
        backup_path = Path(path).resolve()
    else:
        backup_path = Path((ROOT / "LATEST_BACKUP.txt").read_text(encoding="utf-8").strip())
    return backup_path, json.loads(backup_path.read_text(encoding="utf-8"))


def money_equal(left: str | None, right: str | None) -> bool:
    if left is None or right is None:
        return left is None and right is None
    return Decimal(str(left)).quantize(Decimal("0.01")) == Decimal(str(right)).quantize(Decimal("0.01"))


def update_product_variants(product_id: str, variants: list[dict[str, Any]]) -> None:
    mutation = """
    mutation UpdateProductVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) {
        productVariants { id price compareAtPrice }
        userErrors { field message code }
      }
    }
    """
    result = graphql(mutation, {"productId": product_id, "variants": variants})["productVariantsBulkUpdate"]
    if result["userErrors"]:
        raise RuntimeError(json.dumps(result["userErrors"], ensure_ascii=False))
    if {row["id"] for row in result["productVariants"]} != {row["id"] for row in variants}:
        raise RuntimeError(f"Shopify returned an incomplete variant set for {product_id}")


def preflight(snapshot: dict[str, Any]) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    warnings: list[str] = []
    shop = fetch_shop_and_markets()["shop"]
    if shop["currencyCode"] != "USD":
        failures.append({"field": "shop.currencyCode", "actual": shop["currencyCode"], "expected": "USD"})
    if snapshot.get("targetErrors"):
        failures.append({"field": "snapshot.targetErrors", "count": len(snapshot["targetErrors"])})

    targets = snapshot.get("targets") or []
    target_ids = [row["variantId"] for row in targets]
    if len(target_ids) != len(set(target_ids)):
        failures.append({"field": "snapshot.targets", "reason": "duplicate variant IDs"})

    live_rows = fetch_variants()
    live = {row["id"]: row for row in live_rows}
    if set(live) != set(target_ids):
        failures.append(
            {
                "field": "catalog.variantIds",
                "missingFromLive": len(set(target_ids) - set(live)),
                "newSinceSnapshot": len(set(live) - set(target_ids)),
            }
        )

    for target in targets:
        actual = live.get(target["variantId"])
        if not actual:
            continue
        before = target["baseBefore"]
        contextual = actual.get("contextualPricing") or {}
        contextual_price = (contextual.get("price") or {}).get("amount")
        contextual_compare = (contextual.get("compareAtPrice") or {}).get("amount")
        if not money_equal(actual.get("price"), before.get("price")):
            failures.append({"variantId": target["variantId"], "field": "base price changed", "actual": actual.get("price"), "expected": before.get("price")})
        if not money_equal(actual.get("compareAtPrice"), before.get("compareAtPrice")):
            failures.append({"variantId": target["variantId"], "field": "base compare-at changed", "actual": actual.get("compareAtPrice"), "expected": before.get("compareAtPrice")})
        desired = target["targetBaseILS"]
        if not money_equal(contextual_price, desired.get("price")):
            failures.append({"variantId": target["variantId"], "field": "Israel price changed", "actual": contextual_price, "expected": desired.get("price")})
        if not money_equal(contextual_compare, desired.get("compareAtPrice")):
            failures.append({"variantId": target["variantId"], "field": "Israel compare-at changed", "actual": contextual_compare, "expected": desired.get("compareAtPrice")})

    nova = [row for row in targets if str(row.get("sku") or "").startswith("NOVASALE-")]
    nova_groups: dict[tuple[str | None, str | None], int] = defaultdict(int)
    for row in nova:
        desired = row["targetBaseILS"]
        nova_groups[(desired.get("price"), desired.get("compareAtPrice"))] += 1
    expected_nova = {("189", "379"): 15, ("239", "758"): 70, ("319", "1137"): 210}
    normalized_nova = {
        (str(Decimal(str(key[0])).normalize()), str(Decimal(str(key[1])).normalize())): value
        for key, value in nova_groups.items()
        if key[0] is not None and key[1] is not None
    }
    if len(nova) != 295 or normalized_nova != expected_nova:
        failures.append({"field": "NovaHair variants", "count": len(nova), "groups": {str(key): value for key, value in normalized_nova.items()}})

    price_list = snapshot.get("israelPriceList") or {}
    if not price_list.get("ok"):
        failures.append({"field": "Israel price list backup", "reason": price_list.get("error") or "missing"})
    else:
        price_list_data = price_list.get("data") or {}
        if price_list_data.get("currency") != "ILS":
            failures.append({"field": "Israel price list currency", "actual": price_list_data.get("currency"), "expected": "ILS"})
        fixed_nova = [
            row
            for row in price_list_data.get("prices", [])
            if str((row.get("variant") or {}).get("sku") or "").startswith("NOVASALE-") and row.get("originType") == "FIXED"
        ]
        if len(fixed_nova) != 295:
            failures.append({"field": "NovaHair fixed Israel prices", "count": len(fixed_nova), "expected": 295})

    if len(targets) != snapshot.get("counts", {}).get("variants"):
        failures.append({"field": "snapshot counts", "reason": "variant count mismatch"})
    if len(failures) > 50:
        warnings.append(f"Failure output truncated conceptually; total failures: {len(failures)}")
    return {"ok": not failures, "checked": len(targets), "novaChecked": len(nova), "failures": failures, "warnings": warnings}


def apply_prices(snapshot: dict[str, Any], rollback: bool) -> None:
    live_shop = fetch_shop_and_markets()["shop"]
    required_currency = "USD" if rollback else "ILS"
    if live_shop["currencyCode"] != required_currency:
        raise RuntimeError(
            f"Refusing price update: shop currency is {live_shop['currencyCode']}, expected {required_currency}"
        )

    by_product: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in snapshot["targets"]:
        source = row["baseBefore"] if rollback else row["targetBaseILS"]
        by_product[row["productId"]].append(
            {
                "id": row["variantId"],
                "price": source["price"],
                "compareAtPrice": source.get("compareAtPrice"),
            }
        )

    progress_path = ROOT / "migration-progress.json"
    completed: list[str] = []
    for product_id, variants in by_product.items():
        for start in range(0, len(variants), 250):
            update_product_variants(product_id, variants[start : start + 250])
            time.sleep(0.15)
        completed.append(product_id)
        progress_path.write_text(
            json.dumps(
                {
                    "mode": "rollback" if rollback else "apply",
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "completedProducts": completed,
                    "totalProducts": len(by_product),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )


def verify(snapshot: dict[str, Any], rollback: bool = False) -> dict[str, Any]:
    live = {row["id"]: row for row in fetch_variants()}
    expected_currency = "USD" if rollback else "ILS"
    failures = []
    for target in snapshot["targets"]:
        actual = live.get(target["variantId"])
        if not actual:
            failures.append({"variantId": target["variantId"], "reason": "missing"})
            continue
        expected = target["baseBefore"] if rollback else target["targetBaseILS"]
        if not money_equal(actual["price"], expected["price"]):
            failures.append({"variantId": target["variantId"], "field": "price", "actual": actual["price"], "expected": expected["price"]})
        if not money_equal(actual.get("compareAtPrice"), expected.get("compareAtPrice")):
            failures.append({"variantId": target["variantId"], "field": "compareAtPrice", "actual": actual.get("compareAtPrice"), "expected": expected.get("compareAtPrice")})
    shop = fetch_shop_and_markets()["shop"]
    if shop["currencyCode"] != expected_currency:
        failures.append({"field": "shop.currencyCode", "actual": shop["currencyCode"], "expected": expected_currency})
    return {"ok": not failures, "checked": len(snapshot["targets"]), "failures": failures}


def audit_summary(snapshot: dict[str, Any]) -> dict[str, Any]:
    price_rules = ((snapshot["discountPriceRules"].get("data") or {}).get("price_rules") or [])
    fixed_rules = [
        {"id": row.get("id"), "title": row.get("title"), "value": row.get("value"), "value_type": row.get("value_type")}
        for row in price_rules
        if row.get("value_type") == "fixed_amount"
    ]
    shipping = ((snapshot["shippingZones"].get("data") or {}).get("shipping_zones") or [])
    pending = (((snapshot["pendingOrders"].get("data") or {}).get("nodes")) or [])
    gifts = (((snapshot["giftCards"].get("data") or {}).get("nodes")) or [])
    return {
        "shopCurrency": snapshot["shop"]["currencyCode"],
        **snapshot["counts"],
        "targetErrors": len(snapshot["targetErrors"]),
        "fixedAmountDiscounts": fixed_rules,
        "shippingZones": len(shipping),
        "pendingOrders": [row["name"] for row in pending],
        "openGiftCards": len(gifts),
        "auditErrors": [
            value.get("error")
            for key, value in snapshot.items()
            if isinstance(value, dict) and value.get("ok") is False
        ],
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("audit", "preflight", "apply-prices", "verify", "rollback-prices"))
    parser.add_argument("--backup")
    args = parser.parse_args()
    load_env()

    if args.command == "audit":
        snapshot = build_snapshot()
        path = write_snapshot(snapshot)
        print(json.dumps({"backup": str(path), "summary": audit_summary(snapshot)}, ensure_ascii=False, indent=2))
        return 0 if not snapshot["targetErrors"] else 2

    backup_path, snapshot = load_snapshot(args.backup)
    if args.command == "preflight":
        result = preflight(snapshot)
    elif args.command == "apply-prices":
        apply_prices(snapshot, rollback=False)
        result = verify(snapshot)
    elif args.command == "rollback-prices":
        apply_prices(snapshot, rollback=True)
        result = verify(snapshot, rollback=True)
    else:
        result = verify(snapshot)
    print(json.dumps({"backup": str(backup_path), **result}, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
