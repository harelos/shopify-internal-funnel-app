import assert from "node:assert/strict";
import test from "node:test";
import { buildNovaHairSummaryEmailBody } from "../src/lib/novahair-summary-email.ts";

test("Concierge result email contains the promised recommendation and fixed offer truth", () => {
  const body = buildNovaHairSummaryEmailBody({
    kind: "summary",
    mainConcern: "price",
    recommendedShade: "חום כהה",
    recommendedBundle: "מארז 4 בקבוקים",
  });
  assert.match(body, /חום כהה/);
  assert.match(body, /מארז 4 בקבוקים/);
  assert.match(body, /₪239/);
  assert.match(body, /₪519/);
  assert.match(body, /68%/);
  assert.match(body, /novahair-sales-staging#buy/);
  assert.doesNotMatch(body, /הסרה|הרשמה|ניוזלטר/);
});

test("coupon result email includes only the configured service result", () => {
  const body = buildNovaHairSummaryEmailBody({ kind: "coupon", couponCode: "NOVA10" });
  assert.match(body, /NOVA10/);
  assert.match(body, /נעמה לוי/);
});
