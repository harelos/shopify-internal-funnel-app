# NovaHair Sidecart Speed Rollback

- Store: `jacobfelipe.myshopify.com`
- Live theme: `Updated copy of Dawn`
- Live theme ID: `182172320039`
- Release commit: `d844c10d5268cd46f701d746f9f3971833047501`
- Main merge commit: `4cc49a579db91b32eba423d25c7a2c084a78b8f3`
- Release PR: `https://github.com/harelos/tigerbrandsglobal-shopify-theme/pull/17`

This directory contains the exact live files captured immediately before the
targeted speed deployment.

## Original SHA-256

- `assets/cart-drawer.js`: `7A26BB33459AD4398716D13FB0FDE5F40F7B9DE301DBAECC8B6A39DA0214C311`
- `assets/sales-page-commerce-adapter.js`: `6CB51A48C55F515E1E0D928B2B7ED6E654D288BD9112AEC8D26EBF05D1A7BF2C`
- `snippets/cart-drawer-novafunnel.liquid`: `A9C19EEF632EF20823685F994FE7AACE300E85F146A69F1B54F93145A2077FF3`

## Restore

From this directory, push only these three files back to theme `182172320039`
with deletion disabled. Do not publish or switch themes.
