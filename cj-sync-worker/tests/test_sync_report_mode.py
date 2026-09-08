import datetime as dt
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

os.environ.setdefault("CJ_API_KEY", "test-key")
os.environ.setdefault("SHOPIFY_ACCESS_TOKEN", "test-shopify-token")
os.environ["CJ_RECONCILE_MODE"] = "report"
os.environ["ORDER_SETTLE_SECONDS"] = "600"

import novahair_manifest as manifest
import sync_novahair_orders_to_cj as sync


def paid_order(*extra_lines: dict, created_at: str = "2026-09-01T00:00:00Z") -> dict:
    return {
        "id": 9000,
        "order_number": 5000,
        "created_at": created_at,
        "financial_status": "paid",
        "cancelled_at": None,
        "fulfillment_status": None,
        "tags": "",
        "line_items": [
            {
                "id": 101,
                "variant_id": 999,
                "sku": "NOVASALE-4-4-0-0-0-0",
                "quantity": 1,
                "requires_shipping": True,
            },
            *extra_lines,
        ],
    }


class SyncReportModeTests(unittest.TestCase):
    def run_sync(self, order: dict, existing: dict) -> list[dict]:
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            sync, "LOG_PATH", Path(temp_dir) / "audit.json"
        ), mock.patch.object(sync, "get_token", return_value="token"), mock.patch.object(
            sync, "shopify_paid_orders", return_value=[order]
        ), mock.patch.object(
            sync.rescue, "existing_cj_orders", return_value=existing
        ), mock.patch.object(
            sync.rescue, "cj_variant_catalog", return_value={}
        ), mock.patch.object(
            sync.rescue, "load_supplement", return_value={}
        ):
            sync.run(apply=True, days=7, limit=0, emit_rows=False)
            return json.loads(sync.LOG_PATH.read_text(encoding="utf-8"))

    def test_existing_mismatch_is_reported_without_create_or_delete(self) -> None:
        order = paid_order(
            {
                "id": 202,
                "variant_id": 50459892580647,
                "sku": "CJJT228873001AZ",
                "quantity": 1,
                "requires_shipping": True,
            }
        )
        existing = {
            "RESCUE-5000": [{"orderId": "cj-5000", "orderStatus": "CREATED"}]
        }
        detail = {
            "orderId": "cj-5000",
            "orderStatus": "CREATED",
            "paymentDate": None,
            "trackNumber": None,
            "productList": [
                {"vid": manifest.COMPONENTS[0][1], "quantity": 4},
                {"vid": manifest.GIFT[1], "quantity": 1},
            ],
        }

        with mock.patch.object(sync.rescue, "detail_for", return_value=detail), mock.patch.object(
            sync.rescue, "create_one"
        ) as create_one, mock.patch.object(sync.rescue, "cj_request") as cj_request:
            rows = self.run_sync(order, existing)

        self.assertEqual(rows[0]["action"], "CJ_MANIFEST_DRIFT_REPORT")
        self.assertTrue(rows[0]["replaceable_candidate"])
        create_one.assert_not_called()
        cj_request.assert_not_called()

    def test_recent_order_waits_without_creating(self) -> None:
        created_at = dt.datetime.now(dt.timezone.utc).isoformat()
        order = paid_order(created_at=created_at)

        with mock.patch.object(sync.rescue, "create_one") as create_one:
            rows = self.run_sync(order, {})

        self.assertEqual(rows[0]["action"], "WAITING_FOR_ORDER_SETTLE")
        self.assertGreater(rows[0]["remaining_seconds"], 0)
        create_one.assert_not_called()

    def test_settled_new_order_passes_complete_manifest_to_normal_create(self) -> None:
        order = paid_order(
            {
                "id": 203,
                "variant_id": 52010595320103,
                "sku": "CJYD231269201AZ",
                "quantity": 1,
                "requires_shipping": True,
            }
        )
        created = {
            "action": "CREATED_ORDER_PICKING",
            "cj_order_id": "cj-new",
            "cj_status": "CREATED",
            "is_complete": 1,
            "placeholder_zip": "no",
        }

        with mock.patch.object(
            sync.rescue, "create_one", return_value=created
        ) as create_one:
            rows = self.run_sync(order, {})

        self.assertEqual(rows[0]["action"], "CREATED_ORDER_PICKING")
        manifest_items = create_one.call_args.kwargs["manifest_items"]
        addon = next(item for item in manifest_items if item["source_kind"] == "physical_addon")
        self.assertEqual(addon["key"], "argan_hair_mask_500g")
        self.assertEqual(addon["store_line_item_id"], "203")

    def test_unknown_physical_item_blocks_normal_create(self) -> None:
        order = paid_order(
            {
                "id": 204,
                "variant_id": 51885840138535,
                "sku": "CJYD3068279",
                "quantity": 1,
                "requires_shipping": True,
            }
        )

        with mock.patch.object(sync.rescue, "create_one") as create_one:
            rows = self.run_sync(order, {})

        self.assertEqual(rows[0]["action"], "NEEDS_MAPPING")
        create_one.assert_not_called()

    def test_unapproved_reconcile_mode_refuses_to_run(self) -> None:
        with mock.patch.dict(os.environ, {"CJ_RECONCILE_MODE": "replace_created"}):
            with self.assertRaisesRegex(RuntimeError, "before Gate B approval"):
                sync.reconcile_mode()


if __name__ == "__main__":
    unittest.main()
