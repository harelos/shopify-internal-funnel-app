"""Pure shipment-risk scoring for the Commerce OS operations bridge.

The scorer never contacts customers, pays CJ, cancels an order, or issues a
refund.  It translates reconciled Shopify + CJ evidence into an owner-facing
priority and a plain-English next action.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo


ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
CJ_TZ = ZoneInfo("Asia/Shanghai")
ISRAEL_WEEKEND = {4, 5}  # Friday and Saturday

SEVERITY_WEIGHT = {
    "MONITORING": 0,
    "MEDIUM": 1,
    "HIGH": 2,
    "CRITICAL": 3,
}

EXCEPTION_TERMS = (
    "exception",
    "failed delivery",
    "delivery failed",
    "undeliverable",
    "return to sender",
    "returned to sender",
    "shipment returned",
    "delivery failure",
)

LABEL_ONLY_TERMS = (
    "label created",
    "warehouse is processing",
    "shipment information received",
    "pre-shipment",
)


def parse_moment(value: Any, *, naive_tz: ZoneInfo = CJ_TZ) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=naive_tz)
    return parsed.astimezone(timezone.utc)


def business_days_between(start: datetime | None, end: datetime) -> int:
    """Count completed Israeli business dates after ``start`` through ``end``."""
    if start is None:
        return 0
    start_date = start.astimezone(ISRAEL_TZ).date()
    end_date = end.astimezone(ISRAEL_TZ).date()
    if end_date <= start_date:
        return 0
    cursor = start_date + timedelta(days=1)
    total = 0
    while cursor <= end_date:
        if cursor.weekday() not in ISRAEL_WEEKEND:
            total += 1
        cursor += timedelta(days=1)
    return total


def elapsed_days(start: datetime | None, end: datetime) -> int:
    if start is None:
        return 0
    return max(0, int((end - start).total_seconds() // 86_400))


def _route_moments(routes: list[dict[str, Any]]) -> list[datetime]:
    return [moment for route in routes if (moment := parse_moment(route.get("acceptTime")))]


def _has_physical_movement(routes: list[dict[str, Any]]) -> bool:
    for route in routes:
        remark = str(route.get("remark") or "").strip().lower()
        if remark and not any(term in remark for term in LABEL_ONLY_TERMS):
            return True
    return False


def _has_exception(tracking_status: str, routes: list[dict[str, Any]]) -> bool:
    evidence = " ".join(
        [tracking_status, *[str(route.get("remark") or "") for route in routes]]
    ).lower()
    return any(term in evidence for term in EXCEPTION_TERMS)


def _signal(
    code: str,
    severity: str,
    label: str,
    action: str,
    contact: str,
) -> dict[str, str]:
    return {
        "code": code,
        "severity": severity,
        "label": label,
        "action": action,
        "contact": contact,
    }


def score_shipment(record: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    order_created = parse_moment(record.get("orderCreatedAt"), naive_tz=ISRAEL_TZ)
    cj_created = parse_moment(record.get("cjCreatedAt"))
    cj_paid = parse_moment(record.get("cjPaymentAt"))
    out_warehouse = parse_moment(record.get("outWarehouseAt"))
    routes = list(record.get("trackingRoutes") or [])
    moments = _route_moments(routes)
    label_at = min(moments) if moments else parse_moment(record.get("trackingCreatedAt"))
    latest_tracking_at = max(moments) if moments else None
    order_business_days = business_days_between(order_created, now)
    label_business_days = business_days_between(label_at, now)
    inactive_days = elapsed_days(latest_tracking_at, now)
    cj_status = str(record.get("cjStatus") or "UNKNOWN").strip().upper()
    cj_sub_status = str(record.get("cjSubStatus") or "").strip().upper()
    tracking_status = str(record.get("trackingStatus") or "").strip()
    tracking_present = bool(record.get("trackingPresent"))
    shopify_fulfillment = str(record.get("shopifyFulfillmentStatus") or "").upper()
    shopify_financial = str(record.get("shopifyFinancialStatus") or "").upper()
    shopify_risk = str(record.get("shopifyRiskRecommendation") or "NONE").upper()
    sale_count = int(record.get("saleTransactionCount") or 0)
    duplicate_cj = bool(record.get("duplicateCjRecords"))
    delivered = "DELIVERED" in {cj_status, tracking_status.upper(), shopify_fulfillment}
    signals: list[dict[str, str]] = []

    if duplicate_cj:
        signals.append(_signal(
            "DUPLICATE_CJ_RECORDS", "CRITICAL", "More than one CJ record",
            "Resolve the duplicate CJ records before any further fulfillment action.",
            "Internal + CJ",
        ))

    if shopify_financial in {"REFUNDED", "VOIDED"} and cj_status not in {"CANCELLED", "CLOSED", "UNKNOWN"}:
        signals.append(_signal(
            "REFUND_FULFILLMENT_CONFLICT", "CRITICAL", "Refund and fulfillment conflict",
            "Stop and reconcile Shopify payment state with CJ before the parcel progresses.",
            "Internal + CJ",
        ))

    if _has_exception(tracking_status, routes):
        signals.append(_signal(
            "CARRIER_EXCEPTION", "CRITICAL", "Carrier exception",
            "Escalate to CJ today and prepare a concrete customer solution for approval.",
            "CJ + Customer",
        ))

    payment_required = cj_status in {"CREATED", "IN_CART", "UNPAID"} and not cj_paid
    if payment_required:
        signals.append(_signal(
            "CJ_PAYMENT_REQUIRED", "HIGH", "CJ payment or confirmation required",
            "Confirm CJ payment and processing status today. Do not promise dispatch until CJ confirms.",
            "CJ",
        ))

    lifecycle_start = cj_paid or cj_created or order_created
    lifecycle_business_days = business_days_between(lifecycle_start, now)
    if not tracking_present and not payment_required and not delivered:
        if lifecycle_business_days >= 5:
            signals.append(_signal(
                "TRACKING_NOT_FOUND_CRITICAL", "CRITICAL", f"No tracking after {lifecycle_business_days} business days",
                "Open a CJ escalation now and request proof of warehouse handoff.",
                "CJ",
            ))
        elif lifecycle_business_days >= 2:
            signals.append(_signal(
                "TRACKING_NOT_FOUND_WARNING", "HIGH", f"No tracking after {lifecycle_business_days} business days",
                "Ask CJ for the expected tracking and warehouse handoff time.",
                "CJ",
            ))

    physical_movement = bool(out_warehouse) or _has_physical_movement(routes)
    if tracking_present and not physical_movement and not delivered:
        if label_business_days >= 5:
            signals.append(_signal(
                "LABEL_NO_PICKUP_CRITICAL", "CRITICAL", f"Label without pickup for {label_business_days} business days",
                "Escalate to CJ now and request a physical pickup scan or a replacement plan.",
                "CJ",
            ))
        elif label_business_days >= 2:
            signals.append(_signal(
                "LABEL_NO_PICKUP_WARNING", "HIGH", f"Label without pickup for {label_business_days} business days",
                "Ask CJ to confirm when the parcel will physically leave the warehouse.",
                "CJ",
            ))

    if tracking_present and physical_movement and not delivered and inactive_days >= 3:
        signals.append(_signal(
            "TRACKING_STALE", "MEDIUM", f"No tracking update for {inactive_days} days",
            "Request a movement update and prepare a customer update if the carrier cannot confirm progress.",
            "CJ",
        ))

    if not delivered and order_business_days >= 14:
        signals.append(_signal(
            "DAY_14_SOLUTION_DUE", "CRITICAL", f"Not delivered after {order_business_days} business days",
            "Choose a concrete remedy for the customer; do not send another waiting-only reply.",
            "Customer + CJ",
        ))
    elif not delivered and order_business_days >= 10:
        signals.append(_signal(
            "DAY_10_CUSTOMER_UPDATE", "HIGH", f"Customer update due on business day {order_business_days}",
            "Draft a proactive delivery update for your approval today.",
            "Customer",
        ))

    if shopify_risk == "CANCEL":
        signals.append(_signal(
            "SHOPIFY_HIGH_RISK", "HIGH", "Shopify recommends urgent risk review",
            "Review the order manually today. Do not cancel automatically.",
            "Internal",
        ))
    elif shopify_risk == "INVESTIGATE":
        signals.append(_signal(
            "SHOPIFY_MEDIUM_RISK", "MEDIUM", "Shopify recommends manual review",
            "Review the Shopify risk evidence before taking any order action.",
            "Internal",
        ))

    if sale_count > 1:
        signals.append(_signal(
            "MULTIPLE_SALE_TRANSACTIONS", "MEDIUM", f"{sale_count} successful SALE transactions",
            "Review Shopify transactions and AfterSell before explaining the total charge to the customer.",
            "Internal",
        ))

    signals.sort(key=lambda item: SEVERITY_WEIGHT[item["severity"]], reverse=True)
    primary = signals[0] if signals else _signal(
        "MONITORING", "MONITORING", "Moving normally" if tracking_present else "Within the normal preparation window",
        "No action needed. Keep monitoring the next verified milestone.",
        "Monitor",
    )
    return {
        **record,
        "severity": primary["severity"],
        "primarySignal": primary["code"],
        "statusLabel": primary["label"],
        "doNow": primary["action"],
        "contactTarget": primary["contact"],
        "signals": signals,
        "isActionable": bool(signals),
        "orderBusinessDays": order_business_days,
        "labelBusinessDays": label_business_days,
        "inactiveDays": inactive_days,
        "delivered": delivered,
        "sourceAgreement": str(
            record.get("sourceAgreement")
            or ("CONFLICT" if duplicate_cj else "VERIFIED")
        ),
        "afterSellLikely": sale_count > 1,
        "latestTrackingAt": latest_tracking_at.isoformat() if latest_tracking_at else None,
        "trackingCreatedAt": label_at.isoformat() if label_at else None,
        "cjSubStatus": cj_sub_status or None,
    }
