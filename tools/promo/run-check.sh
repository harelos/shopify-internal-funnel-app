#!/usr/bin/env bash
# Daily promotion check. Reads the Shopify credentials from the Foundry vault so
# no secret is ever written to disk or passed on a command line.
set -euo pipefail
cd /c/Users/Lenovo/Desktop/mission-control-sandbox
export SHOP=$(node -e "console.log(require('./foundry-vault.js').revealSecret('shopify_shop_domain'))")
export VER=$(node -e "console.log(require('./foundry-vault.js').revealSecret('shopify_api_version'))")
export TOKEN=$(node -e "console.log(require('./foundry-vault.js').revealSecret('shopify.admin_token'))")
cd "C:/Users/Lenovo/Documents/Codex/2026-08-30/files-pasted-by-the-user-c/work/novahair-lifecycle-handoff/tools/promo"
PYTHONIOENCODING=utf-8 python promo_check.py
