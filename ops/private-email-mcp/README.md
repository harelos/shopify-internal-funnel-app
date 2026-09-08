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

On Windows, install the persistent hidden watcher for the current user as a
local fallback:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-support-agent-task.ps1
```

The task starts immediately, restarts the watcher after a process failure, runs
again at sign-in and is allowed to run on battery. A PID lock in
`.data/support-agent.lock` prevents a second local watcher. Keep this task
disabled while the Railway worker is active so there is only one sender.

## Always-on Railway worker

`src/support-worker-server.mjs` runs the same guarded bridge as a single
always-on web service. It exposes a secret-free `/health` response and executes
one mailbox cycle per minute. The production service is isolated from the
existing NovaHair OTP sender:

```text
https://tiger-support-email-agent-production.up.railway.app/health
```

Deploy this directory as its own Railway service. Start with
`SUPPORT_MAIL_SEND_ENABLED=false`, verify at least one successful cycle, disable
the Windows fallback, and only then enable cloud sending. Railway must remain at
one replica; mailbox and bridge credentials are stored as service variables.

Outbound delivery is disabled by default. Set `SUPPORT_MAIL_SEND_ENABLED=true`
only after the app is in the desired `DRAFT_ONLY` or `AUTOSEND_LOW_RISK` mode.
Approving a draft queues it; the bridge sends it through the existing Namecheap
SMTP account and reports the sent Message-ID back to the evidence timeline.
The worker then verifies the exact deterministic Message-ID in the Namecheap
Sent folder. A read-only operational check can be run with
`npm run support:check-sent -- support-draft-<draft-id>@tigerbrandsglobal.com`;
it prints only the presence result and never mailbox credentials or message content.

## Run the MCP locally

```powershell
npm install
npm run start:mcp
```

The process speaks MCP over stdio and is intended to be started by Codex. The
Windows wrapper reads the user-level environment variables at process start so
the Codex config never contains the mailbox password.

To run the hosted-worker process locally instead:

```powershell
npm start
```
