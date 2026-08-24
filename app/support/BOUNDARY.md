# Phase 1 boundary

The support module is intentionally non-operational against customers until later gates are approved.

Allowed now:
- Read mailbox messages over IMAPS.
- Normalize, deduplicate, thread, classify, summarize, and display them internally.
- Persist staging support data.

Forbidden now:
- SMTP/send/reply.
- Delete/move/mark customer mail as part of sync.
- Shopify mutations.
- Refunds, cancellations, reships, discounts.
- Automatic customer-facing decisions.
- Production activation.
