# Phase 1 — Product Design Model

Status: approved for local wireframe only  
Date: 2026-08-11  
Scope: owner-facing design contract for the private Shopify funnel application

## 1. Context

The owner needs a compact operating workspace for publishing and measuring pre-checkout funnel experiments on one Shopify store. The application is deliberately code-first: the owner supplies complete HTML, reviews its portability, chooses a version, and publishes a reviewed render. It is not a general-purpose page builder.

The most important owner questions are: what is live, which version a visitor saw, whether traffic allocation is stable, where the funnel loses people, and whether paid orders can be attributed. The UI should expose those answers before secondary configuration.

## 2. Audience and design direction

Primary user: a single store owner/operator who understands conversion work but should not need to manage Shopify API mechanics.

Chosen direction: **Funnel Control Room**. It uses a warm paper background, near-black data ink, dense editorial tables, a narrow signal-orange action color, and a muted green status color. This is intentionally more like an operations ledger than a polished public SaaS shell. It uses no gradients, glass effects, stock imagery, or drag-and-drop affordances.

Design tokens:

| Token | Value | Purpose |
| --- | --- | --- |
| Canvas | `#F5F1E8` | low-glare workspace background |
| Surface | `#FFFDF8` | forms and preview content |
| Ink | `#17231E` | type, borders, and navigation |
| Muted ink | `#66716A` | secondary metadata |
| Signal | `#D85336` | irreversible/publish actions and key alerts |
| Live | `#197B5B` | published/success state |
| Notice | `#B88A18` | limitations/warnings |
| Hairline | `#D6D1C6` | table and layout boundaries |
| Body type | system `Arial, Helvetica, sans-serif` | readable, installed everywhere |
| Data type | `ui-monospace, SFMono-Regular, Consolas, monospace` | IDs, code, metrics, allocations |
| Spacing scale | 4, 8, 12, 16, 24, 32px | dense but scannable |
| Radius | 2px | firm operator-console language |

## 3. Information architecture

1. **Funnels** — list, status, conversion summary, and create action.
2. **Build** — ordered step rail, version editor, HTML source, portability report, sandbox preview, publication audit.
3. **Experiment** — allocation table, stability statement, state and fallback behavior.
4. **Analytics** — funnel/step/variant/date/source/device filters, counts, conversion, revenue, caveats.
5. **Report** — reproducible export configuration and prior export log.

## 4. Functional requirements

- FR-1: The UI MUST show the active store and state that it is a private one-store app.
- FR-2: The funnel list MUST show funnel status, active version/experiment context, visitor volume, paid orders, and revenue.
- FR-3: The build view MUST show step order and step kind without drag-and-drop controls.
- FR-4: The build view MUST separate source HTML, portability findings, sandbox preview, and version/audit actions.
- FR-5: The portability view MUST distinguish portable, mapped, needs-review, and unsupported elements and MUST explain the fallback.
- FR-6: The experiment view MUST make traffic weights editable, validate their total, and state that assignments stay stable after allocation changes.
- FR-7: The analytics view MUST distinguish observed checkout events from paid-order-confirmed revenue and visibly state the Shopify Basic checkout boundary.
- FR-8: The report view MUST offer CSV and JSON as available exports and label PDF as unavailable/not in this phase.
- FR-9: The wireframe MUST remain readable at 375px and MUST provide focus-visible controls.
- FR-10: The wireframe MUST show useful empty, warning, disabled, and loading examples without pretending they are functional Shopify data.

## 5. Non-functional requirements

- NFR-1: All interactive controls MUST be keyboard reachable and display a visible focus outline.
- NFR-2: Text and essential state colors MUST meet a 4.5:1 contrast target against their backgrounds.
- NFR-3: At 375px, the sidebar MUST become a horizontal navigation and data tables MUST scroll without clipping values.
- NFR-4: No external font, image, analytics, or network dependency is required to render the wireframe.
- NFR-5: The preview MUST be explicitly marked as a static/sandbox design representation; no imported script is executed.

## 6. Acceptance criteria

- AC-1 (FR-2): Given the Funnel list view, when an owner scans a row, then they can identify its status, visitors, paid orders, and revenue without opening it.
- AC-2 (FR-3/FR-4): Given the Build view, when an owner selects a step, then the step order, active version, source, portability assessment, and preview are simultaneously discoverable.
- AC-3 (FR-5): Given imported HTML has unreviewed scripts, when the owner opens Portability, then the UI labels the scripts as blocked pending allowlisting and names the fallback.
- AC-4 (FR-6): Given a two-variant experiment, when allocations change, then the UI states both the 10,000-basis-point total and that existing assigned visitors will not be reassigned.
- AC-5 (FR-7): Given the Analytics view, when checkout metrics are displayed, then confirmed paid revenue is visibly distinguished from an observed completion signal.
- AC-6 (FR-8): Given the Report view, when the owner selects an export, then CSV/JSON are actionable mock controls and PDF is disabled with a reason.
- AC-7 (FR-9/NFR-3): Given a 375px viewport, when the wireframe is viewed, then navigation, primary actions, and tables remain reachable with horizontal table scrolling as needed.
- AC-8 (FR-10): Given loading, no-data, error, and disabled states, when the owner encounters them, then each state communicates the next available action.

## 7. Edge cases

- EC-1: An empty funnel list directs the owner to create a code-first funnel; it does not offer a visual-builder template gallery.
- EC-2: Allocation not totaling 10,000 basis points blocks the publish action and states the exact difference.
- EC-3: A checkout event with no matching paid order is shown as observed, not counted as authoritative paid revenue.
- EC-4: An order with no checkout-token/funnel match appears as unattributed rather than being force-assigned.
- EC-5: An imported full HTML document has its `head`/`body` extraction explained before publish.
- EC-6: An owner requests checkout experimentation on Basic; the UI presents it as unavailable and points to pre-checkout variants.

## 8. Static-preview contract

The HTML preview is an original visual model. Its tabs navigate between views and its static controls illustrate intended behavior. It does not persist data, upload HTML, contact Shopify, execute imported code, assign real visitors, or export files. Those behaviors are Phase 2/3 implementation work.

## 9. Out of scope

- Drag-and-drop page editing, page templates, or copied Funnelish UI.
- Shopify connection, OAuth/install flow, app proxy, theme write, pixel activation, webhooks, and any live tracking.
- Checkout UI customization or checkout A/B testing on Shopify Basic.
- PDF report generation, payment receipts, buyer PII, and real user permissions beyond the owner model.
