import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../src/routes/popup-analytics.ts", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/lib/shopify-admin.ts", import.meta.url), "utf8");
const resultEmailMigration = readFileSync(new URL("../migrations/0009_concierge_result_email.sql", import.meta.url), "utf8");

test("captures one Shopify customer without overwriting identity or consent", () => {
  assert.match(route, /findOrCreateCustomer\(email\)/);
  assert.match(route, /\["nova_ai", statusTag\(context\.current_intent\)\]/);
  assert.match(route, /req\.body\?\.marketingConsent === true/);
  assert.doesNotMatch(route, /marketingConsent === false[\s\S]*subscribeCustomerEmail/);
  assert.match(admin, /customerCreate\(input: \$input\)/);
  assert.match(admin, /tagsAdd\(id: \$id, tags: \$tags\)/);
  assert.match(admin, /metafieldsSet\(metafields: \$metafields\)/);
  assert.match(admin, /workerEnvValue\("SHOPIFY_PII_TOKEN"\)/);
  assert.match(admin, /const piiToken = workerEnvValue\("SHOPIFY_PII_TOKEN"\);\s+if \(piiToken\) return piiToken;/);
  assert.match(admin, /grant_type: "client_credentials"/);
  assert.match(admin, /expiresAt: Date\.now\(\) \+ Math\.max\(60000, \(payload\.expires_in \?\? 86400\) \* 1000\)/);
  assert.match(admin, /private async customerGraphql/);
  assert.match(admin, /findCustomerByEmail[\s\S]*?return this\.customerGraphql/);
  assert.match(admin, /createCustomerWithEmail[\s\S]*?return this\.customerGraphql/);
  assert.match(admin, /subscribeCustomerEmail[\s\S]*?return this\.customerGraphql/);
});

test("returning-order lookup requires a short-lived one-time email code", () => {
  assert.match(route, /OTP_TTL_SECONDS = 10 \* 60/);
  assert.match(route, /randomInt\(0, 1_000_000\)/);
  assert.match(route, /attempts >= 5/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /consumedAt/);
  assert.match(route, /NOVAHAIR_EMAIL_SERVICE_URL/);
});

test("requested result email uses the verified Shopify customer and is idempotent per conversation", () => {
  assert.match(route, /\/popup\/customer\/result-email/);
  assert.match(route, /INSERT OR IGNORE INTO ConciergeResultEmail/);
  assert.match(route, /findCustomerById\(customerId\)/);
  assert.match(route, /sendNovaHairConciergeSummary/);
  assert.match(route, /popup_result_email_sent/);
  assert.match(route, /clientEventKey \|\| `popup_result_email_sent:\$\{analyticsPopupVersion\}:/);
  assert.match(route, /device: browserPayload\.device/);
  assert.doesNotMatch(resultEmailMigration, /\bemail(?:Address)?\b/i);
});
