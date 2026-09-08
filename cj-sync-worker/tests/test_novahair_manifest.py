import datetime as dt
import unittest

import novahair_manifest as manifest


def bundle_line(
    sku: str = "NOVASALE-4-4-0-0-0-0", *, quantity: int = 1
) -> dict:
    return {
        "id": 101,
        "variant_id": 999,
        "sku": sku,
        "quantity": quantity,
        "requires_shipping": True,
    }


def order_with(*extra_lines: dict, created_at: str = "2026-09-08T10:00:00Z") -> dict:
    return {
        "order_number": 5000,
        "created_at": created_at,
        "line_items": [bundle_line(), *extra_lines],
    }


class NovaHairManifestTests(unittest.TestCase):
    def test_bundle_only_preserves_bottles_and_gift(self) -> None:
        result = manifest.build_order_manifest(order_with())

        self.assertEqual(
            result["composition"],
            {"black": 4, "free_kit": 1},
        )
        self.assertFalse(result["has_physical_addons"])
        self.assertEqual(result["ignored"], [])

    def test_supported_cart_cross_sell_is_included_and_traced(self) -> None:
        result = manifest.build_order_manifest(
            order_with(
                {
                    "id": 202,
                    "variant_id": 50459892580647,
                    "sku": "CJJT228873001AZ",
                    "quantity": 2,
                    "requires_shipping": True,
                    "properties": [{"name": "_NOVAFUNNEL_ROLE", "value": "CROSS_SELL"}],
                }
            )
        )

        addon = next(item for item in result["items"] if item["key"] == "hair_gloss_100ml")
        self.assertEqual(addon["quantity"], 2)
        self.assertEqual(addon["store_line_item_id"], "202")
        self.assertTrue(result["has_physical_addons"])

    def test_approved_physical_mapping_outranks_bad_shipping_flag(self) -> None:
        result = manifest.build_order_manifest(
            order_with(
                {
                    "id": 210,
                    "variant_id": 50459892580647,
                    "sku": "CJJT228873001AZ",
                    "quantity": 1,
                    "requires_shipping": False,
                }
            )
        )

        self.assertEqual(result["composition"]["hair_gloss_100ml"], 1)

    def test_supported_aftersell_line_is_included_without_property_dependency(self) -> None:
        result = manifest.build_order_manifest(
            order_with(
                {
                    "id": 203,
                    "variant_id": 52010595320103,
                    "sku": "CJYD231269201AZ",
                    "quantity": 1,
                    "requires_shipping": True,
                }
            )
        )

        self.assertEqual(result["composition"]["argan_hair_mask_500g"], 1)

    def test_live_headband_maps_to_the_cj_variant_with_the_same_reference_image(self) -> None:
        result = manifest.build_order_manifest(
            order_with(
                {
                    "id": 209,
                    "variant_id": 51885840400679,
                    "sku": "CJYD3055354",
                    "quantity": 1,
                    "requires_shipping": True,
                }
            )
        )

        addon = next(
            item for item in result["items"] if item["key"] == "beauty_headband_cc05_230"
        )
        self.assertEqual(addon["vid"], "2608130207121632101")
        self.assertEqual(addon["sku"], "CJYD305535402BY")

    def test_known_digital_guide_is_excluded(self) -> None:
        result = manifest.build_order_manifest(
            order_with(
                {
                    "id": 204,
                    "variant_id": 51880636875047,
                    "sku": "ELASTIC-DIGITAL-GUIDE",
                    "quantity": 1,
                    "requires_shipping": False,
                }
            )
        )

        self.assertEqual(result["composition"], {"black": 4, "free_kit": 1})
        self.assertEqual(result["ignored"][0]["kind"], "digital")

    def test_vip_service_is_excluded(self) -> None:
        result = manifest.build_order_manifest(
            order_with(
                {
                    "id": 205,
                    "variant_id": 51878069535015,
                    "sku": "",
                    "quantity": 1,
                    "requires_shipping": False,
                }
            )
        )

        self.assertEqual(result["ignored"][0]["kind"], "service")

    def test_unknown_physical_line_fails_closed(self) -> None:
        with self.assertRaisesRegex(manifest.NeedsMappingError, "NEEDS_MAPPING"):
            manifest.build_order_manifest(
                order_with(
                    {
                        "id": 206,
                        "variant_id": 51885840138535,
                        "sku": "CJYD3068279",
                        "quantity": 1,
                        "requires_shipping": True,
                    }
                )
            )

    def test_known_variant_with_wrong_sku_fails_closed(self) -> None:
        with self.assertRaisesRegex(manifest.NeedsMappingError, "SKU mismatch"):
            manifest.build_order_manifest(
                order_with(
                    {
                        "id": 207,
                        "variant_id": 50459892580647,
                        "sku": "WRONG-SKU",
                        "quantity": 1,
                        "requires_shipping": True,
                    }
                )
            )

    def test_manifest_diff_aggregates_duplicate_cj_rows(self) -> None:
        result = manifest.build_order_manifest(order_with())
        actual = [
            {"vid": manifest.COMPONENTS[0][1], "quantity": 2},
            {"vid": manifest.COMPONENTS[0][1], "quantity": 2},
            {"vid": manifest.GIFT[1], "quantity": 1},
        ]

        difference = manifest.manifest_diff(result["items"], actual)

        self.assertTrue(difference["matches"])
        self.assertEqual(
            difference["expected_product_fingerprint"],
            difference["actual_product_fingerprint"],
        )

    def test_manifest_diff_detects_missing_addon(self) -> None:
        result = manifest.build_order_manifest(
            order_with(
                {
                    "id": 208,
                    "variant_id": 52010652401959,
                    "sku": "CJYD268780701AZ",
                    "quantity": 1,
                    "requires_shipping": True,
                }
            )
        )
        actual = [
            {"vid": manifest.COMPONENTS[0][1], "quantity": 4},
            {"vid": manifest.GIFT[1], "quantity": 1},
        ]

        difference = manifest.manifest_diff(result["items"], actual)

        self.assertFalse(difference["matches"])
        self.assertNotIn("2512250315511638400", difference["actual"])

    def test_settle_window_uses_created_at(self) -> None:
        now = dt.datetime(2026, 9, 8, 10, 7, 30, tzinfo=dt.timezone.utc)
        remaining = manifest.settle_remaining_seconds(order_with(), 600, now=now)

        self.assertEqual(remaining, 150)

    def test_settle_window_is_complete_after_ten_minutes(self) -> None:
        now = dt.datetime(2026, 9, 8, 10, 12, tzinfo=dt.timezone.utc)
        remaining = manifest.settle_remaining_seconds(order_with(), 600, now=now)

        self.assertEqual(remaining, 0)


if __name__ == "__main__":
    unittest.main()
