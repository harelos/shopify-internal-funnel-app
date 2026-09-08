# AI Support email delivery runbook

This runbook defines what the support product may claim about an outbound email. It contains no mailbox credentials, customer content, or customer identifiers.

## Delivery states

| Product state | Evidence | What it proves |
| --- | --- | --- |
| Queued | A support draft is `QUEUED_TO_SEND` | The reply is waiting for the single Railway connector. Nothing has been sent yet. |
| Sending | The connector atomically claimed the draft | One worker owns the attempt. It does not prove SMTP acceptance. |
| SMTP accepted | Namecheap accepted the RFC 5322 message | The sender transferred the message to Namecheap. It does not prove recipient inbox placement. |
| Sent copy verified | The exact deterministic Message-ID is present in the Namecheap Sent folder | The transmitted message has a durable mailbox copy and can be reconciled after a worker restart. |
| Failed | SMTP, Sent-folder append, verification, or bridge acknowledgement failed | Human review or a guarded retry is required. |
| Bounced | A delivery-status notification was matched to the deterministic Message-ID | The receiving system rejected the message after submission. Bounce ingestion remains a separate follow-up checkpoint. |

Never label SMTP acceptance or a Sent-folder copy as “delivered to customer.” Recipient inbox placement requires recipient-provider delivery evidence that standard Namecheap SMTP does not expose.

## Idempotency and crash recovery

- Every AI support draft has one deterministic Message-ID: `support-draft-<draft-id>@tigerbrandsglobal.com`.
- Before sending, the connector searches the Sent folder for that exact Message-ID.
- After SMTP acceptance, the connector appends the exact transmitted message to Sent and verifies it can be found.
- Only after those checks does the connector acknowledge the draft as sent.
- If a process dies after SMTP acceptance, the next run finds the existing Sent copy and acknowledges it without resending.
- The Worker exposes a bounded pending-verification feed so the agent can backfill Sent-folder evidence for earlier sends.

## Domain authentication

The Support Inbox performs a cached, read-only DNS check for:

- Namecheap Private Email MX
- A single SPF record authorizing `spf.privateemail.com`
- Private Email DKIM at either supported selector
- DMARC policy

On 2026-09-08, live DNS had working Namecheap MX and DKIM plus DMARC in monitoring mode, but no apex SPF TXT record. This is a deliverability risk. Do not add a Namecheap-only SPF record until every legitimate sending service for the domain is inventoried; multiple SPF records are invalid and all authorized senders must be consolidated into one record.

## Inbox scope

- A visible support conversation must contain an inbound customer message, Hebrew or mixed-language service history, or verified Shopify-order context.
- Outbound-only English vendor, finance, infrastructure, and account-operation threads stay preserved in the mailbox but are excluded from the Support workspace.
- The mailbox connector applies the same rule before ingestion: outbound mail is imported only when it belongs to an accepted inbound thread or is itself Hebrew customer-service content.
- The filter is non-destructive. It changes product scope and future ingestion; it does not delete mailbox evidence.

## Approval-gated voice learning

- Historic owner replies enter the review queue as `PENDING_REVIEW`; they are not automatically used as model examples.
- Only examples explicitly marked `APPROVED` may be supplied to the support model.
- Rejected examples remain excluded from generation.
- The embedded Support workspace shows the approved store facts and lets the owner approve or reject voice examples without exposing raw analytics identifiers.

## Safe deployment order

1. Run the Worker tests and TypeScript build.
2. Deploy the Worker API backward-compatibly.
3. Confirm the embedded Support page and bridge status remain healthy.
4. Run the mailbox-agent tests.
5. Deploy the single Railway agent replica.
6. Observe `SUCCESS` for the exact Railway deployment.
7. Confirm a fresh heartbeat and Sent-copy reconciliation in the Support page.
8. Keep the Windows scheduled fallback disabled while Railway is active.

## Incident response

- **Agent heartbeat stale:** keep queued replies intact, inspect Railway runtime logs, and do not start a second sender.
- **Draft is failed:** review the recorded error, correct the underlying issue, then use the guarded retry action.
- **Sent copy missing:** do not acknowledge the draft as sent. The deterministic Message-ID prevents an unbounded resend.
- **Customer says no email arrived:** verify the Sent copy, check domain authentication, search for a bounce, and ask the customer to check spam. Do not claim inbox delivery without evidence.
- **Duplicate response suspected:** search the Sent folder by deterministic Message-ID before any retry.
