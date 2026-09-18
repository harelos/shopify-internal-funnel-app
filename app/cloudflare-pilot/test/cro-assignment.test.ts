import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_CRO_WEIGHTS,
  bucketVisitor,
  countersFromEvents,
  hashVisitorKey,
  weightsFromFlag,
} from "../src/lib/cro-assignment.js";

const FIFTY_FIFTY = [{ key: "control", weight: 50 }, { key: "full_adaptive", weight: 50 }];

describe("bucketVisitor", () => {
  it("gives the same visitor the same variant every time", () => {
    for (const key of ["kabc123456", "visitor-0001", "ZZZZZZZZ"]) {
      const first = bucketVisitor(key, FIFTY_FIFTY);
      for (let i = 0; i < 5; i += 1) assert.equal(bucketVisitor(key, FIFTY_FIFTY), first);
    }
  });

  it("splits a crowd close to the weights it is given", () => {
    const counts: Record<string, number> = { control: 0, full_adaptive: 0 };
    for (let i = 0; i < 4000; i += 1) counts[bucketVisitor(`visitor-${i}`, FIFTY_FIFTY)!] += 1;
    const share = counts.full_adaptive / 4000;
    assert.ok(share > 0.45 && share < 0.55, `expected roughly half, got ${(share * 100).toFixed(1)}%`);
  });

  it("honours an uneven split and skips variants on zero", () => {
    const weights = [{ key: "control", weight: 80 }, { key: "full_adaptive", weight: 20 }, { key: "value_delta", weight: 0 }];
    const counts: Record<string, number> = { control: 0, full_adaptive: 0 };
    for (let i = 0; i < 4000; i += 1) {
      const variant = bucketVisitor(`v${i}`, weights)!;
      assert.notEqual(variant, "value_delta", "a variant on zero must never be handed out");
      counts[variant] += 1;
    }
    const share = counts.full_adaptive / 4000;
    assert.ok(share > 0.17 && share < 0.23, `expected roughly a fifth, got ${(share * 100).toFixed(1)}%`);
  });

  it("returns nothing when there is no key or nobody is eligible", () => {
    assert.equal(bucketVisitor("", FIFTY_FIFTY), null);
    assert.equal(bucketVisitor("abc", [{ key: "control", weight: 0 }]), null);
  });
});

describe("the page and the server bucket identically", () => {
  // The storefront engine carries its own copy of the hash so it can run without the Worker.
  // If the two ever drift, a visitor is one variant on the page and another in the results.
  const source = readFileSync(new URL("../storefront/novahair-adaptive-cro.js", import.meta.url), "utf8");

  function extract(name: string): string {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start > -1, `${name} is missing from the storefront engine`);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") { depth -= 1; if (!depth) return source.slice(start, i + 1); }
    }
    throw new Error(`could not read ${name} out of the engine`);
  }

  const clientSide = new Function(
    "VARIANTS",
    `${extract("hashKey")}\n${extract("bucket")}\nreturn { hashKey: hashKey, bucket: bucket };`,
  )(["control", "value_delta", "shade_rescue", "scroll_rescue", "full_adaptive"]) as {
    hashKey: (key: string) => number;
    bucket: (key: string, weights: Array<{ key: string; weight: number }>) => string | null;
  };

  it("hashes a key to the same number on both sides", () => {
    for (const key of ["kabc123456", "visitor-0001", "", "a", "Z".repeat(60)]) {
      assert.equal(clientSide.hashKey(key), hashVisitorKey(key), `hash differs for "${key}"`);
    }
  });

  it("picks the same variant on both sides, over a few thousand visitors", () => {
    for (let i = 0; i < 3000; i += 1) {
      const key = `visitor-${i}`;
      assert.equal(clientSide.bucket(key, FIFTY_FIFTY), bucketVisitor(key, FIFTY_FIFTY), `variant differs for ${key}`);
    }
  });
});

describe("weightsFromFlag", () => {
  it("reads the live split out of a PostHog flag", () => {
    const weights = weightsFromFlag({ filters: { multivariate: { variants: [
      { key: "control", rollout_percentage: 70 },
      { key: "full_adaptive", rollout_percentage: 30 },
    ] } } });
    assert.deepEqual(weights, [{ key: "control", weight: 70 }, { key: "full_adaptive", weight: 30 }]);
  });

  it("falls back to an even split rather than leaving the page unable to test", () => {
    assert.deepEqual(weightsFromFlag(null), DEFAULT_CRO_WEIGHTS);
    assert.deepEqual(weightsFromFlag({ filters: {} }), DEFAULT_CRO_WEIGHTS);
    assert.deepEqual(weightsFromFlag({ filters: { multivariate: { variants: [{ key: "control", rollout_percentage: 0 }] } } }), DEFAULT_CRO_WEIGHTS);
  });
});

describe("countersFromEvents", () => {
  it("raises a counter from the events a beacon batch carries", () => {
    assert.deepEqual(countersFromEvents([{ kind: "view" }, { kind: "cart_add" }]), { addedToCart: true, reachedCheckout: false });
    assert.deepEqual(countersFromEvents([{ kind: "checkout_click" }]), { addedToCart: false, reachedCheckout: true });
    assert.deepEqual(countersFromEvents([]), { addedToCart: false, reachedCheckout: false });
    assert.deepEqual(countersFromEvents(undefined as never), { addedToCart: false, reachedCheckout: false });
  });
});
