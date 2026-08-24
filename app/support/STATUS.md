# Current status

Implemented on `staging/support-agent-phase1`:
- Explicit staging/read-only configuration boundary.
- Mailbox-source abstraction with fixture implementation and unwired IMAP gate.
- Message/thread domain types.
- Deterministic thread reconstruction with stable incremental thread keys.
- Local Hebrew/English classification fallback.
- Prisma persistence for support threads and messages.
- `/api/support/*` read-only APIs plus fixture sync endpoint.
- `/admin/support.html` internal control room with conversation list, detail view, category summary and human-review flags.
- Dashboard link from the existing internal app.
- Tests for threading, classification safety defaults and stable thread IDs.

Current runnable source:
- `SUPPORT_SYNC_SOURCE=fixture`
- No email can be sent.
- No Shopify write action exists.

Still required before first real Namecheap mailbox test:
- Add a mature read-only IMAPS adapter for `mail.privateemail.com:993`.
- Add/install its audited dependency and lockfile update.
- Configure mailbox credentials only in the staging secret manager.
- Run build/tests and a bounded historical sync against a non-production copy of the database.

Still explicitly out of scope:
- SMTP sending.
- Automatic customer replies.
- Refunds/cancellations/reships/discounts.
- Shopify mutations.
