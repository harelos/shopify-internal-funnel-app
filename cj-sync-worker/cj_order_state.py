"""Pure CJ payment-state helpers shared by the Railway worker and tests."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo


PAYMENT_REQUIRED_TAG = "CJ_PAYMENT_REQUIRED"
PAID_TAG = "CJ_PAID"
ORDER_CREATED_TAG = "CJ_ORDER_CREATED"
UNSHIPPED_TAG = "CJ_UNSHIPPED_PENDING"
LEGACY_MISLEADING_TAG = "CJ_PAID_PENDING_TRACKING"
TRACKING_RECEIVED_TAG = "CJ_TRACKING_RECEIVED"
TRACKING_ADDED_TAG = "CJ_TRACKING_ADDED"
FULFILLED_TAG = "CJ_FULFILLED_FROM_TRACKING"
AGE_TAG_RE = re.compile(r"^CJ_AGE_DAYS_(\d+)$", re.IGNORECASE)
ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")

STATUS_PAYMENT_REQUIRED = "CJ_STATUS_PAYMENT_REQUIRED"
STATUS_PAID = "CJ_STATUS_PAID"
STATUS_TRACKING_RECEIVED = "CJ_STATUS_TRACKING_RECEIVED"
STATUS_FULFILLED = "CJ_STATUS_FULFILLED"
CURRENT_STATUS_TAGS = {
    STATUS_PAYMENT_REQUIRED,
    STATUS_PAID,
    STATUS_TRACKING_RECEIVED,
    STATUS_FULFILLED,
}
LEGACY_OPERATIONAL_TAGS = {
    PAYMENT_REQUIRED_TAG,
    PAID_TAG,
    ORDER_CREATED_TAG,
    UNSHIPPED_TAG,
    LEGACY_MISLEADING_TAG,
    TRACKING_RECEIVED_TAG,
    TRACKING_ADDED_TAG,
    FULFILLED_TAG,
    "CJ_RESCUE",
}
RESCUE_TAG_RE = re.compile(r"^RESCUE-\d+$", re.IGNORECASE)

UNPAID_STATUSES = {"CREATED", "IN_CART", "UNPAID"}
PAID_LIFECYCLE_STATUSES = {
    "UNSHIPPED",
    "PROCESSING",
    "DISPATCHED",
    "SHIPPED",
    "DELIVERED",
}


def classify_cj_payment(order: dict[str, Any]) -> str:
    """Return paid, unpaid, or unknown using authoritative CJ order fields.

    paymentDate is the primary signal. Later fulfillment lifecycle statuses are
    accepted as paid because CJ cannot process or ship an unpaid order.
    """
    payment_date = str(order.get("paymentDate") or "").strip()
    if payment_date:
        return "paid"

    status = str(order.get("orderStatus") or "").strip().upper()
    if status in UNPAID_STATUSES:
        return "unpaid"
    if status in PAID_LIFECYCLE_STATUSES:
        return "paid"
    return "unknown"


def payment_tag_plan(order: dict[str, Any], has_tracking: bool) -> tuple[list[str], list[str]]:
    """Return (tags_to_add, tags_to_remove) for the current CJ state."""
    state = classify_cj_payment(order)
    if state == "unpaid":
        return (
            [ORDER_CREATED_TAG, PAYMENT_REQUIRED_TAG],
            [PAID_TAG, UNSHIPPED_TAG, TRACKING_RECEIVED_TAG, LEGACY_MISLEADING_TAG],
        )
    if state == "paid":
        if has_tracking:
            return (
                [ORDER_CREATED_TAG, TRACKING_RECEIVED_TAG],
                [PAYMENT_REQUIRED_TAG, PAID_TAG, UNSHIPPED_TAG, LEGACY_MISLEADING_TAG],
            )
        add = [ORDER_CREATED_TAG, PAID_TAG, UNSHIPPED_TAG]
        remove = [PAYMENT_REQUIRED_TAG, TRACKING_RECEIVED_TAG, LEGACY_MISLEADING_TAG]
        return add, remove
    return [], []


def effective_tag_changes(
    current_tags: list[str], tags_to_add: list[str], tags_to_remove: list[str]
) -> tuple[list[str], list[str]]:
    """Drop no-op tag mutations so recurring reconciliation stays cheap."""
    current = {str(tag).strip().upper() for tag in current_tags}
    add = [tag for tag in tags_to_add if tag.upper() not in current]
    remove = [tag for tag in tags_to_remove if tag.upper() in current]
    return add, remove


def _parse_datetime(value: str | None) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def elapsed_order_days(
    created_at: str,
    *,
    now: datetime | None = None,
    completed_at: str | None = None,
) -> int:
    """Calendar days since the Shopify order, using Israel's local date."""
    created = _parse_datetime(created_at)
    if created is None:
        raise ValueError("Invalid Shopify createdAt")
    end = _parse_datetime(completed_at) or now or datetime.now(timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return max(0, (end.astimezone(ISRAEL_TZ).date() - created.astimezone(ISRAEL_TZ).date()).days)


def age_tag_changes(current_tags: list[str], days: int) -> tuple[list[str], list[str]]:
    desired = f"CJ_AGE_DAYS_{days}"
    old_age_tags = [tag for tag in current_tags if AGE_TAG_RE.match(str(tag).strip())]
    return effective_tag_changes(current_tags, [desired], [tag for tag in old_age_tags if tag.upper() != desired])


def has_age_tag(tags: list[str]) -> bool:
    return any(AGE_TAG_RE.match(str(tag).strip()) for tag in tags)


def current_status_tag(
    order: dict[str, Any], *, has_tracking: bool, shopify_fulfilled: bool
) -> str | None:
    if has_tracking and shopify_fulfilled:
        return STATUS_FULFILLED
    if has_tracking:
        return STATUS_TRACKING_RECEIVED
    payment = classify_cj_payment(order)
    if payment == "paid":
        return STATUS_PAID
    if payment == "unpaid":
        return STATUS_PAYMENT_REQUIRED
    return None


def status_tag_changes(current_tags: list[str], desired_status: str | None) -> tuple[list[str], list[str]]:
    """Keep exactly one current CJ status tag and remove historical CJ tags."""
    desired_upper = str(desired_status or "").upper()
    remove: list[str] = []
    for raw_tag in current_tags:
        tag = str(raw_tag).strip()
        upper = tag.upper()
        is_managed = (
            upper in CURRENT_STATUS_TAGS
            or upper in LEGACY_OPERATIONAL_TAGS
            or bool(RESCUE_TAG_RE.match(tag))
        )
        if is_managed and upper != desired_upper:
            remove.append(tag)
    add = [desired_status] if desired_status and desired_upper not in {str(t).strip().upper() for t in current_tags} else []
    return add, remove
