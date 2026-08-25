import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../src/routes/popup-analytics.ts", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/lib/shopify-admin.ts", import.meta.url), "utf8");

test("confirms popup leads by a one-time non-PII Shopify tag", () => {
  assert.match(route, /\^nhp_\[a-f0-9\]\{32\}\$/);
  assert.match(route, /findPopupLeadByTag\(verificationTag\)/);
  assert.match(route, /node\.tags\.includes\(verificationTag\)/);
  assert.match(route, /confirmationSource: "shopify_admin_customer_tag"/);
  assert.doesNotMatch(route, /req\.body\?\.email/);
  assert.match(admin, /query: `tag:\\"\$\{verificationTag\}\\"`/);
  assert.doesNotMatch(admin, /nodes \{ id email/);
});
