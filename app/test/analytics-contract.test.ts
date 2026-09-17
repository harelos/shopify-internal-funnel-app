import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { analyticsDataContract, analyticsModeForRequest } from "../src/lib/analytics-config.js";
import {
  cartContextFromEvent,
  FUNNEL_CONTROL_PIXEL_ENDPOINT,
  reduceCheckoutEvent,
  resolvePixelEndpoint,
} from "../extensions/funnel-control-pixel/src/runtime.js";

test("analytics mode defaults to TEST and never becomes LIVE from a query string", () => {
  const previous = process.env.ANALYTICS_MODE;
  const previousAllow = process.env.ANALYTICS_ALLOW_TEST_QUERY;
  delete process.env.ANALYTICS_MODE;
  delete process.env.ANALYTICS_ALLOW_TEST_QUERY;
  try {
    assert.equal(analyticsModeForRequest({ mode: "LIVE" }), "TEST");
    assert.equal(analyticsModeForRequest({ mode: "TEST" }), "TEST");
    assert.deepEqual(analyticsDataContract("TEST"), {
      dataMode: "TEST",
      dataSource: "LOCAL_TEST",
      sampleSizeCaveat: "These values are local TEST data and are not Shopify store analytics.",
    });
  } finally {
    if (previous === undefined) delete process.env.ANALYTICS_MODE; else process.env.ANALYTICS_MODE = previous;
    if (previousAllow === undefined) delete process.env.ANALYTICS_ALLOW_TEST_QUERY; else process.env.ANALYTICS_ALLOW_TEST_QUERY = previousAllow;
  }
});

test("live ingestion contract contains both webhook reconciliation and pixel checkout events", () => {
  const webhookSource = fs.readFileSync("src/routes/shopify-ingest.ts", "utf8");
  const pixelSource = fs.readFileSync("extensions/funnel-control-pixel/src/index.js", "utf8");
  assert.match(webhookSource, /orders\/paid/);
  assert.match(webhookSource, /orders\/updated/);
  assert.match(webhookSource, /shopifyWebhookDelivery/);
  assert.match(pixelSource, /checkout_started/);
  assert.match(pixelSource, /checkout_completed/);
});

test("checkout pixel always uses the fixed app-owned ingestion endpoint", () => {
  assert.equal(resolvePixelEndpoint(undefined), FUNNEL_CONTROL_PIXEL_ENDPOINT);
  assert.equal(resolvePixelEndpoint(""), FUNNEL_CONTROL_PIXEL_ENDPOINT);
  assert.equal(resolvePixelEndpoint("https://example.com/collect"), FUNNEL_CONTROL_PIXEL_ENDPOINT);
  assert.equal(resolvePixelEndpoint(FUNNEL_CONTROL_PIXEL_ENDPOINT), FUNNEL_CONTROL_PIXEL_ENDPOINT);
});

test("checkout pixel removes protected customer data before network transit", () => {
  const reduced = reduceCheckoutEvent({
    id: "evt-1",
    name: "checkout_completed",
    timestamp: "2026-09-08T12:00:00.000Z",
    data: {
      checkout: {
        token: "checkout-token",
        email: "customer@example.com",
        phone: "+972500000000",
        shippingAddress: {address1: "Secret street"},
        lineItems: [{title: "Private item"}],
        attributes: [{key: "customer_note", value: "secret"}],
        order: {id: "gid://shopify/Order/123", customer: {id: "gid://shopify/Customer/456", email: "customer@example.com"}},
      },
    },
  });

  assert.deepEqual(reduced, {
    id: "evt-1",
    name: "checkout_completed",
    timestamp: "2026-09-08T12:00:00.000Z",
    data: {
      checkout: {
        token: "checkout-token",
        order: {
          id: "gid://shopify/Order/123",
          customer: {id: "gid://shopify/Customer/456"},
        },
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(reduced), /customer@example|Secret street|Private item|customer_note/);
});

test("checkout pixel reads only the app-owned private cart attribute", () => {
  const context = cartContextFromEvent({
    data: {checkout: {attributes: [
      {key: "customer_note", value: "do not collect"},
      {key: "__funnel_context__", value: JSON.stringify({visitorId: "visitor-1"})},
    ]}},
  });
  assert.deepEqual(context, {visitorId: "visitor-1"});
});
