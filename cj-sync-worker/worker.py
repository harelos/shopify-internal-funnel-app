#!/usr/bin/env python3
"""Railway worker: keep Shopify -> CJ order sync running without a PC.

Every INTERVAL seconds:
  1. create CJ orders for new paid NovaHair bundle orders
  2. push real CJ tracking numbers back into Shopify

Same code, guarantees and safety rails as the local scripts - it never pays,
is idempotent on RESCUE-{order}, and holds orders with undeliverable addresses.
Secrets come from Railway env vars (CJ_API_KEY, SHOPIFY_PII_TOKEN,
SHOPIFY_ACCESS_TOKEN, SHOPIFY_SHOP_DOMAIN); there is no .env in the cloud.
"""

from __future__ import annotations

import os
import sys
import time
import traceback
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

INTERVAL = int(os.getenv("SYNC_INTERVAL_SECONDS", "900"))  # 15 min default
LOOKBACK_DAYS = int(os.getenv("SYNC_LOOKBACK_DAYS", "7"))


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


def one_cycle() -> None:
    import sync_novahair_orders_to_cj as sync
    import monitor_cj_tracking_to_shopify as monitor

    log("cycle start: creating CJ orders")
    try:
        sync.run(apply=True, days=LOOKBACK_DAYS, limit=0, emit_rows=False)
    except SystemExit as exc:            # scripts use SystemExit for clean stops
        log(f"sync stopped: {exc}")
    except Exception:
        log("sync ERROR:\n" + traceback.format_exc())

    log("cycle: pushing tracking to Shopify")
    try:
        monitor.run(apply=True, emit_rows=False)
    except SystemExit as exc:
        log(f"monitor stopped: {exc}")
    except Exception:
        log("monitor ERROR:\n" + traceback.format_exc())

    log("cycle done")


def main() -> int:
    required = ["CJ_API_KEY", "SHOPIFY_SHOP_DOMAIN"]
    missing = [k for k in required if not os.getenv(k)]
    if not (os.getenv("SHOPIFY_PII_TOKEN") or os.getenv("SHOPIFY_ACCESS_TOKEN")):
        missing.append("SHOPIFY_PII_TOKEN|SHOPIFY_ACCESS_TOKEN")
    if missing:
        log(f"FATAL: missing env vars: {missing}")
        return 1

    log(f"worker up. interval={INTERVAL}s lookback={LOOKBACK_DAYS}d shop={os.getenv('SHOPIFY_SHOP_DOMAIN')}")
    while True:
        started = time.monotonic()
        try:
            one_cycle()
        except Exception:
            log("cycle CRASHED:\n" + traceback.format_exc())
        elapsed = time.monotonic() - started
        sleep_for = max(60, INTERVAL - elapsed)
        log(f"sleeping {int(sleep_for)}s")
        time.sleep(sleep_for)


if __name__ == "__main__":
    raise SystemExit(main())
