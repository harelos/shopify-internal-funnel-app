# NovaHair Bundle Expand (Cart Transform Function)

Expands a single `NOVASALE-*` bundle line into the physical shade variants plus
one free kit, **before** the order is created. CJ then receives six ordinary
products it already knows, instead of one bundle variant it cannot decode.

## Why this instead of CJ Combined Products

The store sells **295** bundle combinations (2-pack 15, 4-pack 70, 6-pack 210),
not the 100 assumed in the original plan. CJ has no API for combined products or
for variant connections, so that route means 295 hand-made, unverifiable
mappings. This function reduces the whole problem to **6** CJ connections that
never grow when new combinations are added.

## Status

- [x] Composition + price-allocation logic, 15 unit tests passing
- [x] Verified against all 295 live variant SKUs
- [x] Six physical variant IDs verified against the live store (2026-08-31)
- [x] Partners app created and CLI linked (client_id 29f67daa…)
- [x] Dev store created: `novahair-dev.myshopify.com` (Basic plan, matches production)
- [ ] **BLOCKED: `shopify app function build` hangs with no output.**
      Two traps already ruled out and fixed:
        1. `[extensions.build] command` must be `""` for a JS function. Setting it
           to `npm run build` recurses forever, because package.json's build
           script calls `shopify app function build` again.
        2. The `javy` npm package is NOT the right dependency — it ships no
           binary. The CLI downloads its own javy/function-runner.
      Remaining suspect: the CLI's first-run javy/function-runner download is
      failing silently on Windows. Next things to try: run `shopify app dev`
      (which builds as a side effect and shows more output), check for a proxy
      blocking the binary download, or build under WSL.
- [ ] Deployed to a development store
- [ ] Instruction count measured against the 11M budget
- [ ] Price / discount / tax behaviour confirmed in a real checkout
- [ ] Six CJ product connections made
- [ ] Canary order verified end to end

## Safety properties

- **Fails closed on data.** Any SKU that is not an exact, balanced `NOVASALE-*`
  match is left untouched — an unknown line degrades to today's behaviour rather
  than shipping the wrong goods.
- **Fails open on errors.** Register the transform with `blockOnFailure: false`
  so a runtime error lets checkout proceed normally.
- **Money reconciles exactly.** Every bottle carries the same per-unit price and
  the sub-cent remainder lands on the kit line (always quantity 1), so the
  expanded lines sum to the exact bundle price. Worst case the "free" kit shows
  as ₪0.02. Tested across all 295 combinations.
- **One line per shade, never a duplicate merchandiseId.** `fixedPricePerUnit`
  is uniform within a line, so carrying a remainder inside a shade would mean
  emitting that variant twice at different prices. Duplicate ids in a single
  expand are not a documented guarantee, so the design avoids needing them at
  all rather than relying on undocumented behaviour.

## Physical variants (verified live)

| Shade | Shopify variant | SKU (matches CJ) |
|---|---|---|
| Black | 50228321780007 | CJYD223160001AZ |
| Dark Brown | 50228321812775 | CJYD223160002BY |
| Light Brown | 50228321845543 | CJYD223160003CX |
| Purple | 50228321878311 | CJYD223160005EV |
| Red | 50228321911079 | CJYD223160004DW |
| Free kit | 51871788171559 | CJBJMRPF00756-Suit |

All six are `UNLISTED`, so they are fulfillable but not directly sellable.

## Local tests

```bash
node --test src/composition.test.js src/run.test.js
```

## Deployment prerequisites (not yet met)

1. **A Shopify Partners app.** The current `shopify.app.toml` still has
   `REPLACE_WITH_DEV_DASHBOARD_CLIENT_ID`. Note that a custom app created inside
   the Shopify admin **cannot host Function extensions** — this must be a
   Partners app.
2. **A development store.** Never deploy this to `jacobfelipe` first. Dev stores
   also permit `lineUpdate`, which makes debugging easier.

Then:

```bash
npm run build
npx shopify app function run     # reports instruction count vs the 11M budget
npx shopify app dev              # against the development store
```

## What to verify in the dev store before going near production

1. Instruction count per invocation for 2-, 4-, and 6-packs (budget: 11M;
   functions typically run in under 5ms).
2. Cart and checkout totals still show the bundle price the customer was quoted.
3. Discount codes and taxes apply correctly to the expanded lines.
4. The free kit displays at 0 and cannot be removed independently.
5. The resulting order's line items are the six physical SKUs.
6. Refunds and cancellations behave sanely on expanded lines.
