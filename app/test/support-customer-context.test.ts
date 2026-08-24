import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSupportShopifyCustomerLookupEnabled,
  getSupportConfig,
} from "../src/support/config.js";
import {
  buildShopifyCustomerEmailQuery,
  reduceShopifyCustomer,
} from "../src/support/customer-context.js";

test("Shopify customer context requires its own explicit staging gate", () => {
  const config = getSupportConfig({
    SUPPORT_STAGING_ENABLED: "true",
    SUPPORT_SHOPIFY_LOOKUP_ENABLED: "true",
    SUPPORT_SHOPIFY_CUSTOMER_LOOKUP_ENABLED: "false",
  } as NodeJS.ProcessEnv);
  assert.throws(() => assertSupportShopifyCustomerLookupEnabled(config), /customer lookup is disabled/i);
});

test("customer email search is exact and rejects query injection characters", () => {
  assert.equal(buildShopifyCustomerEmailQuery(" Test@Example.com "), 'email:"test@example.com"');
  assert.throws(() => buildShopifyCustomerEmailQuery('test@example.com" OR id:123'), /valid customer email/i);
});

test("customer reduction keeps only minimal support identity fields and exact email match", () => {
  const result = reduceShopifyCustomer({
    customers: {
      nodes: [
        {
          id: "gid://shopify/Customer/1",
          firstName: "Test",
          lastName: "Customer",
          defaultEmailAddress: { emailAddress: "test@example.com" },
        },
        {
          id: "gid://shopify/Customer/2",
          firstName: "Other",
          lastName: "Person",
          defaultEmailAddress: { emailAddress: "other@example.com" },
        },
      ],
    },
  }, "TEST@example.com");

  assert.deepEqual(result, {
    id: "gid://shopify/Customer/1",
    firstName: "Test",
    lastName: "Customer",
    email: "test@example.com",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(result || {}, "phone"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result || {}, "address"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result || {}, "tags"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result || {}, "amountSpent"), false);
});

test("customer reduction returns null rather than accepting a non-exact email result", () => {
  const result = reduceShopifyCustomer({
    customers: {
      nodes: [{
        id: "gid://shopify/Customer/1",
        firstName: "Wrong",
        lastName: "Match",
        defaultEmailAddress: { emailAddress: "wrong@example.com" },
      }],
    },
  }, "expected@example.com");
  assert.equal(result, null);
});
