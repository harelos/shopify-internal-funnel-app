import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShopifyOrderEmailQuery,
  customerEmailsFromParticipants,
  reduceShopifyOrders,
} from "../src/support/shopify-context.js";
import { assertSupportShopifyLookupEnabled, getSupportConfig } from "../src/support/config.js";

test("Shopify support lookup requires an explicit staging gate", () => {
  const config = getSupportConfig({
    SUPPORT_STAGING_ENABLED: "true",
    SUPPORT_SHOPIFY_LOOKUP_ENABLED: "false",
  } as NodeJS.ProcessEnv);

  assert.throws(() => assertSupportShopifyLookupEnabled(config), /Shopify lookup is disabled/i);
});

test("Shopify email query accepts a normalized email and rejects search injection characters", () => {
  assert.equal(buildShopifyOrderEmailQuery("  Customer@Example.COM  "), "email:customer@example.com");
  assert.throws(() => buildShopifyOrderEmailQuery('customer@example.com" OR status:any'), /valid customer email/i);
});

test("customer email extraction removes the support mailbox and duplicates", () => {
  assert.deepEqual(
    customerEmailsFromParticipants(
      ["support@store.test", "customer@example.com", "CUSTOMER@example.com"],
      "support@store.test",
    ),
    ["customer@example.com"],
  );
});

test("Shopify order reduction keeps only support-safe order context", () => {
  const reduced = reduceShopifyOrders({
    orders: {
      nodes: [
        {
          id: "gid://shopify/Order/1",
          name: "#1001",
          createdAt: "2026-08-24T12:00:00Z",
          processedAt: "2026-08-24T12:01:00Z",
          cancelledAt: null,
          displayFinancialStatus: "PAID",
          displayFulfillmentStatus: "FULFILLED",
          totalPriceSet: { shopMoney: { amount: "199.00", currencyCode: "ILS" } },
          lineItems: { nodes: [{ name: "Hair Color", quantity: 1, sku: "HC-1" }] },
          fulfillments: [
            {
              status: "SUCCESS",
              estimatedDeliveryAt: "2026-08-29T12:00:00Z",
              trackingInfo: [{ company: "Carrier", number: "ABC123", url: "https://tracking.example/ABC123" }],
            },
          ],
        },
      ],
    },
  });

  assert.equal(reduced.length, 1);
  assert.equal(reduced[0].name, "#1001");
  assert.equal(reduced[0].total?.currencyCode, "ILS");
  assert.equal(reduced[0].lineItems[0].quantity, 1);
  assert.equal(reduced[0].fulfillments[0].tracking[0].number, "ABC123");
  assert.equal("email" in reduced[0], false);
  assert.equal("shippingAddress" in reduced[0], false);
});
