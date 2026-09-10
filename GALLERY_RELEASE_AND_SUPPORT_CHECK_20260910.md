# Gallery release and customer-service capability check — 2026-09-10

## Executive status

**NOT RELEASED TO PRODUCTION.** The owner requested implementation/QA and an inspection of whether this chat can reply through the app's customer-service system. No customer message, customer draft, queue approval, support policy change, production Worker deployment, live theme edit, original page content change or production metafield write was performed.

This is not waiting for the owner to repeat their approval. The current Shopify connector explicitly excludes live-theme writes and theme publishing. No authenticated Cloudflare deployment path or custom support MCP is exposed in this chat. Do not route around those limitations with page injection, leaked credentials, or CI secrets.

## What was actually added to Shopify

Unpublished theme: **TBG GitHub Staging**, ID **188167684391**.
Only two new, uniquely named QA files were added; no pre-existing theme files were replaced:
- `snippets/nhgalleryqa20260910.liquid`
- `templates/page.nhgalleryqa20260910.liquid`

The template is opt-in through `view=nhgalleryqa20260910`. It renders the previously verified real-controls snapshot, with commerce, forms, analytics and app endpoints disabled. The Shopify SDK helper is intentionally stubbed with an error callback because this is an isolated rendering harness, not the normal layout. **This does NOT validate actual Customer Privacy API behavior, app publishing, checkout, or the Shopify app proxy.**

Native preview:
https://tigerbrandsglobal.com/pages/novahair-sales-staging?preview_theme_id=188167684391&view=nhgalleryqa20260910&variant=variant-b

Use a separate/private browser tab for review to avoid leaving a merchant browser in a theme-preview session.

Readback confirmed both files exist and the theme remains UNPUBLISHED. The real page ID `162313240871` still has `templateSuffix=novafunnel-clean` and `updatedAt=2026-09-08T02:00:49Z`.

A prior attempt to duplicate MAIN returned `newTheme:null` without userErrors; a subsequent inventory confirmed no new theme. No deletion or overwrite of another staging project was used to make room.

## Native rendering evidence

Passed run:
https://github.com/harelos/shopify-internal-funnel-app/actions/runs/34489577386

11 assertions passed, including:
- Actual QA template rendered from Shopify, not the default live page.
- Challenger first image decoded; no active control DOM in B.
- Five original shade controls and three package cards retained.
- Original color and package selection functions work.
- Purchase boundary stays simulated.
- Same sandbox identity and variant retained across reloads.
- QA template remains selected after navigation.
- No JavaScript exceptions in the isolated harness; no disallowed network requests attempted.

The first run exposed a harness issue with Shopify's preview helper and an invalid assumption that `preview_theme_id` must remain in the URL. The corrected check verifies the actual unique QA marker and alternate-template route. Shopify can remove the theme query parameter after selecting the preview; query presence alone is not reliable proof.

## NEW failing release gate: consent lifecycle

Failure reproduced against the ACTUAL candidate gallery JavaScript in synthetic LIVE mode:
https://github.com/harelos/shopify-internal-funnel-app/actions/runs/34489792288

All traffic, images, registration responses, privacy API and PostHog capture were mocked. No production analytics calls or visitor records were created.

Results:
- Allowed-at-start enrollment/registration: passed.
- Consent revoked after initial grant: **failed**. Two new mocked capture calls occurred and the runtime's telemetry flag stayed true.
- Privacy API initialized late: gallery was B, but remained unenrolled/unregistered before and after the synthetic grant event. A late-initialization/persistence policy still needs implementation.

Do NOT deploy while this gate fails. The static STAGING preview does not exercise this path.

Required engineering work:
1. Recheck permitted processing at each analytics/context/persistence action, not only once at gallery mount.
2. Observe `visitorConsentCollected` and handle revocation by stopping future owned telemetry and retries; ignore/abort late responses where possible. Do not claim previously transmitted data can be undone.
3. Audit the attribution companion's retries, cookies and private cart-attribute writes under the same policy. Preserve necessary commerce and do not silently destroy other experiments' context.
4. Define unknown/late API behavior explicitly. No mid-page A/B switch, false exposure, covert tracking or silent rerandomization. No automatic user consent.
5. Retest actual Shopify privacy SDK initialization and consent states in a real dev/staging integration. Synthetic coverage is not that test.
6. Complete actual app publishing, auth/proxy, readback/CDN propagation, fast checkout and dev-store paid-order/refund attribution tests.

Reference: https://shopify.dev/docs/api/customer-privacy

## Customer-service system: capability confirmed in source, not connected here

Reviewed application branch: `feat/ai-support-live-20260908`, commit `9c6ded62700c9aa6017dde42b53a47e23b544377`.

Existing implementation:
- `app/cloudflare-pilot/src/server.ts` mounts `/support-bridge` outside Shopify admin sessions.
- `src/routes/support-desk.ts` protects it with the dedicated `SUPPORT_CONNECTOR_TOKEN` bearer credential (no values read or exported).
- GET status, list conversations and read conversation detail are already implemented.
- POST draft and approve endpoints exist.
- Approve accepts exact `replyText` and requires `confirmSend=true` before queuing an email.
- Hosted Namecheap connector claims the outbox, sends via its mailbox, records the outbound message and evidence in the same support thread.
- QUEUED is not SENT; SENT/provider acceptance is not proof of delivery or reading.

The existing `ops/private-email-mcp/src/server.mjs` exposes:
`support_agent_status`, `support_list`, `support_get`, `support_draft`, `support_approve`.
It uses **StdioServerTransport**, so this is a local MCP client integration, not an already connected remote tool in this chat. Plugin discovery did not surface this custom tool here. Shopify Admin API access does not grant access to the private support database.

Correct route for replies: read thread + verified order facts -> save exact reviewed response -> explicit approval -> native support outbox -> connector delivery -> confirm status/evidence. Do not send through an unrelated email service and bypass the app's thread history.

### Important support safety finding

The MCP `support_draft` description says it never sends. But its route calls `draftSupportReply`, which evaluates `mayAutoSend` using the mailbox's automationMode, policy, confidence and verified order information. When those conditions pass, it creates a draft with **QUEUED_TO_SEND** and `sendAfter=now`.

Therefore, the supposed draft-only tool can queue an email in the inspected implementation. Whether that version is deployed and which mailbox mode is enabled were NOT verified through authenticated access. No draft call was made.

Before enabling approval-only replies:
- Add an enforced draft-only entry point that cannot choose a sendable status, independent of mailbox automatic mode.
- Recheck the latest inbound message at approval/claim time and use an atomic approval transition.
- Fix/check the thread query using `sentAt:asc, take:30`: on a long thread it selects the oldest 30, not necessarily the latest unanswered message.
- Retain escalation for sensitive complaints, medical reactions, refunds/financial promises and unverified fulfillment facts.
- Test delivery only to an owner-approved internal test recipient before any real customer.

For Foundry/Codex: reuse the existing local MCP after verifying secure environment configuration and fixing the draft-only contract.
For this chat: an authenticated, supported remote MCP/secure transport with the appropriate write permissions is needed; do not paste secrets in chat. Remote write availability depends on product/account support.
Reference: https://help.openai.com/en/articles/12584461

## Release handoff boundary

The entire `integration-gallery-only-20260910` branch is still a SANDBOX, not the full app. Never merge it wholesale into production. Port only the scoped candidate patch onto the verified current production source, preserving the customer-service and fulfillment modules. Re-run the failing consent gate and full native integration tests before a release through an authorized Shopify/Cloudflare deployment environment. No automatic release workflow was created.
