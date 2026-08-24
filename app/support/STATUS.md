# Current status

Implemented on `staging/support-agent-phase1`:
- Explicit staging/read-only configuration boundary.
- Mailbox-source abstraction with fixture and real IMAP implementations.
- Real Namecheap-compatible IMAPS adapter for `mail.privateemail.com:993`.
- Second explicit safety gate: `SUPPORT_IMAP_READ_ENABLED=true` is required in addition to staging mode.
- IMAP mailbox opens read-only and never marks messages as read.
- Bounded historical ingestion with a per-message source-size cap.
- MIME parsing with Hebrew/UTF-8 support; attachment contents are not persisted.
- Message/thread domain types.
- Deterministic thread reconstruction with stable incremental thread keys.
- Local Hebrew/English classification fallback.
- Prisma persistence for support threads and messages.
- `/api/support/*` read-only APIs, including mailbox probe and bounded sync.
- `/admin/support.html` internal control room with conversation list, detail view, category summary, human-review flags, mailbox readiness and connection probe.
- Dashboard link from the existing internal app.
- Tests for threading, classification safety defaults, IMAP gating and MIME parsing.
- GitHub Actions support-staging CI and lockfile refresh automation.
- `package-lock.json` refreshed after adding `imapflow` and `postal-mime`.

Current safe modes:

## Fixture mode

```text
SUPPORT_STAGING_ENABLED=true
SUPPORT_SYNC_SOURCE=fixture
SUPPORT_IMAP_READ_ENABLED=false
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

Before the first real mailbox sync:
1. Configure credentials only in the staging host secret manager.
2. Keep `SUPPORT_SYNC_LIMIT` small for the first test (recommended 25-50).
3. Use **Test mailbox connection** first. It opens the mailbox read-only and only returns mailbox metadata/count.
4. Confirm the UI still shows `READ_ONLY_STAGING`.
5. Run a bounded sync.
6. Manually inspect reconstructed threads and Hebrew content before increasing the sync window.

Still explicitly out of scope:
- SMTP sending.
- Automatic customer replies.
- AI-generated reply sending.
- Refunds/cancellations/reships/discounts.
- Shopify mutations.
- Production enablement.

Next engineering gate after the first real read-only mailbox validation:
- Shopify order lookup in read-only mode using the customer email/order identifiers.
- AI-generated reply drafts that cannot be sent automatically.
- Human approval workflow before any future send capability is considered.
