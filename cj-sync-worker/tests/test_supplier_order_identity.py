import unittest

from cj_order_state import (
    choose_supplier_order,
    payment_flag_changes,
    shopify_number_of,
    status_tag_changes,
    supplier_orders_for,
)


class SupplierOrderIdentityTests(unittest.TestCase):
    """One sale, one supplier order, whichever system placed it."""

    def test_every_purchase_prefix_names_the_sale(self):
        self.assertEqual(shopify_number_of("RESCUE-4470"), 4470)
        self.assertEqual(shopify_number_of("AUTO-4470"), 4470)
        self.assertEqual(shopify_number_of("auto-4470"), 4470)
        self.assertEqual(shopify_number_of("MANUAL-4453"), 4453)
        self.assertEqual(shopify_number_of("BACKFILL-4400"), 4400)

    def test_shadow_and_test_rows_are_not_purchases(self):
        self.assertIsNone(shopify_number_of("#4470"))
        self.assertIsNone(shopify_number_of("TEST-PIPELINE-1788209457"))
        self.assertIsNone(shopify_number_of(""))

    def test_an_auto_order_counts_as_existing(self):
        # 2026-09-18: the worker saw no RESCUE-4470, ignored AUTO-4470, and
        # bought the parcel again nine minutes after it had been paid for.
        auto = {"orderNum": "AUTO-4470", "orderStatus": "UNSHIPPED", "paymentDate": "2026-09-18 17:19:09"}
        existing = {"AUTO-4470": [auto], "#4470": [{"orderNum": "#4470", "orderStatus": "CREATED"}], "RESCUE-4471": [{}]}
        self.assertEqual(supplier_orders_for(existing, 4470), [auto])
        self.assertEqual(supplier_orders_for(existing, 4472), [])


class ChooseSupplierOrderTests(unittest.TestCase):
    def test_paid_copy_outranks_unpaid_duplicate(self):
        paid = {"orderNum": "AUTO-4470", "orderStatus": "UNSHIPPED", "paymentDate": "2026-09-18 17:19:09", "createDate": "2026-09-16 04:02:10"}
        extra = {"orderNum": "RESCUE-4470", "orderStatus": "CREATED", "paymentDate": None, "createDate": "2026-09-18 17:28:46"}
        chosen, reason = choose_supplier_order([extra, paid])
        self.assertIs(chosen, paid)
        self.assertEqual(reason, "unpaid_extra")

    def test_two_paid_copies_are_handed_to_a_person(self):
        first = {"orderNum": "RESCUE-4454", "orderStatus": "UNSHIPPED", "paymentDate": "2026-09-17 00:19:31"}
        second = {"orderNum": "RESCUE-4454", "orderStatus": "UNSHIPPED", "paymentDate": "2026-09-18 17:19:09"}
        self.assertEqual(choose_supplier_order([first, second]), (None, "paid_twice"))

    def test_newest_unpaid_copy_when_nothing_is_paid(self):
        old = {"orderNum": "MANUAL-4453", "orderStatus": "CREATED", "createDate": "2026-09-16 02:17:14"}
        new = {"orderNum": "RESCUE-4453", "orderStatus": "CREATED", "createDate": "2026-09-18 01:00:00"}
        chosen, reason = choose_supplier_order([old, new])
        self.assertIs(chosen, new)
        self.assertEqual(reason, "unpaid_ambiguous")
        self.assertEqual(choose_supplier_order([old]), (old, "unpaid"))

    def test_trash_rows_are_ignored(self):
        trash = {"orderNum": "RESCUE-4448", "orderStatus": "TRASH", "paymentDate": "2026-09-14 11:00:00"}
        live = {"orderNum": "MANUAL-4448", "orderStatus": "UNSHIPPED", "paymentDate": "2026-09-16 02:27:00"}
        self.assertEqual(choose_supplier_order([trash, live]), (live, "paid"))
        self.assertEqual(choose_supplier_order([trash]), (None, "none"))


class PaymentFlagTests(unittest.TestCase):
    """The owner reads CJ_PAID to know a supplier order has been paid for."""

    def test_paid_stamps_the_flag_and_clears_unpaid(self):
        self.assertEqual(payment_flag_changes([], "paid"), (["CJ_PAID"], []))
        self.assertEqual(payment_flag_changes(["CJ_UNPAID"], "paid"), (["CJ_PAID"], ["CJ_UNPAID"]))
        self.assertEqual(payment_flag_changes(["CJ_PAID"], "paid"), ([], []))

    def test_unpaid_stamps_unpaid_and_clears_paid(self):
        self.assertEqual(payment_flag_changes(["CJ_PAID"], "unpaid"), (["CJ_UNPAID"], ["CJ_PAID"]))
        self.assertEqual(payment_flag_changes(["CJ_UNPAID"], "unpaid"), ([], []))

    def test_unknown_state_changes_nothing(self):
        self.assertEqual(payment_flag_changes(["CJ_PAID"], "unknown"), ([], []))

    def test_status_tag_changes_leave_the_flag_alone(self):
        add, remove = status_tag_changes(["CJ_PAID", "CJ_STATUS_PAYMENT_REQUIRED", "CJ_AGE_DAYS_2"], "CJ_STATUS_PAID")
        self.assertEqual(add, ["CJ_STATUS_PAID"])
        self.assertEqual(remove, ["CJ_STATUS_PAYMENT_REQUIRED"])
        add, remove = status_tag_changes(["CJ_PAID", "CJ_STATUS_PAID"], "CJ_STATUS_FULFILLED")
        self.assertEqual(add, ["CJ_STATUS_FULFILLED"])
        self.assertEqual(remove, ["CJ_STATUS_PAID"])


if __name__ == "__main__":
    unittest.main()
