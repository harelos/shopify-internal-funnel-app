# AI Support Context

This is the repository contract for the support agent's living knowledge base.
The connected Drive source library is the provenance layer; the live, approved
content is stored in the support database and rendered as Markdown by the app.

## Where the source lives

- Drive library: `MASTER SKILLS LIBRARY`
- Knowledge area: `01_EXTRACTED_KNOWLEDGE`
- NovaHair evidence source: `05_NOVAHAIR_EVIDENCE_AND_BRAND.md`
- Source taxonomy: `00_KNOWLEDGE_TAXONOMY.md`

The source cards provide guardrails and product context. They are not a license
to copy historical prices, guarantees, reviews, or claims without current owner
approval.

## Live document

The Support workspace exposes the current generated document at:

`GET /api/support/knowledge.md`

It is generated from:

1. enabled `SupportKnowledgeFact` records;
2. `SupportVoiceExample` records with `qualityStatus = APPROVED`.

Each owner-approved reply is therefore reflected in the next generated
document automatically. Rejected, pending, escalated, and unsent drafts are
never included.

## Agent contract

- Read the generated context before drafting.
- Use approved facts as factual sources and approved replies for voice only.
- Answer the latest customer message directly, in concise natural Hebrew when
  appropriate.
- Never expose internal confidence, risk labels, policy names, or model details.
- Escalate legal, safety, medical, fraud, privacy, refund, cancellation,
  chargeback, address-change, and uncertain-identity cases.
- A draft is not a sent email. Sending remains subject to the existing approval
  and delivery-evidence gates.

## Learning loop

`Inbound message → AI draft → owner review/edit → approve → voice example`

Only the final approved owner reply enters the learning set. The generated
Markdown is a read model, not an editable prompt. This prevents accidental
learning from hallucinations, unverified claims, or malicious customer text.

