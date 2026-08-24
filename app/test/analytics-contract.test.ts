import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { analyticsDataContract, analyticsModeForRequest } from "../src/lib/analytics-config.js";

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

test("live ingestion contract contains webhook reconciliation, pixel checkout events and commerce-session continuity", () => {
  const webhookSource = fs.readFileSync("src/routes/shopify-ingest.ts", "utf8");
  const pixelSource = fs.readFileSync("extensions/funnel-control-pixel/src/index.js", "utf8");
  const proxySource = fs.readFileSync("src/routes/proxy.ts", "utf8");
  assert.match(webhookSource, /orders\/paid/);
  assert.match(webhookSource, /orders\/updated/);
  assert.match(webhookSource, /shopifyWebhookDelivery/);
  assert.match(webhookSource, /sessionId:\s*textValue\(rawContext\.sessionId\)/);
  assert.match(pixelSource, /checkout_started/);
  assert.match(pixelSource, /checkout_completed/);
  assert.match(pixelSource, /_funnel_context/);
  assert.match(proxySource, /sessionId:\s*commerceSession\.id/);
  assert.match(proxySource, /landingPath:\s*commerceSession\.landingPath/);
});
