# NovaHair Concierge — Agent Architecture

One front door, several specialists behind it. Every shopper now starts at the
same exact `audience_choice` screen. The lane remains internal context for
analytics, tone, coupon eligibility, and safety; it no longer changes the
opening copy or bypasses the customer-choice screen.

## The three inputs the router reads

1. **Placement** — where the widget lives. Sets the *default goal*.
   - `exit_sales` — exit popup on the NovaHair sales page. Goal: close.
   - `exit_home` — exit popup on home / collection. Goal: discover need, route
     her to the right page. Softer, no hard close.
   - `persistent_sales` — a launcher bubble on the sales page. Goal: answer, close.
   - `persistent_home` — a launcher bubble on home. Goal: help navigate, capture.

2. **Who she is** — from the Liquid `shopper` object (logged-in only, no lookup).
   - orders_count, last_order age, marketing consent.

3. **What she needs** — her first message / chosen objection, run through the
   safety classifier (escalation, medical) before anything else.

## The lanes (agents)

| Lane | Who lands here | Goal | Coupon allowed | Entry |
|---|---|---|---|---|
| `service` | anyone with a complaint, order-status, or medical question | resolve or route to a human, NEVER sell | no | `audience_choice` |
| `vip` | logged-in, orders_count >= 3 | fast repeat purchase or help | no | `audience_choice` |
| `retention` | logged-in, orders_count 1-2 | fast repeat purchase or help | no | `audience_choice` |
| `sales` | everyone else (new / guest) | help her decide and close | yes, gated to price-hesitation | `audience_choice` |

## Router precedence (safety first)

```
1. complaint / order-status / medical  -> service   (overrides EVERYTHING:
   a VIP with a broken order needs support, not an upsell)
2. orders_count >= 3                    -> vip
3. orders_count >= 1                    -> retention
4. otherwise                            -> sales
```

## Goal by placement, not just by lane

The lane sets *how* she is helped; the placement sets *toward what*. A `sales`
lane on the sales page closes; the same lane on the home page routes her to the
right page first. This is carried as a one-line `goalHint` appended to the
model's system prompt for free-text turns, so the LLM knows the destination
without new code per page.

## Why the coupon rule differs per lane

The whole point of the earlier redesign: a discount is a lever, not a handout.
That extends here.
- `sales`: first-order code, only for a price objection about to leave.
- `retention` / `vip`: a first-order code is wrong (she has ordered before). If
  a gesture is warranted it is a loyalty/VIP one, configured separately, never
  the new-customer code.
- `service`: never. Selling to a complaint is how you lose a customer.

## Same brain, two skins

The exit popup and the persistent chatbot are the SAME engine and lanes. Only
the shell differs:
- Exit popup: opened by the behavioural exit decision.
- Persistent chat: a launcher bubble the shopper taps; no exit gating.

`placement` decides which shell and which default goal. Nothing else forks.

## What stays true everywhere

Regardless of lane or placement: Hebrew, second person feminine, no emojis, no
invented facts (grounded in `novahair-ai-facts.js`), every step logged, model
output scrubbed, and the safety classifier runs before any lane logic.
