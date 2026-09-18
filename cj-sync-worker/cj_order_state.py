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
# CJ_PAID is not historical any more: it is the sticky ledger flag written by
# payment_flag_changes below and must survive every status change, so it is
# deliberately absent from this set.
LEGACY_OPERATIONAL_TAGS = {
    PAYMENT_REQUIRED_TAG,
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
    """Return (tags_to_add, tags_to_remove) for the current CJ state.

    Legacy scheme, kept for its tests; the monitor writes one status tag via
    current_status_tag and the ledger flag via payment_flag_changes.
    """
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


PAID_FLAG_TAG = PAID_TAG
UNPAID_FLAG_TAG = "CJ_UNPAID"
PURCHASE_RE = re.compile(r"^(?:RESCUE|AUTO|MANUAL|BACKFILL)-(\d+)$", re.IGNORECASE)


def shopify_number_of(order_num: str) -> int | None:
    """The Shopify order number a purchased CJ order belongs to, under any prefix.

    RESCUE- is this worker's, AUTO- the Cloudflare Worker's (every order since
    2026-09-16), MANUAL- and BACKFILL- a person's. The store's own shadow row
    ("#4470") is the connection seeing the sale, not a purchase, and answers
    None.
    """
    match = PURCHASE_RE.match(str(order_num or "").strip())
    return int(match.group(1)) if match else None


def supplier_orders_for(existing: dict[str, list[dict[str, Any]]], number: int) -> list[dict[str, Any]]:
    """Every live CJ order for one sale, whichever system placed it.

    Looking only for RESCUE-{n} is how this worker bought seventeen parcels a
    second time on 2026-09-18: the Cloudflare Worker had already filed each of
    them as AUTO-{n}, and the owner had paid for them nine minutes earlier.
    """
    rows: list[dict[str, Any]] = []
    for order_num, copies in existing.items():
        if shopify_number_of(order_num) == number:
            rows.extend(copies)
    return rows


def choose_supplier_order(copies: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    """The one CJ order that stands for a sale, and why.

    A paid copy outranks any unpaid one; among unpaid copies the newest wins.
    Two paid copies means the parcel was bought twice, which no rule can pick
    between, so the sale is handed back ("paid_twice") for a person.
    """
    live = [row for row in copies if str(row.get("orderStatus") or "").upper() != "TRASH"]
    if not live:
        return None, "none"
    paid = [row for row in live if classify_cj_payment(row) == "paid"]
    unpaid = [row for row in live if classify_cj_payment(row) != "paid"]
    if len(paid) > 1:
        return None, "paid_twice"
    if paid:
        return paid[0], "unpaid_extra" if unpaid else "paid"
    newest = sorted(unpaid, key=lambda row: str(row.get("createDate") or ""))[-1]
    return newest, "unpaid_ambiguous" if len(unpaid) > 1 else "unpaid"


def payment_flag_changes(current_tags: list[str], payment_state: str) -> tuple[list[str], list[str]]:
    """The ledger flag the owner reads: CJ_PAID once the supplier order is paid, CJ_UNPAID until then.

    Unlike the status tag, which moves on to tracking and fulfilment, this one
    stays put: an order paid at CJ keeps saying so.
    """
    if payment_state == "paid":
        return effective_tag_changes(current_tags, [PAID_FLAG_TAG], [UNPAID_FLAG_TAG])
    if payment_state == "unpaid":
        return effective_tag_changes(current_tags, [UNPAID_FLAG_TAG], [PAID_FLAG_TAG])
    return [], []
