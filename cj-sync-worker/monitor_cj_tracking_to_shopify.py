#!/usr/bin/env python3
"""Poll CJ rescue orders and fulfill matching Shopify orders once tracking exists.

Rescue orders are DISCOVERED from CJ at runtime by scanning for order numbers
shaped RESCUE-{shopify order number}. Nothing is hardcoded, so any rescue
created later is picked up automatically instead of silently going unmonitored.

It refuses to create a Shopify fulfillment without a real tracking number.
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
from cj_auth import cj_request, get_token, request_json  # noqa: E402
from cj_order_state import (  # noqa: E402
    STATUS_FULFILLED,
    age_tag_changes,
    classify_cj_payment,
    current_status_tag,
    elapsed_order_days,
    has_age_tag,
    status_tag_changes,
)


APP_DIR = Path(__file__).resolve().parent
ENV_PATH = APP_DIR / ".env"
SHOP_DOMAIN_DEFAULT = "jacobfelipe.myshopify.com"
API_VERSION = "2024-10"
RESCUE_RE = re.compile(r"^RESCUE-(\d+)$")


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

# TLS verification and CJ token caching live in cj_auth. This module previously
# used ssl.CERT_NONE, which disabled certificate verification on every call.
def cj_token() -> str:
    return get_token()


def cj_get(token: str, endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
    return cj_request("GET", endpoint, params=params, token=token)


def discover_rescue_orders(token: str) -> dict[str, dict[str, str]]:
    """Find every live RESCUE-* order in CJ and map it to its Shopify order name.

    Replaces a hardcoded table that had gone stale and left seven orders
    unmonitored. TRASH rows are CJ's soft-deletes and must be ignored.
    """
    found: dict[str, dict[str, str]] = {}
    duplicates: list[str] = []
    for page in range(1, 8):
        response = cj_request("GET", "shopping/order/list", params={"pageNum": page, "pageSize": 100}, token=token)
        rows = (response.get("data") or {}).get("list") or []
        if not rows:
            break
        for row in rows:
            number = str(row.get("orderNum") or "").strip()
            if str(row.get("orderStatus") or "").upper() == "TRASH":
                continue
            match = RESCUE_RE.match(number)
            if not match:
                continue
            shopify_name = f"#{match.group(1)}"
            if shopify_name in found:
                duplicates.append(shopify_name)
                continue
            found[shopify_name] = {"rescue": number, "cj_order_id": str(row.get("orderId") or "")}
        if len(rows) < 100:
            break

    if duplicates:
        # Two+ CJ orders for one Shopify order means one could ship twice, so we
        # must not auto-fulfill it. But halting the whole run would leave every
        # other clean order unmonitored (one tangled Aug-25 order should not
        # block today's shipments). So drop the ambiguous orders and process the
        # rest; the excluded ones are surfaced for a human to untangle by hand.
        dupe_names = sorted(set(duplicates))
        for name in dupe_names:
            found.pop(name, None)
        print(
            f"# WARNING: {len(dupe_names)} Shopify order(s) have multiple CJ rescue "
            f"records and were EXCLUDED (resolve by hand): {dupe_names}",
            file=sys.stderr,
        )
    return dict(sorted(found.items()))


def shopify_graphql(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    url = f"https://{SHOPIFY_DOMAIN}/admin/api/{API_VERSION}/graphql.json"
    return request_json(
        "POST",
        url,
        {"X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json"},
        {"query": query, "variables": variables},
    )


def tracking_from_cj(data: dict[str, Any]) -> dict[str, str] | None:
    number = str(data.get("trackNumber") or "").strip()
    if not number or number.lower() in {"null", "none", "undefined"}:
        return None
    tracking = {"number": number}
    provider = str(data.get("trackingProvider") or data.get("logisticName") or "").strip()
    url = str(data.get("trackingUrl") or "").strip()
    if provider:
        tracking["company"] = provider
    if url.startswith("http://") or url.startswith("https://"):
        tracking["url"] = url
    return tracking


def get_shopify_fulfillment_order(order_name: str) -> dict[str, Any] | None:
    query = """
    query($q: String!) {
      orders(first: 1, query: $q) {
        edges {
          node {
            id
            name
            tags
            createdAt
            displayFulfillmentStatus
            fulfillmentOrders(first: 10) {
              edges {
                node {
                  id
                  status
                  requestStatus
                  supportedActions { action }
                  lineItems(first: 25) {
                    edges {
                      node {
                        id
                        remainingQuantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    """
    res = shopify_graphql(query, {"q": f"name:{order_name}"})
    edges = (((res.get("data") or {}).get("orders") or {}).get("edges") or [])
    return edges[0]["node"] if edges else None


def get_shopify_order_summaries(target_names: set[str]) -> dict[str, dict[str, Any]]:
    """Find CJ-linked Shopify orders in a few recent-order page requests."""
    query = """
    query($cursor: String) {
      orders(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges {
          node { id name tags createdAt displayFulfillmentStatus }
        }
      }
    }
    """
    found: dict[str, dict[str, Any]] = {}
    cursor: str | None = None
    for _ in range(10):
        res = shopify_graphql(query, {"cursor": cursor})
        connection = ((res.get("data") or {}).get("orders") or {})
        for edge in connection.get("edges") or []:
            node = edge.get("node") or {}
            if str(node.get("name") or "") in target_names:
                found[str(node["name"])] = node
        if len(found) == len(target_names):
            break
        page_info = connection.get("pageInfo") or {}
        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")
    return found


def add_tags(order_id: str, tags: list[str]) -> list[dict[str, Any]]:
    res = shopify_graphql(
        """
        mutation($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
        }
        """,
        {"id": order_id, "tags": tags},
    )
    return (((res.get("data") or {}).get("tagsAdd") or {}).get("userErrors") or [])


def remove_tags(order_id: str, tags: list[str]) -> list[dict[str, Any]]:
    res = shopify_graphql(
        """
        mutation($id: ID!, $tags: [String!]!) {
          tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
        }
        """,
        {"id": order_id, "tags": tags},
    )
    return (((res.get("data") or {}).get("tagsRemove") or {}).get("userErrors") or [])


def reconcile_status_tag(
    order_id: str,
    current_tags: list[str],
    desired_status: str | None,
    apply: bool,
) -> dict[str, Any]:
    """Replace every historical CJ operational tag with one current status."""
    if desired_status is None:
        return {
            "statusTag": None,
            "statusTagsAdded": [],
            "statusTagsRemoved": [],
            "statusTagErrors": [],
        }
    add, remove = status_tag_changes(current_tags, desired_status)
    errors: list[dict[str, Any]] = []
    if apply:
        if add:
            errors.extend(add_tags(order_id, add))
        if remove:
            errors.extend(remove_tags(order_id, remove))
    return {
        "statusTag": desired_status,
        "statusTagsAdded": add if apply else [],
        "statusTagsRemoved": remove if apply else [],
        "statusTagErrors": errors,
    }


def reconcile_age_tag(
    order_id: str,
    current_tags: list[str],
    created_at: str,
    completed_at: str | None,
    apply: bool,
) -> dict[str, Any]:
    try:
        days = elapsed_order_days(created_at, completed_at=completed_at)
    except ValueError as exc:
        return {"ageDays": None, "ageTagErrors": [{"message": str(exc)}]}
    add, remove = age_tag_changes(current_tags, days)
    errors: list[dict[str, Any]] = []
    if apply:
        if add:
            errors.extend(add_tags(order_id, add))
        if remove:
            errors.extend(remove_tags(order_id, remove))
    return {
        "ageDays": days,
        "ageTagsAdded": add if apply else [],
        "ageTagsRemoved": remove if apply else [],
        "ageTagErrors": errors,
    }


def create_tracking_fulfillment(fulfillment_order: dict[str, Any], tracking: dict[str, str]) -> tuple[bool, list[dict[str, Any]]]:
    line_items = []
    for edge in (((fulfillment_order.get("lineItems") or {}).get("edges")) or []):
        node = edge.get("node") or {}
        qty = int(node.get("remainingQuantity") or 0)
        if qty > 0:
            line_items.append({"id": node["id"], "quantity": qty})
    if not line_items:
        return False, [{"message": "No remaining fulfillment order line items"}]

    res = shopify_graphql(
        """
        mutation($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment { id status }
            userErrors { field message }
          }
        }
        """,
        {
            "fulfillment": {
                "notifyCustomer": False,
                "trackingInfo": tracking,
                "lineItemsByFulfillmentOrder": [
                    {
                        "fulfillmentOrderId": fulfillment_order["id"],
                        "fulfillmentOrderLineItems": line_items,
                    }
                ],
            }
        },
    )
    result = ((res.get("data") or {}).get("fulfillmentCreate") or {})
    errors = result.get("userErrors") or []
    return bool(result.get("fulfillment")) and not errors, errors


def run(apply: bool, emit_rows: bool = True) -> int:
    token = cj_token()
    rescue_orders = discover_rescue_orders(token)
    shopify_summaries = get_shopify_order_summaries(set(rescue_orders))
    print(f"# discovered {len(rescue_orders)} CJ rescue orders: {', '.join(rescue_orders)}", file=sys.stderr)
    rows: list[dict[str, Any]] = []
    for shopify_order, expected in rescue_orders.items():
        shopify = shopify_summaries.get(shopify_order)
        if not shopify:
            # Fallback for an order older than the batched recent-order window.
            shopify = get_shopify_fulfillment_order(shopify_order)
        if not shopify:
            rows.append({"order": shopify_order, "cj": expected["rescue"], "status": "SHOPIFY_NOT_FOUND"})
            continue

        current_tags = shopify.get("tags") or []
        if STATUS_FULFILLED in current_tags and has_age_tag(current_tags):
            rows.append({"order": shopify_order, "cj": expected["rescue"], "action": "COMPLETE_SKIPPED"})
            continue

        detail = cj_get(token, "shopping/order/getOrderDetail", {"orderId": expected["cj_order_id"]})
        cj_data = detail.get("data") or {}
        tracking = tracking_from_cj(cj_data)

        age_result = reconcile_age_tag(
            shopify["id"], current_tags, str(shopify.get("createdAt") or ""),
            str(cj_data.get("outWarehouseTime") or "") if tracking else None,
            apply,
        )

        if not tracking:
            desired_status = current_status_tag(
                cj_data, has_tracking=False, shopify_fulfilled=False
            )
            status_result = reconcile_status_tag(
                shopify["id"], current_tags, desired_status, apply
            )
            rows.append(
                {
                    "order": shopify_order,
                    "cj": expected["rescue"],
                    "cjStatus": cj_data.get("orderStatus"),
                    "cjSubStatus": cj_data.get("subStatus"),
                    "tracking": "NONE",
                    "shopify": shopify.get("displayFulfillmentStatus"),
                    "action": "PAYMENT_STATE_SYNCED" if apply else "DRY_RUN_PAYMENT_STATE",
                    "cjPayment": classify_cj_payment(cj_data).upper(),
                    "paymentDatePresent": bool(str(cj_data.get("paymentDate") or "").strip()),
                    **status_result,
                    **age_result,
                }
            )
            continue

        # OPEN is the wrong test. A fulfillment order can sit in IN_PROGRESS and
        # still accept a fulfillment - 8 orders shipped by CJ were stranded that
        # way, with real tracking that never reached the customer. The only
        # question that matters is whether Shopify offers CREATE_FULFILLMENT.
        detailed_shopify = get_shopify_fulfillment_order(shopify_order) or shopify
        fulfillment_orders = [
            edge["node"]
            for edge in (((detailed_shopify.get("fulfillmentOrders") or {}).get("edges")) or [])
            if any(
                action.get("action") == "CREATE_FULFILLMENT"
                for action in (edge.get("node", {}).get("supportedActions") or [])
            )
        ]
        if not fulfillment_orders:
            shopify_fulfilled = str(shopify.get("displayFulfillmentStatus") or "").upper() == "FULFILLED"
            desired_status = current_status_tag(
                cj_data, has_tracking=True, shopify_fulfilled=shopify_fulfilled
            )
            status_result = reconcile_status_tag(
                shopify["id"], current_tags, desired_status, apply
            )
            rows.append(
                {
                    "order": shopify_order,
                    "cj": expected["rescue"],
                    "tracking": "PRESENT",
                    "shopify": shopify.get("displayFulfillmentStatus"),
                    "action": "NO_OPEN_FULFILLMENT_ORDER",
                    "cjPayment": classify_cj_payment(cj_data).upper(),
                    **status_result,
                    **age_result,
                }
            )
            continue

        if not apply:
            desired_status = current_status_tag(
                cj_data, has_tracking=True, shopify_fulfilled=False
            )
            status_result = reconcile_status_tag(
                shopify["id"], current_tags, desired_status, apply=False
            )
            rows.append(
                {
                    "order": shopify_order,
                    "cj": expected["rescue"],
                    "tracking": "PRESENT",
                    "shopify": shopify.get("displayFulfillmentStatus"),
                    "action": "DRY_RUN_WOULD_FULFILL",
                    "cjPayment": classify_cj_payment(cj_data).upper(),
                    **status_result,
                    **age_result,
                }
            )
            continue

        ok, errors = create_tracking_fulfillment(fulfillment_orders[0], tracking)
        desired_status = current_status_tag(
            cj_data, has_tracking=True, shopify_fulfilled=ok
        )
        status_result = reconcile_status_tag(
            shopify["id"], current_tags, desired_status, apply=True
        )
        rows.append(
            {
                "order": shopify_order,
                "cj": expected["rescue"],
                "tracking": "PRESENT",
                "shopify": shopify.get("displayFulfillmentStatus"),
                "action": "FULFILLED" if ok else "FULFILLMENT_ERROR",
                "errors": errors,
                "cjPayment": classify_cj_payment(cj_data).upper(),
                **status_result,
                **age_result,
            }
        )

    if emit_rows:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    summary: dict[str, int] = {}
    for row in rows:
        action = str(row.get("action") or row.get("status") or "UNKNOWN")
        summary[action] = summary.get(action, 0) + 1
    print(f"# monitor summary: {summary}", file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Create Shopify fulfillments when real CJ tracking is present.")
    args = parser.parse_args()
    return run(apply=args.apply)


if __name__ == "__main__":
    raise SystemExit(main())
