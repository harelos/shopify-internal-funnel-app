import assert from "node:assert/strict";
import test from "node:test";
import {
  DuplicateFunnelInputError,
  normalizeDuplicateSteps,
  normalizeFunnelSlug,
  replaceImportedLink,
} from "../src/lib/funnel-duplicate.ts";

test("normalizes a two-page duplicate and appends a terminal checkout", () => {
  const steps = normalizeDuplicateSteps([
    { name: " Listicle ", kind: "advertorial", sourceUrl: "https://tigerbrandsglobal.com/pages/listicle" },
    { name: "Sales Page", kind: "sales", sourceUrl: "https://tigerbrandsglobal.com/pages/sales" },
  ]);
  assert.deepEqual(steps.map(step => step.kind), ["ADVERTORIAL", "SALES", "CHECKOUT"]);
  assert.equal(steps[2].sourceUrl, undefined);
});

test("rejects a checkout step with page HTML or a non-terminal checkout", () => {
  assert.throws(
    () => normalizeDuplicateSteps([
      { name: "Checkout", kind: "CHECKOUT", sourceUrl: "https://tigerbrandsglobal.com/pages/checkout" },
      { name: "Sales", kind: "SALES", sourceUrl: "https://tigerbrandsglobal.com/pages/sales" },
    ]),
    (error: unknown) => error instanceof DuplicateFunnelInputError && /Checkout steps cannot import/i.test(error.message),
  );
});

test("rejects invalid duplicate slugs", () => {
  assert.throws(() => normalizeFunnelSlug("NovaHair staging"), /lowercase letters/);
});

test("rewrites a live next-step link to the internal tracked step", () => {
  const html = '<a href="https://tigerbrandsglobal.com/pages/novahair-sales-staging">Continue</a>';
  assert.equal(
    replaceImportedLink(html, "https://tigerbrandsglobal.com/pages/novahair-sales-staging", "#next-step"),
    '<a href="#next-step">Continue</a>',
  );
});
