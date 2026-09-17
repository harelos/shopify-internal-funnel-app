import os
import unittest
from unittest import mock

import worker


class WorkerGateTests(unittest.TestCase):
    """Since 2026-09-17 the Cloudflare Worker owns CJ order creation."""

    def test_creation_is_off_unless_asked(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SYNC_CREATE_ORDERS", None)
            self.assertFalse(worker.create_orders_enabled())
        with mock.patch.dict(os.environ, {"SYNC_CREATE_ORDERS": "true"}):
            self.assertTrue(worker.create_orders_enabled())
        with mock.patch.dict(os.environ, {"SYNC_CREATE_ORDERS": "0"}):
            self.assertFalse(worker.create_orders_enabled())
        with mock.patch.dict(os.environ, {"SYNC_CREATE_ORDERS": " YES "}):
            self.assertTrue(worker.create_orders_enabled())


if __name__ == "__main__":
    unittest.main()
