import unittest
from datetime import datetime, timezone

from shipment_risk import business_days_between, parse_moment, score_shipment


NOW = datetime(2026, 9, 8, 12, 0, tzinfo=timezone.utc)


class ShipmentRiskTests(unittest.TestCase):
    def base(self, **overrides):
        value = {
            "orderName": "#5000",
            "orderCreatedAt": "2026-09-01T09:00:00+03:00",
            "cjCreatedAt": "2026-09-01 14:00:00",
            "cjPaymentAt": "2026-09-01 15:00:00",
            "cjStatus": "UNSHIPPED",
            "cjSubStatus": "PROCESSING",
            "trackingPresent": False,
            "trackingRoutes": [],
            "shopifyFulfillmentStatus": "UNFULFILLED",
            "shopifyFinancialStatus": "PAID",
            "shopifyRiskRecommendation": "ACCEPT",
            "saleTransactionCount": 1,
        }
        value.update(overrides)
        return value

    def test_israel_business_days_exclude_friday_and_saturday(self):
        start = parse_moment("2026-09-03T10:00:00+03:00")  # Thursday
        self.assertEqual(business_days_between(start, NOW), 3)  # Sun, Mon, Tue

    def test_missing_tracking_becomes_critical_after_five_business_days(self):
        scored = score_shipment(self.base(), now=NOW)
        self.assertEqual(scored["primarySignal"], "TRACKING_NOT_FOUND_CRITICAL")
        self.assertEqual(scored["severity"], "CRITICAL")
        self.assertEqual(scored["contactTarget"], "CJ")

    def test_label_without_pickup_uses_label_timestamp(self):
        scored = score_shipment(self.base(
            trackingPresent=True,
            trackingStatus="Processing",
            trackingRoutes=[{
                "acceptTime": "2026-09-01 06:50:33",
                "remark": "Label created. Warehouse is processing this order.",
            }],
        ), now=NOW)  # five business days after the label: warn, not yet critical
        self.assertEqual(scored["primarySignal"], "LABEL_NO_PICKUP_WARNING")
        scored = score_shipment(self.base(
            trackingPresent=True,
            trackingStatus="Processing",
            trackingRoutes=[{"acceptTime": "2026-08-26 06:50:33", "remark": "Label created. Warehouse is processing this order."}],
        ), now=NOW)  # nine business days
        self.assertEqual(scored["primarySignal"], "LABEL_NO_PICKUP_CRITICAL")

    def test_real_movement_prevents_false_label_only_alert(self):
        scored = score_shipment(self.base(
            orderCreatedAt="2026-09-06T09:00:00+03:00",
            cjCreatedAt="2026-09-06 14:00:00",
            cjPaymentAt="2026-09-06 15:00:00",
            cjStatus="SHIPPED",
            trackingPresent=True,
            trackingStatus="En Route",
            outWarehouseAt="2026-09-06 18:00:00",
            trackingRoutes=[{
                "acceptTime": "2026-09-08 20:08:20",
                "remark": "Send to Hongkong",
            }],
        ), now=NOW)
        self.assertEqual(scored["severity"], "MONITORING")

    def test_unpaid_cj_order_is_high_priority_even_when_new(self):
        scored = score_shipment(self.base(
            orderCreatedAt="2026-09-08T08:00:00+03:00",
            cjCreatedAt="2026-09-08 13:00:00",
            cjPaymentAt=None,
            cjStatus="IN_CART",
        ), now=NOW)
        self.assertEqual(scored["primarySignal"], "CJ_PAYMENT_REQUIRED")
        self.assertEqual(scored["severity"], "HIGH")

    def test_multiple_sales_are_review_only(self):
        scored = score_shipment(self.base(
            orderCreatedAt="2026-09-08T08:00:00+03:00",
            cjCreatedAt="2026-09-08 13:00:00",
            cjPaymentAt="2026-09-08 13:05:00",
            cjStatus="PROCESSING",
            trackingPresent=True,
            outWarehouseAt="2026-09-08 14:00:00",
            trackingStatus="En Route",
            trackingRoutes=[{"acceptTime": "2026-09-08 15:00:00", "remark": "In transit"}],
            saleTransactionCount=2,
        ), now=NOW)
        # the post-purchase upsell charges separately: a note for support, never a task
        self.assertEqual(scored["primarySignal"], "MULTIPLE_SALE_TRANSACTIONS")
        self.assertEqual(scored["severity"], "MONITORING")
        self.assertFalse(scored["isActionable"])
        self.assertTrue(scored["afterSellLikely"])

    def test_medium_risk_is_informational_once_fulfilled(self):
        scored = score_shipment(self.base(
            orderCreatedAt="2026-09-08T08:00:00+03:00",
            cjCreatedAt="2026-09-08 13:00:00",
            cjPaymentAt="2026-09-08 13:05:00",
            cjStatus="PROCESSING",
            trackingPresent=True,
            outWarehouseAt="2026-09-08 14:00:00",
            trackingStatus="En Route",
            trackingRoutes=[{"acceptTime": "2026-09-08 15:00:00", "remark": "In transit"}],
            shopifyRiskRecommendation="INVESTIGATE",
            shopifyFulfillmentStatus="FULFILLED",
        ), now=NOW)
        self.assertEqual(scored["primarySignal"], "SHOPIFY_MEDIUM_RISK")
        self.assertEqual(scored["severity"], "MONITORING")
        self.assertFalse(scored["isActionable"])

    def test_carrier_exception_is_same_day_critical(self):
        scored = score_shipment(self.base(
            trackingPresent=True,
            trackingStatus="Exception",
            outWarehouseAt="2026-09-08 10:00:00",
            trackingRoutes=[{"acceptTime": "2026-09-08 11:00:00", "remark": "Delivery failed"}],
        ), now=NOW)
        self.assertEqual(scored["primarySignal"], "CARRIER_EXCEPTION")
        self.assertEqual(scored["severity"], "CRITICAL")

    def test_parcel_released_from_israeli_customs_is_not_critical_on_day_17(self):
        # #4364 on 2026-09-15: ordered 2026-08-24, cleared customs that day.
        now = datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc)
        scored = score_shipment(self.base(
            orderCreatedAt="2026-08-24T10:00:00+03:00",
            cjStatus="SHIPPED",
            trackingPresent=True,
            trackingStatus="En Route",
            trackingRoutes=[
                {"acceptTime": "2026-09-15 12:56:59", "remark": "Parcel prepared to be sent to pickup point"},
                {"acceptTime": "2026-09-15 12:36:58", "remark": "Released from customs"},
                {"acceptTime": "2026-09-15 12:36:53", "remark": "Arrived at customs"},
                {"acceptTime": "2026-09-11 18:01:30", "remark": "Arrived at TLV Airport"},
                {"acceptTime": "2026-09-11 09:38:17", "remark": "Departed from HongKong"},
                {"acceptTime": "2026-09-08 10:07:49", "remark": "Arrived at E-post china warehouse"},
                {"acceptTime": "2026-08-31 06:36:44", "remark": "Label created. Warehouse is processing this order."},
            ],
        ), now=now)
        self.assertEqual(scored["trackingStage"], "IL_LAST_MILE")
        self.assertTrue(scored["inIsrael"])
        self.assertEqual(scored["latestRemark"], "Parcel prepared to be sent to pickup point")
        self.assertNotEqual(scored["severity"], "CRITICAL")
        self.assertEqual(scored["primarySignal"], "DAY_14_MOVING")
        self.assertIn("pickup point", scored["statusLabel"])

    def test_late_and_silent_parcel_is_still_critical(self):
        now = datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc)
        scored = score_shipment(self.base(
            orderCreatedAt="2026-08-24T10:00:00+03:00",
            cjStatus="SHIPPED",
            trackingPresent=True,
            trackingRoutes=[
                {"acceptTime": "2026-09-05 09:38:17", "remark": "Departed from HongKong"},
                {"acceptTime": "2026-09-01 10:07:49", "remark": "Arrived at E-post china warehouse"},
            ],
        ), now=now)
        self.assertEqual(scored["primarySignal"], "DAY_14_SOLUTION_DUE")
        self.assertEqual(scored["severity"], "CRITICAL")

    def test_day_twelve_parcel_that_is_moving_stays_green(self):
        now = datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc)
        scored = score_shipment(self.base(
            orderCreatedAt="2026-08-30T10:00:00+03:00",
            cjStatus="SHIPPED",
            trackingPresent=True,
            trackingRoutes=[{"acceptTime": "2026-09-14 09:38:17", "remark": "Departed from HongKong"}],
        ), now=now)
        self.assertEqual(scored["severity"], "MONITORING")
        self.assertEqual(scored["statusLabel"], "Departed Hong Kong, flying to Israel")

    def test_label_without_pickup_waits_five_business_days_before_alerting(self):
        scored = score_shipment(self.base(
            trackingPresent=True,
            trackingRoutes=[{"acceptTime": "2026-09-04 10:00:00", "remark": "Label created. Warehouse is processing this order."}],
        ), now=NOW)  # 2 business days: Sun, Mon
        self.assertEqual(scored["severity"], "MONITORING")

    def test_provider_failure_keeps_source_unavailable(self):
        scored = score_shipment(self.base(sourceAgreement="UNAVAILABLE"), now=NOW)
        self.assertEqual(scored["sourceAgreement"], "UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
