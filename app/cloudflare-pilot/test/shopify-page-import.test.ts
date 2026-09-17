import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAndPrepareShopifyPage,
  ShopifyPageImportError,
  validateShopifyPageUrl,
} from "../src/lib/shopify-page-import.ts";

const storeOptions = {
  shopDomain: "jacobfelipe.myshopify.com",
  storefrontDomain: "tigerbrandsglobal.com",
};

test("accepts a configured Shopify storefront URL", () => {
  const url = validateShopifyPageUrl(
    "https://tigerbrandsglobal.com/pages/novahair-7-reasons-staging",
    storeOptions,
  );
  assert.equal(url.hostname, "tigerbrandsglobal.com");
});

test("rejects a page from an unapproved host", () => {
  assert.throws(
    () => validateShopifyPageUrl("https://example.com/page", storeOptions),
    (error: unknown) => error instanceof ShopifyPageImportError && /configured Shopify store/i.test(error.message),
  );
});

test("imports HTML while preserving title and inline styles and removing scripts", async () => {
  const html = `<!doctype html><html><head><title>NovaHair Reasons</title><style>.hero{color:red}</style><script>alert(1)</script></head><body><main class="hero"><img src="/cdn/image.webp"><a href="/pages/next">Continue</a></main></body></html>`;
  const result = await fetchAndPrepareShopifyPage(
    "https://tigerbrandsglobal.com/pages/novahair-7-reasons-staging",
    {
      ...storeOptions,
      fetcher: async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    },
  );

  assert.equal(result.title, "NovaHair Reasons");
  assert.match(result.normalizedHtml, /\.hero\{color:red\}/);
  assert.match(result.normalizedHtml, /https:\/\/tigerbrandsglobal\.com\/cdn\/image\.webp/);
  assert.doesNotMatch(result.normalizedHtml, /<script/i);
  assert.equal(result.report.scriptsRemoved, 1);
});

test("rejects non-HTML responses", async () => {
  await assert.rejects(
    () => fetchAndPrepareShopifyPage("https://tigerbrandsglobal.com/pages/data", {
      ...storeOptions,
      fetcher: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    }),
    (error: unknown) => error instanceof ShopifyPageImportError && /HTML page/i.test(error.message),
  );
});

test("enforces the import byte limit before storing a page", async () => {
  await assert.rejects(
    () => fetchAndPrepareShopifyPage("https://tigerbrandsglobal.com/pages/large", {
      ...storeOptions,
      maxBytes: 10,
      fetcher: async () => new Response("01234567890", { status: 200, headers: { "content-type": "text/html" } }),
    }),
    (error: unknown) => error instanceof ShopifyPageImportError && error.status === 413,
  );
});
