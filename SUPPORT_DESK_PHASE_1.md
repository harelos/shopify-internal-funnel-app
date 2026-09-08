# AI Support Inbox — Phase 1

## Outcome

Phase 1 adds a development-only customer-support foundation to the existing
Shopify app. It reuses the established Namecheap IMAP credentials and imports
both Inbox and Sent mail, so the response system learns from actual owner
replies rather than a fabricated voice profile.

## Included

- Responsive Shopify-admin Support Inbox.
- Namecheap Inbox and Sent synchronization through the existing connector.
- Message threading, deduplication and customer history.
- Owner reply examples paired with the inbound messages they answered.
- Shopify customer, order, line-item, fulfillment and tracking lookup.
- Structured AI decisions: reply, wait or escalate.
- Human review, edit, approve and reject workflow.
- Low-risk auto-send mode behind explicit safety switches.
- Append-only evidence timeline with chained SHA-256 integrity hashes.
- Attachment metadata and content hashes without copying attachments into D1.
- SMTP outbox claims, deterministic Message-IDs and stale-claim recovery.
- Deterministic mailbox triage before AI or database ingestion.
- Prospect, unverified-customer and verified-customer classification.
- Visible agent heartbeat, next scan time and filtered-message counts.
- Agent-facing bearer API and MCP tools for sync/list/read/draft/approve/status.
- Existing AI Concierge OpenRouter model ladder, with customer PII redacted
  before community/free model calls.

## Hard safety rules

The following categories always escalate and never auto-send:

- Chargeback or payment dispute.
- Refund or cancellation request.
- Legal or regulatory threat.
- Product safety, injury, allergy or medical concern.
- Address change.
- Fraud allegation.
- Any response containing an unverified claim.

Auto-send additionally requires all of the following:

- Mailbox mode is `AUTOSEND_LOW_RISK`.
- `SUPPORT_MAIL_SEND_ENABLED=true` on the mail bridge.
- The AI confidence is at least 92%.
- A Shopify order was verified for customer-specific questions. A general
  pre-sale shipping question may use only approved public shipping facts.
- No policy rule requires escalation.

The initial recommended mode is `DRAFT_ONLY`.

## Secrets and runtime configuration

Do not commit these values:

- `OPENROUTER_API_KEY` — app secret, reused from AI Concierge.
- `SUPPORT_CONNECTOR_TOKEN` — same random secret in app and mail bridge.
- Existing `NAMECHEAP_PRIVATE_EMAIL_USER` and
  `NAMECHEAP_PRIVATE_EMAIL_PASSWORD` — reused by the bridge.
- `SUPPORT_APP_URL` — hosted app URL used by the bridge.

Optional configuration:

- `SUPPORT_OPENROUTER_MODEL` optionally pins an approved model; otherwise the
  tested free/low-cost Concierge ladder is used.
- `SUPPORT_AI_DRAFTS_ENABLED=true` enables scheduled drafting.
- `SUPPORT_MAIL_SEND_ENABLED=true` enables SMTP delivery of approved/eligible
  queued drafts.
- `SUPPORT_INITIAL_IMPORT_DAYS` defaults to 730 for the first historical sync.
- `SUPPORT_SYNC_INTERVAL_MS` defaults to 120000.

## Release sequence

1. Review and merge the isolated feature branch after the other developer's
   popup work is reconciled.
2. Apply `migrations/0012_support_desk.sql` to D1.
3. Configure app secrets and deploy the app without enabling auto-send.
4. Run one historical mail sync and verify Inbox/Sent thread pairing.
5. Review learned response examples and generated drafts.
6. Enable scheduled drafts in `DRAFT_ONLY` mode.
7. Only after a monitored review window, optionally enable low-risk auto-send.

No live page, popup, storefront cart or checkout code is modified by Phase 1.
