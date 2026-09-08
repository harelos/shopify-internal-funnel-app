"""Publish a PII-minimized Shopify + CJ shipment snapshot to Commerce OS.

The existing fulfillment loop remains unchanged.  This module is reporting
only: it reads provider state, scores it, and sends a signed snapshot to the
owner dashboard three times per Israel business day.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from cj_auth import cj_request, get_token
from monitor_cj_tracking_to_shopify import shopify_graphql
from shipment_risk import score_shipment


ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
RESCUE_RE = re.compile(r"^RESCUE-(\d+)$")
STATE_PATH = Path(__file__).resolve().parent / ".shipment_snapshot_state.json"
SCHEDULE_HOURS = (9, 15, 21)


SHOPIFY_OPERATIONAL_QUERY = """
query ShipmentOrders($cursor: String) {
  orders(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id
      name
      createdAt
      processedAt
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      risk { recommendation }
      tags
      transactions(first: 100) {
        kind
        status
        processedAt
        amountSet { shopMoney { amount currencyCode } }
      }
      fulfillments(first: 10) {
        id
        status
        createdAt
        updatedAt
        deliveredAt
        displayStatus
        trackingInfo { number company url }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""


def log(message: str) -> None:
    print(f"# shipment snapshot: {message}", flush=True)


def _latest_due_slot(now: datetime) -> str:
    local = now.astimezone(ISRAEL_TZ)
    candidates = [local.replace(hour=hour, minute=0, second=0, microsecond=0) for hour in SCHEDULE_HOURS]
    due = [candidate for candidate in candidates if candidate <= local]
    if not due:
        previous = local - timedelta(days=1)
        slot = previous.replace(hour=SCHEDULE_HOURS[-1], minute=0, second=0, microsecond=0)
    else:
        slot = due[-1]
    return slot.strftime("%Y-%m-%dT%H:00%z")


def _read_state() -> dict[str, Any]:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _write_state(slot: str, run_id: str) -> None:
    STATE_PATH.write_text(
        json.dumps({"lastSlot": slot, "lastRunId": run_id}, ensure_ascii=False),
        encoding="utf-8",
    )


def discover_inventory(token: str) -> tuple[dict[str, dict[str, str]], dict[str, list[dict[str, Any]]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for page in range(1, 8):
        response = cj_request(
            "GET",
            "shopping/order/list",
            params={"pageNum": page, "pageSize": 100},
            token=token,
        )
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
            grouped.setdefault(f"#{match.group(1)}", []).append(row)
        if len(rows) < 100:
            break

    unique: dict[str, dict[str, str]] = {}
    conflicts: dict[str, list[dict[str, Any]]] = {}
    for order_name, rows in grouped.items():
        if len(rows) == 1:
            unique[order_name] = {
                "rescue": str(rows[0].get("orderNum") or ""),
                "cj_order_id": str(rows[0].get("orderId") or ""),
            }
        else:
            conflicts[order_name] = rows
    return dict(sorted(unique.items())), dict(sorted(conflicts.items()))


def shopify_operational_summaries(target_names: set[str]) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    cursor: str | None = None
    for _ in range(10):
        response = shopify_graphql(SHOPIFY_OPERATIONAL_QUERY, {"cursor": cursor})
        if response.get("errors"):
            raise RuntimeError(f"Shopify operational query failed: {response['errors'][:1]}")
        connection = ((response.get("data") or {}).get("orders") or {})
        for node in connection.get("nodes") or []:
            name = str(node.get("name") or "")
            if name in target_names:
                found[name] = node
        if len(found) == len(target_names):
            break
        page_info = connection.get("pageInfo") or {}
        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")
    return found


def _successful_sale_count(shopify: dict[str, Any]) -> int:
    return sum(
        1
        for transaction in (shopify.get("transactions") or [])
        if str(transaction.get("kind") or "").upper() == "SALE"
        and str(transaction.get("status") or "").upper() == "SUCCESS"
    )


def _track_snapshot(token: str, tracking_number: str) -> dict[str, Any]:
    if not tracking_number:
        return {}
    response = cj_request(
        "GET",
        "logistic/trackInfo",
        params={"trackNumber": tracking_number},
        token=token,
    )
    rows = response.get("data") or []
    if not isinstance(rows, list) or not rows:
        return {}
    row = rows[0] or {}
    return {
        "trackingStatus": row.get("trackingStatus"),
        "trackingRoutes": [
            {
                "acceptTime": route.get("acceptTime"),
                "remark": route.get("remark"),
            }
            for route in (row.get("routes") or [])
        ],
        "lastMileCarrier": row.get("lastMileCarrier"),
    }


def _base_record(order_name: str, shopify: dict[str, Any]) -> dict[str, Any]:
    return {
        "orderName": order_name,
        "shopifyOrderGid": shopify.get("id"),
        "orderCreatedAt": shopify.get("createdAt"),
        "shopifyFinancialStatus": shopify.get("displayFinancialStatus"),
        "shopifyFulfillmentStatus": shopify.get("displayFulfillmentStatus"),
        "shopifyRiskRecommendation": ((shopify.get("risk") or {}).get("recommendation") or "NONE"),
        "saleTransactionCount": _successful_sale_count(shopify),
        "excludedByTag": bool({str(tag).upper() for tag in (shopify.get("tags") or [])}.intersection(
            {"INTERNAL", "TEST", "CANARY", "DO_NOT_FULFILL"}
        )),
    }


def build_snapshot(*, now: datetime | None = None) -> dict[str, Any]:
    generated = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    token = get_token()
    inventory, conflicts = discover_inventory(token)
    names = set(inventory) | set(conflicts)
    shopify_rows = shopify_operational_summaries(names)
    records: list[dict[str, Any]] = []
    provider_errors: list[dict[str, str]] = []

    for order_name, link in inventory.items():
        shopify = shopify_rows.get(order_name) or {}
        base = _base_record(order_name, shopify)
        if base["excludedByTag"]:
            continue
        try:
            response = cj_request(
                "GET",
                "shopping/order/getOrderDetail",
                params={"orderId": link["cj_order_id"]},
                token=token,
            )
            detail = response.get("data") or {}
            tracking_number = str(detail.get("trackNumber") or "").strip()
            tracking = _track_snapshot(token, tracking_number)
            raw = {
                **base,
                "providerOrderReference": link["rescue"],
                "cjStatus": detail.get("orderStatus"),
                "cjSubStatus": detail.get("subStatus"),
                "cjCreatedAt": detail.get("createDate"),
                "cjPaymentAt": detail.get("paymentDate"),
                "outWarehouseAt": detail.get("outWarehouseTime"),
                "trackingPresent": bool(tracking_number),
                "trackingLast4": tracking_number[-4:] if tracking_number else None,
                "trackingProvider": detail.get("trackingProvider") or detail.get("logisticName"),
                "duplicateCjRecords": False,
                **tracking,
            }
            records.append(score_shipment(raw, now=generated))
        except Exception as exc:
            provider_errors.append({"orderName": order_name, "error": type(exc).__name__})
            records.append(score_shipment({
                **base,
                "providerOrderReference": link["rescue"],
                "cjStatus": "UNKNOWN",
                "trackingPresent": False,
                "trackingRoutes": [],
                "duplicateCjRecords": False,
                "sourceAgreement": "UNAVAILABLE",
            }, now=generated))

    for order_name, rows in conflicts.items():
        shopify = shopify_rows.get(order_name) or {}
        base = _base_record(order_name, shopify)
        if base["excludedByTag"]:
            continue
        records.append(score_shipment({
            **base,
            "providerOrderReference": f"{len(rows)} CJ records",
            "cjStatus": "CONFLICT",
            "trackingPresent": any(bool(str(row.get("trackNumber") or "").strip()) for row in rows),
            "trackingRoutes": [],
            "duplicateCjRecords": True,
        }, now=generated))

    records.sort(
        key=lambda row: (
            {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "MONITORING": 3}.get(str(row.get("severity")), 9),
            -int(str(row.get("orderName") or "#0").lstrip("#") or 0),
        )
    )
    missing_shopify = sorted(names - set(shopify_rows))
    return {
        "schemaVersion": 1,
        "runId": f"shipment_run_{uuid.uuid4().hex}",
        "generatedAt": generated.isoformat(),
        "timeZone": "Asia/Jerusalem",
        "sourceHealth": {
            "shopify": "CURRENT" if not missing_shopify else "PARTIAL",
            "cj": "CURRENT" if not provider_errors else "PARTIAL",
            "shopifyMissingOrders": missing_shopify,
            "cjReadErrorCount": len(provider_errors),
            "duplicateCjOrderCount": len(conflicts),
        },
        "orders": records,
    }


def publish_snapshot(snapshot: dict[str, Any]) -> None:
    url = os.getenv("SHIPMENT_BRIDGE_URL", "").strip()
    token = os.getenv("SHIPMENT_BRIDGE_TOKEN", "").strip()
    if not url or not token:
        raise RuntimeError("SHIPMENT_BRIDGE_URL or SHIPMENT_BRIDGE_TOKEN is not configured")
    payload = json.dumps(snapshot, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "NovaHair-Shipment-Monitor/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"Shipment bridge returned HTTP {exc.code}: {body}") from None
    if not body.get("ok"):
        raise RuntimeError(f"Shipment bridge rejected snapshot: {body}")


def publish_if_due(*, force: bool = False, now: datetime | None = None) -> bool:
    moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    slot = _latest_due_slot(moment)
    if not force and _read_state().get("lastSlot") == slot:
        return False
    snapshot = build_snapshot(now=moment)
    publish_snapshot(snapshot)
    _write_state(slot, str(snapshot["runId"]))
    counts: dict[str, int] = {}
    for record in snapshot["orders"]:
        severity = str(record.get("severity") or "UNKNOWN")
        counts[severity] = counts.get(severity, 0) + 1
    log(f"published {snapshot['runId']} for {slot}: {counts}")
    return True

