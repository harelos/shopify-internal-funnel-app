# Deploying the Worker (read this before `npm run deploy`)

**Production deploys from exactly one place:**

```
C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App     branch: master
cd app\cloudflare-pilot && npm run deploy
```

Nowhere else. Every other checkout of this repo on this machine carries a
`DO-NOT-DEPLOY` file in `app/cloudflare-pilot/`, and the deploy guard refuses
to run there.

## Why this rule exists

On 2026-09-17 there were two full clones and about ten worktrees of this repo
on the laptop, eleven copies of `cj-cost-match.ts`, and production had been
deployed four times in eleven minutes from a folder nobody could name. The
code that was live existed in one unregistered worktree and was not on `master`
at all. Each agent fixed the CJ cost bug in the folder it happened to open; the
next agent deployed the old code back from a different folder. The fixes were
all real. None of them survived. See `CJ_PRICING_INVESTIGATION_2026-09-17.md`.

## What the guard checks (`app/cloudflare-pilot/scripts/deploy-guard.mjs`)

| Check | Production | Staging |
|---|---|---|
| No `DO-NOT-DEPLOY` file in the folder | required | required |
| No uncommitted changes to tracked files | required | required |
| Branch is `master` | required | — |
| `HEAD` equals `origin/master` (pushed) | required | — |

It then runs `wrangler deploy` with `BUILD_SHA`, `BUILD_BRANCH`, `BUILD_TIME`
and `BUILD_FROM` injected as vars, so the Worker can always say what it is.

## How to check what is live

```
curl https://shopify-funnel-control.tigerbrands-funnel.workers.dev/api/version
```

returns the commit, branch, build time and the folder it was deployed from.
If it does not match `git rev-parse origin/master`, somebody deployed around
the guard — find out how before touching anything else.

After a deploy that touches CJ costs, open the Growth Cockpit and press
"Re-check CJ costs", or call `GET /api/growth-cockpit/cj-cost-audit?days=7`
(admin session): it compares the sales, the cost ledger and CJ's order list and
names every sale that is unpriced, dated on the wrong day, or ordered twice.

## The workflow

1. Work on a branch, anywhere you like.
2. Merge to `master`, push.
3. In the Desktop checkout: `git pull`, then `cd app\cloudflare-pilot && npm run deploy:staging`, then `npm run smoke`.
4. `npm run deploy`.
5. Confirm `/api/version` shows your commit.

The Railway Python worker (`cj-sync-worker/`) is uploaded with `railway up`
from this same Desktop checkout; keep it on `master` too.
