# Try the Support Agent in GitHub Codespaces

This is a staging-only playground. It uses fixture data and deliberately disables live Shopify reads, mailbox access, customer email sending, and Shopify mutations.

## Launch

Open this branch in GitHub Codespaces:

`https://codespaces.new/harelos/shopify-internal-funnel-app?ref=staging/support-agent-phase1`

GitHub will create the environment, install dependencies, validate/generate Prisma, and start the Node app. Port 3000 is configured to auto-forward and open in the browser.

If the browser does not open automatically, use the **Ports** tab in Codespaces and open port `3000`.

Useful routes:

- `/admin/` — internal control room
- `/admin/support.html` — customer support staging UI
- `/api/support/status` — safety/readiness state
- `/api/support/agent/replay` — synthetic regression suite

## Safety boundary

The Codespaces default configuration intentionally sets:

- `SHOPIFY_LIVE_CONNECT=false`
- `SUPPORT_IMAP_READ_ENABLED=false`
- `SUPPORT_SHOPIFY_LOOKUP_ENABLED=false`
- `SUPPORT_SHOPIFY_CUSTOMER_LOOKUP_ENABLED=false`
- `SUPPORT_KNOWLEDGE_ENABLED=false`

The current support-agent result also hardcodes:

- `sendAllowed=false`
- `shopifyMutationAllowed=false`

Do not put real mailbox passwords or Shopify access tokens into the repository. If live staging credentials are used later, store them as Codespaces/hosting secrets, not committed files.
