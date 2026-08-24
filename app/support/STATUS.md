# Current status

Implemented scaffolding:
- Environment-gated support configuration.
- Read-only mailbox abstraction.
- Message/thread domain types.
- Deterministic thread reconstruction.
- Local Hebrew/English classification fallback.
- Read-only sync preview pipeline.

Still required before first live mailbox test:
- Wire concrete IMAPS adapter against the app runtime/dependencies.
- Add Prisma persistence models/migration.
- Add `/admin/support/` route/UI.
- Add tests and fixture mailbox reader.
