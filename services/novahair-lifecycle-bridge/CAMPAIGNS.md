# Campaigns

One-off email campaigns to segments of the `customers` table, on top of the
lifecycle Worker. Scheduled lifecycle flows are unchanged and are documented
separately; this covers only the campaign system.

Everything below is behind `Authorization: Bearer $LIFECYCLE_ADMIN_TOKEN`
except the two public routes: the click redirect and the unsubscribe page.

## The shape of it

```
customers ──filter──> segment ──approve──> campaign_recipients ──cron──> Resend
                                (frozen)         (batched, budgeted)
```

A **segment** is a saved filter, not a saved list. It is evaluated fresh every
time you count it. A **campaign** points at one segment, and approving it
freezes that segment into `campaign_recipients`, so the people who receive it
are exactly the people who were reviewed.

Status flow. Nothing sends from `DRAFT`.

```
DRAFT ──approve──> APPROVED ──cron──> SENDING ──> SENT
  │                    │                 │
  └──reject──> REJECTED└────cancel───────┴──> CANCELLED
```

## Endpoints

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/lifecycle/admin/campaigns/brief` | Read this before proposing anything |
| `GET` | `/api/lifecycle/admin/segments` | Saved segments, each recounted live |
| `POST` | `/api/lifecycle/admin/segments/preview` | Count + masked sample for a filter, saves nothing |
| `POST` | `/api/lifecycle/admin/segments` | Save (or replace) a named segment |
| `GET` | `/api/lifecycle/admin/campaigns` | List, optionally `?status=DRAFT` |
| `POST` | `/api/lifecycle/admin/campaigns` | Create a draft |
| `GET` | `/api/lifecycle/admin/campaigns/:id` | Full report for one campaign |
| `POST` | `/api/lifecycle/admin/campaigns/:id/approve` | Freeze the audience and release it to cron |
| `POST` | `/api/lifecycle/admin/campaigns/:id/reject` | Kill a draft |
| `POST` | `/api/lifecycle/admin/campaigns/:id/cancel` | Stop a campaign, skipping whatever is still queued |
| `GET` `POST` | `/api/lifecycle/u/:token` | Public unsubscribe page and one-click endpoint |

## Segment filters

A filter is a JSON object checked against an allowlist. An unknown key is
**rejected**, never ignored, so a typo fails loudly instead of quietly widening
the audience.

| Key | Type | Meaning |
| --- | --- | --- |
| `consent` | `["SUBSCRIBED"]`, `["NOT_SUBSCRIBED"]` or both | Defaults to both |
| `novahairBuyer` | boolean | Has bought a NovaHair product |
| `minOrders` / `maxOrders` | 0-1000 | Order count range |
| `neverOrdered` | boolean | Never bought anything |
| `minLifetimeValue` | number | Spend floor |
| `orderedWithinDays` | 1-3650 | Bought recently |
| `lastOrderOlderThanDays` | 1-3650 | Lapsed |
| `minScore` / `maxScore` | 0-100 | Engagement score |
| `productHandleAny` | up to 20 handles | Bought any of these |
| `excludeProductHandleAny` | up to 20 handles | Bought none of these |
| `openedWithinDays` | 1-3650 | Opened an email recently |
| `clickedWithinDays` | 1-3650 | Clicked recently |
| `notEmailedWithinDays` | 1-3650 | Has not been mailed recently |
| `limit` | 1-10000 | Cap the audience |

Three rules are welded onto every compiled query and **cannot** be turned off by
any filter:

1. the row must have a usable email address
2. consent must be `SUBSCRIBED` or `NOT_SUBSCRIBED`, never `UNSUBSCRIBED` or `REDACTED`
3. the address must carry no active suppression

## Writing the HTML

Three placeholders are substituted per recipient:

- `{{FIRST_NAME}}` — HTML-escaped, empty string when unknown
- `{{UNSUBSCRIBE_URL}}` — **required** in any `marketing` campaign, or creation fails
- `{{CTA_URL}}` — a tracked redirect; requires `ctaUrl` on the campaign

`ctaUrl` must be `https` and on the storefront, shop, or worker domain. Each
campaign gets its own `utm_campaign` of `novahair_campaign_<slug>`, so it
separates cleanly in analytics.

## Sending

Cron runs every 10 minutes and sends inside a budget:

```
per tick      = min(CAMPAIGN_BATCH_SIZE, room left today, room left this month)
room today    = (90% of RESEND_DAILY_EMAIL_LIMIT) - CAMPAIGN_LIFECYCLE_RESERVE - sent today
```

The reserve exists so a newsletter can never consume the quota an order
confirmation needs. On the free tier that leaves campaigns **60 emails a day**.

At the moment of sending, each recipient is re-checked against consent,
suppression, and the frequency cap, because the audience was frozen earlier and
any of those can have changed since. A network error whose outcome is unknown
marks the recipient `FAILED` rather than retrying, so nobody is mailed twice.

| Variable | Default | Purpose |
| --- | --- | --- |
| `RESEND_DAILY_EMAIL_LIMIT` | `100` | Plan ceiling per day |
| `RESEND_MONTHLY_EMAIL_LIMIT` | `3000` | Plan ceiling per month |
| `RESEND_MONTHLY_RUN_LIMIT` | `10000` | Automation-run ceiling |
| `CAMPAIGN_LIFECYCLE_RESERVE` | `30` | Emails/day held back for lifecycle mail |
| `CAMPAIGN_BATCH_SIZE` | `25` | Max sends per 10-minute tick (cap 200) |
| `CAMPAIGN_MIN_GAP_DAYS` | `5` | Minimum days between campaigns to one person |

Upgrading Resend is a variable change, not a code change.

## Unsubscribe

Each customer has one stable opaque token, so a single link keeps working
across every email we ever send them and no address or hash appears in the URL.
`GET` shows a confirmation page; `POST` performs it, which is also what Gmail's
one-click `List-Unsubscribe-Post` sends. Both headers are set on every campaign
email.

One press writes to four places, and all four are necessary:

1. `suppressions` with reason `marketing_unsubscribed` (blocks marketing, not order mail)
2. `customers.consent_state` = `UNSUBSCRIBED` (removes them from every future segment)
3. the Resend contact queue
4. the Shopify consent queue — **without this the next consent sync pulls Shopify's older, still-subscribed value back over the unsubscribe**

Queued rows 3 and 4 drain on the next cron tick.

## Attribution

A campaign click token carries `campaign_id:email_hash` as its entity id, so a
click is attributed to a person without needing an `automation_tracking` row.
The click redirect writes `lifecycle_attribution` and stamps `clicked_at` on the
recipient. Opens and clicks arriving by Resend webhook are matched back by the
stored `resend_email_id`. `ordersAfterSend` in the report counts orders placed
by people the campaign reached, after it reached them.

## Example

```bash
# 1. What can I send, and to whom?
curl -H "Authorization: Bearer $TOKEN" \
  https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev/api/lifecycle/admin/campaigns/brief
```

```bash
# 2. Try a filter without saving it
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"filter":{"novahairBuyer":true,"lastOrderOlderThanDays":60}}' \
  https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev/api/lifecycle/admin/segments/preview
```

```bash
# 3. Save it, draft a campaign against it, then approve it by id
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Lapsed NovaHair","filter":{"novahairBuyer":true,"lastOrderOlderThanDays":60},"createdBy":"AGENT"}' \
  https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev/api/lifecycle/admin/segments
```
