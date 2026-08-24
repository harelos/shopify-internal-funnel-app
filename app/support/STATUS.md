# Current status

Implemented on `staging/support-agent-phase1`:
- Explicit staging/read-only configuration boundary.
- Mailbox-source abstraction with fixture and real IMAP implementations.
- Real Namecheap-compatible IMAPS adapter for `mail.privateemail.com:993`.
- Second explicit mailbox safety gate: `SUPPORT_IMAP_READ_ENABLED=true` is required in addition to staging mode.
- IMAP mailbox opens read-only and never marks messages as read.
- Bounded historical ingestion with a per-message source-size cap.
- MIME parsing with Hebrew/UTF-8 support; attachment contents are not persisted.
- Message/thread domain types.
- Deterministic thread reconstruction with stable incremental thread keys.
- Local Hebrew/English classification fallback.
- Prisma persistence for support threads and messages.
- `/api/support/*` read-only APIs, including mailbox probe and bounded sync.
- `/admin/support.html` internal control room with conversation list, detail view, category summary, human-review flags, mailbox readiness and connection probe.
- Read-only Shopify order context per support thread, gated separately by `SUPPORT_SHOPIFY_LOOKUP_ENABLED=true`.
- Shopify lookup uses the customer email from the support thread, requests only a reduced order/fulfillment/tracking shape, and does not persist the returned Shopify payload.
- Support UI can load order status, payment status, line items, fulfillment status and tracking links on demand.
- Dashboard link from the existing internal app.
- Tests for threading, classification safety defaults, IMAP gating, MIME parsing and Shopify context helpers.
- GitHub Actions support-staging CI and lockfile refresh automation.
- `package-lock.json` refreshed after adding `imapflow` and `postal-mime`.

Current safe modes:

## Fixture mode

```text
SUPPORT_STAGING_ENABLED=true
SUPPORT_SYNC_SOURCE=fixture
SUPPORT_IMAP_READ_ENABLED=false
SUPPORT_SHOPIFY_LOOKUP_ENABLED=false
```

## Real Namecheap read-only staging mode

```text
SUPPORT_STAGING_ENABLED=true
SUPPORT_SYNC_SOURCE=imap
SUPPORT_IMAP_READ_ENABLED=true
SUPPORT_MAILBOX_ADDRESS=<support mailbox address>
SUPPORT_IMAP_HOST=mail.privateemail.com
SUPPORT_IMAP_PORT=993
SUPPORT_IMAP_SECURE=true
SUPPORT_IMAP_USERNAME=<stored only in staging secrets>
SUPPORT_IMAP_PASSWORD=<stored only in staging secrets>
SUPPORT_IMAP_MAILBOX=INBOX
SUPPORT_SYNC_LIMIT=250
SUPPORT_IMAP_MAX_SOURCE_BYTES=2097152
```

## Optional Shopify read-only support context

```text
SUPPORT_SHOPIFY_LOOKUP_ENABLED=true
SUPPORT_SHOPIFY_ORDER_LIMIT=5
SHOPIFY_LIVE_CONNECT=true
```

The installed Shopify app still needs its normal authenticated Admin API path and `read_orders` scope. The support module does not add a write scope and does not expose any Shopify mutation.

Before the first real mailbox sync:
1. Configure credentials only in the staging host secret manager.
2. Keep `SUPPORT_SYNC_LIMIT` small for the first test (recommended 25-50).
3. Use **Test mailbox connection** first. It opens the mailbox read-only and only returns mailbox metadata/count.
4. Confirm the UI still shows `READ_ONLY_STAGING`.
5. Run a bounded sync.
6. Manually inspect reconstructed threads and Hebrew content before increasing the sync window.
7. Only after that, enable `SUPPORT_SHOPIFY_LOOKUP_ENABLED=true` and test order lookup on a few known support threads.

Still explicitly out of scope:
- SMTP sending.
- Automatic customer replies.
- AI-generated reply sending.
- Refunds/cancellations/reships/discounts.
- Shopify mutations.
- Production enablement.

Next engineering gate after real mailbox + Shopify read-only validation:
- AI-generated reply drafts that cannot be sent automatically.
- Knowledge-base grounding from approved store policies/product instructions.
- Human approval workflow before any future send capability is considered.
