# TBG Private Email MCP

Local MCP server for Namecheap Private Email. It uses IMAP over TLS and exposes
mailbox inspection plus the guarded Support Inbox bridge to Codex:

- `email_profile`
- `email_folders`
- `email_search`
- `email_read`
- `email_recent`
- `support_sync` — imports accepted Inbox/Sent threads; never sends.
- `support_agent_status` — heartbeat, filtering and queue status.
- `support_list` — filtered customer-support queue.
- `support_get` — complete thread, order context, drafts and evidence.
- `support_draft` — creates/reuses a draft; never sends.
- `support_approve` — queues one exact reply and requires `confirmSend=true`.

The server never stores credentials in the repository. It does not expose
delete, archive or bulk-mail tools. Draft creation is non-consequential;
delivery requires a separate explicit approval and is recorded in the evidence
timeline.

## Local credentials

Set these as user-level Windows environment variables, preferably using a
revocable Namecheap App Password:

```powershell
setx NAMECHEAP_PRIVATE_EMAIL_USER "support@tigerbrandsglobal.com"
setx NAMECHEAP_PRIVATE_EMAIL_PASSWORD "<revocable-app-password>"
```

The server uses `mail.privateemail.com:993` with SSL/TLS by default.

## Support Desk bridge

The same IMAP credentials are reused by `src/support-sync.mjs`; no second
mailbox connection or credential set is required. The bridge imports Inbox and
Sent messages into the app, which lets the AI learn from actual owner replies.
It also records attachment metadata and SHA-256 hashes for the evidence trail.

Before ingestion, the connector filters automated mail, newsletters, security
alerts, invoices and business solicitations. Hebrew support/sales messages are
accepted, ambiguous Hebrew messages are held for human triage, and unrelated
mail is discarded. A Shopify match later upgrades an unverified sender to a
verified customer; a pre-sale question remains a prospect.

Required bridge variables:

```powershell
setx SUPPORT_APP_URL "https://shopify-funnel-control.tigerbrands-funnel.workers.dev"
setx SUPPORT_CONNECTOR_TOKEN "<random-secret-also-configured-in-the-app>"
```

Run one synchronization:

```powershell
npm run support:sync
```

Run continuously (two-minute interval by default):

```powershell
npm run support:watch
```

Outbound delivery is disabled by default. Set `SUPPORT_MAIL_SEND_ENABLED=true`
only after the app is in the desired `DRAFT_ONLY` or `AUTOSEND_LOW_RISK` mode.
Approving a draft queues it; the bridge sends it through the existing Namecheap
SMTP account and reports the sent Message-ID back to the evidence timeline.

## Run locally

```powershell
npm install
npm start
```

The process speaks MCP over stdio and is intended to be started by Codex. The
Windows wrapper reads the user-level environment variables at process start so
the Codex config never contains the mailbox password.
