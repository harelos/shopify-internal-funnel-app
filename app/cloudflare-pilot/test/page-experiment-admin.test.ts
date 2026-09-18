import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SHOPIFY_PROXY_PARAMS,
  experimentStatus,
  normalizeNewExperiment,
  normalizeWeights,
  redirectTarget,
  reuseVisitorKey,
  visitorCookie,
} from "../src/lib/page-experiment-split.js";

describe("redirectTarget", () => {
  it("forwards the shopper's own tracking and drops Shopify's proxy signature", () => {
    const target = redirectTarget("/pages/oceaura-sales-staging",
      "utm_source=facebook&utm_campaign=amla&fbclid=abc&shop=jacobfelipe.myshopify.com&logged_in_customer_id=&path_prefix=%2Fapps%2Ffunnels&timestamp=1789697494&signature=64d3");
    assert.equal(target, "/pages/oceaura-sales-staging?utm_source=facebook&utm_campaign=amla&fbclid=abc");
    for (const name of SHOPIFY_PROXY_PARAMS) assert.ok(!target.includes(`${name}=`), `${name} leaked into the landing URL`);
  });

  it("leaves a clean path alone when there is nothing to forward", () => {
    assert.equal(redirectTarget("/pages/a", ""), "/pages/a");
    assert.equal(redirectTarget("/pages/a", "?shop=x&signature=y"), "/pages/a");
  });
});

describe("reuseVisitorKey", () => {
  it("prefers our own cookie, falls back to Shopify's visitor id, else gives up", () => {
    assert.equal(reuseVisitorKey(["abcdefgh12345678", "70b66efb-9471-4ce1-93bc-a58ffba764a2"]), "abcdefgh12345678");
    assert.equal(reuseVisitorKey([undefined, "70b66efb-9471-4ce1-93bc-a58ffba764a2"]), "70b66efb-9471-4ce1-93bc-a58ffba764a2");
    assert.equal(reuseVisitorKey([undefined, "short"]), null);
    assert.equal(reuseVisitorKey([]), null);
  });
});

describe("visitorCookie", () => {
  it("is readable by the storefront, secure, and lasts half a year", () => {
    const cookie = visitorCookie("abcdefgh12345678");
    assert.match(cookie, /^fc_pe=abcdefgh12345678;/);
    assert.match(cookie, /Max-Age=15552000/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/);
    assert.ok(!/HttpOnly/i.test(cookie), "page scripts need to read which variation they are on");
  });
});

describe("normalizeWeights", () => {
  const ids = ["a1", "b2"];
  it("accepts a 50/50 and an all-on-control split", () => {
    assert.deepEqual(normalizeWeights([{ id: "a1", weight: 50 }, { id: "b2", weight: 50 }], ids).map(r => r.weight), [50, 50]);
    assert.deepEqual(normalizeWeights([{ id: "a1", weight: 100 }, { id: "b2", weight: 0 }], ids).map(r => r.weight), [100, 0]);
  });
  it("refuses shares that do not add up, unknown variations and an empty test", () => {
    assert.throws(() => normalizeWeights([{ id: "a1", weight: 50 }, { id: "b2", weight: 40 }], ids), /add up to 90/);
    assert.throws(() => normalizeWeights([{ id: "a1", weight: 100 }], ids), /needs a share/);
    assert.throws(() => normalizeWeights([{ id: "zz", weight: 100 }], ids), /not part of this test/);
    assert.throws(() => normalizeWeights([{ id: "a1", weight: 0 }, { id: "b2", weight: 0 }], ids), /add up to 0/);
    assert.throws(() => normalizeWeights([{ id: "a1", weight: 50.5 }, { id: "b2", weight: 49.5 }], ids), /whole number/);
  });
});

describe("experimentStatus", () => {
  it("takes only the two states the splitter understands", () => {
    assert.equal(experimentStatus("running"), "RUNNING");
    assert.equal(experimentStatus("STOPPED"), "STOPPED");
    assert.throws(() => experimentStatus("paused"), /RUNNING or STOPPED/);
  });
});

describe("normalizeNewExperiment", () => {
  const base = {
    key: "oceaura",
    name: "OceAura A/B",
    variants: [
      { key: "a", label: "Version A", landingPath: "/pages/oceaura-sales-staging", weight: 50 },
      { key: "b", label: "Version B", landingPath: "/pages/oceaura-sales-staging-b", weight: 50 },
    ],
  };

  it("keeps the first page as the control and normalizes this store's own URLs to paths", () => {
    const draft = normalizeNewExperiment({ ...base, variants: [
      { ...base.variants[0], landingPath: "https://tigerbrandsglobal.com/pages/Oceaura-Sales-Staging/" },
      base.variants[1],
    ] }, "tigerbrandsglobal.com");
    assert.equal(draft.variants[0].landingPath, "/pages/oceaura-sales-staging");
    assert.equal(draft.variants[0].isControl, 1);
    assert.equal(draft.variants[1].isControl, 0);
  });

  it("evens out the split when the weights do not add up to 100", () => {
    const draft = normalizeNewExperiment({ ...base, variants: base.variants.map(v => ({ ...v, weight: 0 })) });
    assert.deepEqual(draft.variants.map(v => v.weight), [50, 50]);
  });

  it("refuses a bad short name, one page, and two variations on the same page", () => {
    assert.throws(() => normalizeNewExperiment({ ...base, key: "Oce Aura!" }), /short name/);
    assert.throws(() => normalizeNewExperiment({ ...base, variants: [base.variants[0]] }), /at least two pages/);
    assert.throws(() => normalizeNewExperiment({ ...base, variants: [base.variants[0], { ...base.variants[1], landingPath: "/pages/oceaura-sales-staging" }] }), /Two variations point at/);
    assert.throws(() => normalizeNewExperiment({ ...base, variants: [base.variants[0], { ...base.variants[1], landingPath: "https://example.com/evil" }] }, "tigerbrandsglobal.com"), /not a page on this store/);
    assert.throws(() => normalizeNewExperiment({ ...base, variants: [base.variants[0], { ...base.variants[1], landingPath: "https://tigerbrandsglobal.com/pages/b" }] }), /not a page on this store/, "with no storefront configured, a full URL is refused rather than trusted");
  });
});
