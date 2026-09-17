import unittest
from datetime import datetime, timezone

from cj_order_state import (
    age_tag_changes,
    classify_cj_payment,
    current_status_tag,
    effective_tag_changes,
    elapsed_order_days,
    payment_tag_plan,
    status_tag_changes,
)


class CjOrderStateTests(unittest.TestCase):
    def test_created_without_payment_requires_payment(self):
        order = {"orderStatus": "CREATED", "paymentDate": None}
        self.assertEqual(classify_cj_payment(order), "unpaid")
        add, remove = payment_tag_plan(order, has_tracking=False)
        self.assertEqual(add, ["CJ_ORDER_CREATED", "CJ_PAYMENT_REQUIRED"])
        self.assertIn("CJ_PAID", remove)
        self.assertIn("CJ_PAID_PENDING_TRACKING", remove)

    def test_payment_date_is_authoritative(self):
        order = {"orderStatus": "CREATED", "paymentDate": "2026-09-07 12:34:56"}
        self.assertEqual(classify_cj_payment(order), "paid")
        add, remove = payment_tag_plan(order, has_tracking=False)
        self.assertEqual(add, ["CJ_ORDER_CREATED", "CJ_PAID", "CJ_UNSHIPPED_PENDING"])
        self.assertIn("CJ_PAYMENT_REQUIRED", remove)

    def test_paid_lifecycle_status_is_a_safe_fallback(self):
        order = {"orderStatus": "UNSHIPPED", "paymentDate": None}
        self.assertEqual(classify_cj_payment(order), "paid")

    def test_tracking_removes_unshipped_tag_but_keeps_paid(self):
        order = {"orderStatus": "SHIPPED", "paymentDate": "2026-09-07 12:34:56"}
        add, remove = payment_tag_plan(order, has_tracking=True)
        self.assertIn("CJ_TRACKING_RECEIVED", add)
        self.assertIn("CJ_PAID", remove)
        self.assertIn("CJ_UNSHIPPED_PENDING", remove)

    def test_unknown_state_does_not_change_tags(self):
        order = {"orderStatus": "CLOSED", "paymentDate": None}
        self.assertEqual(classify_cj_payment(order), "unknown")
        self.assertEqual(payment_tag_plan(order, has_tracking=False), ([], []))

    def test_already_reconciled_tags_generate_no_mutations(self):
        add, remove = effective_tag_changes(
            ["CJ_ORDER_CREATED", "CJ_PAYMENT_REQUIRED", "CJ_RESCUE"],
            ["CJ_ORDER_CREATED", "CJ_PAYMENT_REQUIRED"],
            ["CJ_PAID", "CJ_PAID_PENDING_TRACKING"],
        )
        self.assertEqual(add, [])
        self.assertEqual(remove, [])

    def test_age_uses_israel_calendar_day(self):
        days = elapsed_order_days(
            "2026-09-07T20:30:00+00:00",
            now=datetime(2026, 9, 7, 22, 30, tzinfo=timezone.utc),
        )
        self.assertEqual(days, 1)

    def test_age_tag_changes_only_once_per_day(self):
        add, remove = age_tag_changes(["CJ_AGE_DAYS_2", "CJ_PAID"], 3)
        self.assertEqual(add, ["CJ_AGE_DAYS_3"])
        self.assertEqual(remove, ["CJ_AGE_DAYS_2"])
        self.assertEqual(age_tag_changes(["CJ_AGE_DAYS_3"], 3), ([], []))

    def test_exactly_one_current_status_replaces_legacy_tags(self):
        current = [
            "CJ_FULFILLED_FROM_TRACKING",
            "CJ_ORDER_CREATED",
            "CJ_PAID",
            "CJ_RESCUE",
            "CJ_TRACKING_ADDED",
            "RESCUE-4405",
            "AfterSell Upsell",
        ]
        desired = current_status_tag(
            {"orderStatus": "SHIPPED", "paymentDate": "2026-09-07 12:34:56"},
            has_tracking=True,
            shopify_fulfilled=True,
        )
        add, remove = status_tag_changes(current, desired)
        self.assertEqual(add, ["CJ_STATUS_FULFILLED"])
        self.assertEqual(len(remove), 6)
        self.assertNotIn("AfterSell Upsell", remove)

    def test_reconciled_status_does_not_write_again(self):
        add, remove = status_tag_changes(
            ["CJ_STATUS_PAYMENT_REQUIRED", "CJ_AGE_DAYS_0", "AfterSell TY Page"],
            "CJ_STATUS_PAYMENT_REQUIRED",
        )
        self.assertEqual((add, remove), ([], []))


if __name__ == "__main__":
    unittest.main()
