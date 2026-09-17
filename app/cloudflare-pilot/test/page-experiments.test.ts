import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseVariant,
  isValidVisitorKey,
  newVisitorKey,
  normalizeLandingPath,
  redirectTarget,
  type PageExperimentVariantRow,
} from "../src/lib/page-experiment-split.js";

function variant(key: string, landingPath: string, weight = 1, isControl = 0): PageExperimentVariantRow {
  return { id: `id-${key}`, key, label: key, landingPath, weight, isControl };
}

const AB = [variant("a", "/pages/sales-a", 1, 1), variant("b", "/pages/sales-b")];

test("Shopify landing pages match a variation however they are reported", () => {
  const expected = "/pages/novahair-sales";
  for (const reported of [
    "https://tigerbrandsglobal.com/pages/novahair-sales",
    "https://tigerbrandsglobal.com/pages/novahair-sales/",
    "https://tigerbrandsglobal.com/pages/novahair-sales?utm_source=facebook",
    "https://tigerbrandsglobal.com/he-il/pages/novahair-sales",
    "/pages/novahair-sales",
    "pages/novahair-sales",
    "/PAGES/NovaHair-Sales",
  ]) {
    assert.equal(normalizeLandingPath(reported), expected, `failed for ${reported}`);
  }
  assert.equal(normalizeLandingPath(""), "");
});

test("a visitor always receives the same variation", () => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const key = newVisitorKey();
    const first = chooseVariant(AB, key);
    assert.equal(chooseVariant(AB, key)?.id, first?.id);
    assert.equal(chooseVariant(AB, key)?.id, first?.id);
  }
});

test("traffic splits close to the configured weights", () => {
  const counts: Record<string, number> = { a: 0, b: 0 };
  for (let attempt = 0; attempt < 4000; attempt += 1) {
    counts[chooseVariant(AB, newVisitorKey())!.key] += 1;
  }
  const shareA = counts.a / 4000;
  assert.ok(shareA > 0.45 && shareA < 0.55, `even split expected, received ${shareA}`);
});

test("weights are honoured and a zero weight receives no traffic", () => {
  const weighted = [variant("a", "/a", 9, 1), variant("b", "/b", 1), variant("off", "/off", 0)];
  const counts: Record<string, number> = { a: 0, b: 0, off: 0 };
  for (let attempt = 0; attempt < 4000; attempt += 1) {
    counts[chooseVariant(weighted, newVisitorKey())!.key] += 1;
  }
  assert.equal(counts.off, 0);
  const shareA = counts.a / 4000;
  assert.ok(shareA > 0.85 && shareA < 0.95, `90/10 split expected, received ${shareA}`);
});

test("an experiment with no eligible variation refuses to guess", () => {
  assert.equal(chooseVariant([], "visitor"), null);
  assert.equal(chooseVariant([variant("off", "/off", 0)], "visitor"), null);
});

test("ad tracking survives the redirect", () => {
  assert.equal(
    redirectTarget("/pages/sales-b", "?utm_source=facebook&utm_content=120247751175220077"),
    "/pages/sales-b?utm_source=facebook&utm_content=120247751175220077",
  );
  assert.equal(redirectTarget("/pages/sales-b", ""), "/pages/sales-b");
});

test("only well-formed visitor keys are trusted from the cookie", () => {
  assert.ok(isValidVisitorKey(newVisitorKey()));
  for (const rejected of ["", "short", "../etc/passwd", "a".repeat(65), "has spaces", undefined, null]) {
    assert.equal(isValidVisitorKey(rejected as any), false, `accepted ${String(rejected)}`);
  }
});
