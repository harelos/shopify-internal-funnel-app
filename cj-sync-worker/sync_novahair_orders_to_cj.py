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
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import rescue_current_novahair_orders as rescue  # noqa: E402
from cj_auth import _build_ssl_context, get_token  # noqa: E402

APP_DIR = Path(__file__).resolve().parent
LOG_PATH = APP_DIR / "novahair_cj_sync_log.json"

# The 24 orders already in CJ use this prefix. Keeping it is what makes the
# sync idempotent against work the rescue script already did - a new prefix
# would re-create every one of them as a duplicate.
ORDER_PREFIX = "RESCUE-"

LINK_NEXT = re.compile(r'<([^>]+)>;\s*rel="next"')


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


def validate(order: dict[str, Any]) -> tuple[str, dict[str, int], int]:
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
    return rescue.parse_composition(order)


def run(apply: bool, days: int, limit: int, emit_rows: bool = True) -> int:
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
            sku, composition, bottle_count = validate(order)
        except rescue.DataGapError as exc:
            rows.append({"order": f"#{number}", "action": "SKIPPED", "reason": str(exc)})
            continue

        duplicates = existing.get(key) or []
        if len(duplicates) > 1:
            rows.append({"order": f"#{number}", "action": "BLOCKED", "reason": "multiple CJ orders"})
            continue
        if duplicates:
            rows.append({
                "order": f"#{number}", "sku": sku, "action": "ALREADY_IN_CJ",
                "cj_order_id": str(duplicates[0].get("orderId") or ""),
                "cj_status": duplicates[0].get("orderStatus"),
            })
            continue

        if limit and created >= limit:
            rows.append({"order": f"#{number}", "sku": sku, "action": "DEFERRED_LIMIT"})
            continue

        if not apply:
            rows.append({"order": f"#{number}", "sku": sku, "composition": composition,
                         "action": "DRY_RUN_WOULD_CREATE"})
            created += 1
            continue

        try:
            result = rescue.create_one(
                token, order, sku, composition, catalog, supplement, bottle_count, existing
            )
            rows.append({"order": f"#{number}", "sku": sku, "composition": composition, **result})
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
