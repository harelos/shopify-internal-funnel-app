import os
import unittest
from unittest import mock

os.environ.setdefault("CJ_API_KEY", "test-key")
os.environ.setdefault("SHOPIFY_ACCESS_TOKEN", "test-shopify-token")

import novahair_manifest as manifest
import rescue_current_novahair_orders as rescue


class RescueManifestProductTests(unittest.TestCase):
    def setUp(self) -> None:
        self.order = {
            "id": 9000,
            "order_number": 5000,
            "line_items": [
                {
                    "id": 101,
                    "sku": "NOVASALE-4-4-0-0-0-0",
                    "quantity": 1,
                    "requires_shipping": True,
                },
                {
                    "id": 202,
                    "variant_id": 52010595320103,
                    "sku": "CJYD231269201AZ",
                    "quantity": 1,
                    "requires_shipping": True,
                },
            ],
        }
        self.expected = manifest.build_order_manifest(self.order)
        self.catalog = {
            item["vid"]: {
                "vid": item["vid"],
                "variantSku": item["sku"],
                "variantSellPrice": 1.25,
            }
            for item in self.expected["items"]
        }

    def test_direct_addon_carries_shopify_line_item_id(self) -> None:
        products = rescue.build_manifest_products(
            "token", self.expected["items"], self.catalog
        )

        addon = next(product for product in products if product["vid"] == "2503011116441608900")
        bottle = next(product for product in products if product["vid"] == manifest.COMPONENTS[0][1])
        self.assertEqual(addon["storeLineItemId"], "202")
        self.assertNotIn("storeLineItemId", bottle)

    def test_create_one_accepts_addon_without_counting_it_as_a_bottle(self) -> None:
        products = rescue.build_manifest_products(
            "token", self.expected["items"], self.catalog
        )
        detail = {
            "orderNum": "RESCUE-5000",
            "orderStatus": "CREATED",
            "isComplete": 1,
            "productList": products,
        }
        recipient = {
            "name": "Test Customer",
            "address": "1 Test Street",
            "city": "Test City",
            "province": "Test Province",
            "zip": "1234567",
            "phone": "+972500000000",
            "email": "test@example.com",
            "_placeholder_zip": "no",
        }

        with mock.patch.object(
            rescue, "recipient_from_shopify", return_value=recipient
        ), mock.patch.object(
            rescue, "apply_supplement", return_value=recipient
        ), mock.patch.object(
            rescue,
            "cj_request",
            return_value={"result": True, "data": {"orderId": "cj-new"}},
        ) as cj_request, mock.patch.object(rescue, "detail_for", return_value=detail):
            result = rescue.create_one(
                "token",
                self.order,
                self.expected["bundle_sku"],
                self.expected["composition"],
                self.catalog,
                {},
                self.expected["bottle_count"],
                {},
                manifest_items=self.expected["items"],
            )

        payload = cj_request.call_args.kwargs["payload"]
        self.assertEqual(result["action"], "CREATED_ORDER_PICKING")
        self.assertEqual(len(payload["products"]), 3)
        addon = next(product for product in payload["products"] if product["vid"] == "2503011116441608900")
        self.assertEqual(addon["storeLineItemId"], "202")


if __name__ == "__main__":
    unittest.main()
