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

# Where the parcel physically is, read from CJ's own event remarks. Ordered by
# progress; the most advanced matching event wins, so a repeated "arrived at
# customs" scan after "released from customs" does not move the parcel back.
STAGE_RULES: tuple[tuple[str, int, str, tuple[str, ...]], ...] = (
    ("LABEL_CREATED", 1, "Label created, warehouse packing", ("label created", "warehouse is processing", "shipment information received", "pre-shipment")),
    ("CN_WAREHOUSE", 2, "Left the CJ warehouse (China)", ("china warehouse", "e-post china", "picked up", "arrived at sorting", "shenzhen", "send to hongkong", "sent to hongkong")),
    ("TO_HONG_KONG", 3, "In Hong Kong, waiting for flight", ("arrived in hongkong", "arrived at hongkong", "hong kong", "hongkong", "waiting for flight")),
    ("IN_AIR", 4, "Departed Hong Kong, flying to Israel", ("departed from hongkong", "departed from hong kong", "flight departed", "departed")),
    ("IL_AIRPORT", 5, "Arrived at TLV airport", ("tlv airport", "arrived at tlv", "arrived at destination airport", "arrived in israel")),
    ("IL_CUSTOMS", 6, "In Israeli customs", ("israel customs", "arrived at customs", "customs clearance")),
    ("IL_CUSTOMS_RELEASED", 7, "Released from customs", ("released from customs", "customs released", "cleared customs")),
    ("IL_LAST_MILE", 8, "With the Israeli courier, heading to pickup point", ("prepared to be sent to pickup point", "sent to pickup point", "out for delivery", "in transit to pickup", "handed to local carrier", "last mile")),
    ("IL_READY_FOR_PICKUP", 9, "Waiting at the pickup point", ("ready for pickup", "arrived at pickup point", "available for pickup", "awaiting collection")),
    ("DELIVERED", 10, "Delivered", ("delivered", "collected by recipient", "picked up by recipient")),
)
ISRAEL_STAGES = {"IL_AIRPORT", "IL_CUSTOMS", "IL_CUSTOMS_RELEASED", "IL_LAST_MILE", "IL_READY_FOR_PICKUP"}


def tracking_stage(routes: list[dict[str, Any]]) -> tuple[str, int, str]:
    """Return (stage, progress, label) for the most advanced CJ event."""
    best = ("UNKNOWN", 0, "No carrier scan yet")
    for route in routes:
        remark = str(route.get("remark") or "").strip().lower()
        if not remark:
            continue
        for stage, progress, label, terms in STAGE_RULES:
            if any(term in remark for term in terms) and progress > best[1]:
                best = (stage, progress, label)
    return best


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
    stage, stage_progress, stage_label = tracking_stage(routes)
    latest_route = max(routes, key=lambda route: parse_moment(route.get("acceptTime")) or datetime.min.replace(tzinfo=timezone.utc)) if moments else None
    latest_remark = str((latest_route or {}).get("remark") or "").strip() or None
    in_israel = stage in ISRAEL_STAGES
    last_mile = stage in {"IL_LAST_MILE", "IL_READY_FOR_PICKUP"}
    delivered = "DELIVERED" in {cj_status, tracking_status.upper(), shopify_fulfillment} or stage == "DELIVERED"
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

    # CJ's warehouse routinely takes 4-6 business days between the label and
    # the first physical scan on this lane; alerting at day 2 painted half the
    # board red for parcels that were simply being packed.
    physical_movement = bool(out_warehouse) or _has_physical_movement(routes)
    if tracking_present and not physical_movement and not delivered:
        if label_business_days >= 8:
            signals.append(_signal(
                "LABEL_NO_PICKUP_CRITICAL", "CRITICAL", f"Label without pickup for {label_business_days} business days",
                "Escalate to CJ now and request a physical pickup scan or a replacement plan.",
                "CJ",
            ))
        elif label_business_days >= 5:
            signals.append(_signal(
                "LABEL_NO_PICKUP_WARNING", "HIGH", f"Label without pickup for {label_business_days} business days",
                "Ask CJ to confirm when the parcel will physically leave the warehouse.",
                "CJ",
            ))

    # A parcel waiting at an Israeli pickup point legitimately shows no scans
    # for days; only silence before the last mile is a carrier problem.
    stale_threshold = 6 if last_mile else 3
    if tracking_present and physical_movement and not delivered and inactive_days >= stale_threshold:
        signals.append(_signal(
            "TRACKING_STALE", "MEDIUM", f"No tracking update for {inactive_days} days ({stage_label})",
            "Request a movement update and prepare a customer update if the carrier cannot confirm progress.",
            "CJ",
        ))

    # The day count alone is not the emergency; a parcel that cleared Israeli
    # customs on day 17 needs no remedy. What needs one is a parcel that is
    # both late and silent, or late beyond any normal transit.
    moving = latest_tracking_at is not None and inactive_days < 4
    if not delivered and (order_business_days >= 22 or (order_business_days >= 14 and not moving and not in_israel)):
        signals.append(_signal(
            "DAY_14_SOLUTION_DUE", "CRITICAL",
            f"Not delivered after {order_business_days} business days, no movement for {inactive_days} days" if latest_tracking_at else f"Not delivered after {order_business_days} business days",
            "Choose a concrete remedy for the customer; do not send another waiting-only reply.",
            "Customer + CJ",
        ))
    elif not delivered and order_business_days >= 14:
        signals.append(_signal(
            "DAY_14_MOVING", "MEDIUM", f"Day {order_business_days}: {stage_label}",
            "Late but moving; the proactive delivery update goes out automatically. Watch for the next scan.",
            "Monitor",
        ))
    elif not delivered and order_business_days >= 10 and not moving and not in_israel:
        signals.append(_signal(
            "DAY_10_CUSTOMER_UPDATE", "HIGH", f"Business day {order_business_days}, no movement for {inactive_days} days",
            "Ask CJ for a movement update; the proactive customer update goes out automatically.",
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
        "MONITORING", "MONITORING",
        (stage_label if stage != "UNKNOWN" else "Moving normally") if tracking_present else "Within the normal preparation window",
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
        "trackingStage": stage if tracking_present else None,
        "trackingStageLabel": stage_label if tracking_present else None,
        "latestRemark": latest_remark,
        "inIsrael": in_israel,
        "trackingCreatedAt": label_at.isoformat() if label_at else None,
        "cjSubStatus": cj_sub_status or None,
    }
