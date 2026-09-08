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
        ), now=NOW)
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
        self.assertEqual(scored["primarySignal"], "MULTIPLE_SALE_TRANSACTIONS")
        self.assertEqual(scored["severity"], "MEDIUM")
        self.assertTrue(scored["afterSellLikely"])

    def test_carrier_exception_is_same_day_critical(self):
        scored = score_shipment(self.base(
            trackingPresent=True,
            trackingStatus="Exception",
            outWarehouseAt="2026-09-08 10:00:00",
            trackingRoutes=[{"acceptTime": "2026-09-08 11:00:00", "remark": "Delivery failed"}],
        ), now=NOW)
        self.assertEqual(scored["primarySignal"], "CARRIER_EXCEPTION")
        self.assertEqual(scored["severity"], "CRITICAL")

    def test_provider_failure_keeps_source_unavailable(self):
        scored = score_shipment(self.base(sourceAgreement="UNAVAILABLE"), now=NOW)
        self.assertEqual(scored["sourceAgreement"], "UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
