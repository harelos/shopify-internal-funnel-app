# Support Agent Phase 1 — staging only

This branch introduces a read-only customer-support ingestion module for the internal Shopify control room.

## Hard safety boundary

- STAGING/LOCAL only.
- IMAP read-only ingestion only.
- No SMTP sending.
- No customer-facing automation.
- No refunds, cancellations, reships, discounts, or Shopify mutations.
- No mailbox or Shopify credentials in source control.
- Secrets must be supplied via environment variables / host secret manager.

## Phase 1 target

1. Connect to a Namecheap Private Email mailbox over IMAPS.
2. Ingest a bounded number of recent messages.
3. Normalize and deduplicate messages.
4. Reconstruct basic support threads.
5. Persist support conversations/messages in SQLite via Prisma.
6. Expose a local `/admin/support/` dashboard.
7. Keep AI classification as an explicit local placeholder until an approved model/provider is configured.

## Environment variables

```text
SUPPORT_STAGING_ENABLED=false
SUPPORT_IMAP_HOST=mail.privateemail.com
SUPPORT_IMAP_PORT=993
SUPPORT_IMAP_SECURE=true
SUPPORT_IMAP_USERNAME=
SUPPORT_IMAP_PASSWORD=
SUPPORT_IMAP_MAILBOX=INBOX
SUPPORT_SYNC_LIMIT=250
```

`SUPPORT_IMAP_PASSWORD` must never be committed.

## Release gate

Do not enable production sending or write access as part of Phase 1.
