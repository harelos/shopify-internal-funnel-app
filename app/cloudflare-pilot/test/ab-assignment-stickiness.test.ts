import assert from "node:assert/strict";
import test from "node:test";
import { BASIS_POINTS_TOTAL, bucketFor, pickVariant, type VariantAllocation } from "../src/lib/ab-allocation.ts";
import { readCookie, resolveVisitorId } from "../src/lib/visitor-identity.ts";

const ALLOCATIONS: VariantAllocation[] = [
  { variantId: "variant-a", weightBasisPoints: 5000 },
  { variantId: "variant-b", weightBasisPoints: 5000 },
];

function fakeReq(options: { cookie?: string; header?: string; vid?: string } = {}) {
  return {
    headers: { cookie: options.cookie, "x-visitor-id": options.header },
    query: options.vid ? { vid: options.vid } : {},
  } as any;
}

function fakeRes() {
  const headers: Record<string, string> = {};
  return { setHeader: (k: string, v: string) => { headers[k] = v; }, headers } as any;
}

test("the same visitor always lands on the same variant", () => {
  const first = pickVariant("v_stable", "exp-1", 1, ALLOCATIONS);
  for (let i = 0; i < 50; i += 1) {
    assert.equal(pickVariant("v_stable", "exp-1", 1, ALLOCATIONS), first);
  }
});

test("bumping the allocation version re-buckets the population", () => {
  const keys = Array.from({ length: 400 }, (_, i) => `v_${i}`);
  const moved = keys.filter(k => pickVariant(k, "exp-1", 1, ALLOCATIONS) !== pickVariant(k, "exp-1", 2, ALLOCATIONS));
  assert.ok(moved.length > 0, "a new allocation version must reshuffle assignments");
});

test("buckets stay inside the basis-point range", () => {
  for (let i = 0; i < 200; i += 1) {
    const bucket = bucketFor(`v_${i}`, "exp-1", 1);
    assert.ok(bucket >= 0 && bucket < BASIS_POINTS_TOTAL, `bucket ${bucket} out of range`);
  }
});

test("traffic splits roughly according to the configured weights", () => {
  const total = 4000;
  let a = 0;
  for (let i = 0; i < total; i += 1) {
    if (pickVariant(`v_${i}`, "exp-split", 1, ALLOCATIONS) === "variant-a") a += 1;
  }
  const share = a / total;
  assert.ok(share > 0.45 && share < 0.55, `50/50 split skewed: variant-a got ${(share * 100).toFixed(1)}%`);
});

test("a 90/10 split honours the minority weight", () => {
  const weighted: VariantAllocation[] = [
    { variantId: "variant-a", weightBasisPoints: 9000 },
    { variantId: "variant-b", weightBasisPoints: 1000 },
  ];
  const total = 4000;
  let b = 0;
  for (let i = 0; i < total; i += 1) {
    if (pickVariant(`v_${i}`, "exp-weighted", 1, weighted) === "variant-b") b += 1;
  }
  const share = b / total;
  assert.ok(share > 0.05 && share < 0.15, `90/10 split skewed: variant-b got ${(share * 100).toFixed(1)}%`);
});

test("allocation order from the database cannot change the outcome", () => {
  const reversed = [...ALLOCATIONS].reverse();
  for (let i = 0; i < 100; i += 1) {
    assert.equal(pickVariant(`v_${i}`, "exp-1", 1, ALLOCATIONS), pickVariant(`v_${i}`, "exp-1", 1, reversed));
  }
});

test("weights summing under the total still resolve to a variant", () => {
  const gapped: VariantAllocation[] = [
    { variantId: "variant-a", weightBasisPoints: 10 },
    { variantId: "variant-b", weightBasisPoints: 10 },
  ];
  for (let i = 0; i < 100; i += 1) {
    assert.ok(pickVariant(`v_${i}`, "exp-gap", 1, gapped));
  }
});

test("an empty allocation list selects nothing", () => {
  assert.equal(pickVariant("v_1", "exp-1", 1, []), null);
});

test("readCookie pulls the visitor token out of a cookie header", () => {
  assert.equal(readCookie(fakeReq({ cookie: "foo=1; _fv=v_abc123; bar=2" }), "_fv"), "v_abc123");
  assert.equal(readCookie(fakeReq({ cookie: "_fv=v%5Fenc" }), "_fv"), "v_enc");
  assert.equal(readCookie(fakeReq(), "_fv"), "");
});

test("an existing cookie is reused instead of minting a new visitor", () => {
  const res = fakeRes();
  assert.equal(resolveVisitorId(fakeReq({ cookie: "_fv=v_returning" }), res), "v_returning");
  assert.match(res.headers["Set-Cookie"], /_fv=v_returning/);
});

test("a new visitor gets a token that is persisted to a cookie", () => {
  const res = fakeRes();
  const first = resolveVisitorId(fakeReq(), res);
  assert.match(first, /^v_[0-9a-f]{16}$/);
  assert.match(res.headers["Set-Cookie"], /Path=\/; Max-Age=\d+; SameSite=Lax/);
  // A second visit carrying that cookie must not re-bucket.
  assert.equal(resolveVisitorId(fakeReq({ cookie: `_fv=${first}` }), fakeRes()), first);
});

test("the cookie wins over header and query overrides", () => {
  assert.equal(
    resolveVisitorId(fakeReq({ cookie: "_fv=v_cookie", header: "v_header", vid: "v_query" }), fakeRes()),
    "v_cookie",
  );
  assert.equal(resolveVisitorId(fakeReq({ header: "v_header", vid: "v_query" }), fakeRes()), "v_header");
  assert.equal(resolveVisitorId(fakeReq({ vid: "v_query" }), fakeRes()), "v_query");
});
