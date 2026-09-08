import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("deployed popup dashboard contains required operational sections and no mock dataset", () => {
  const html = readFileSync(new URL("../public/admin/popup-analytics.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/admin/js/popup-analytics.js", import.meta.url), "utf8");
  for (const label of ["Headline metrics", "Popup Funnel", "Coupon Performance", "Dismissals", "Submission Health", "Attributed Sales", "Recent Events"]) {
    assert.match(html, new RegExp(label, "i"));
  }
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(script, /\/api\/analytics\/popup/);
  assert.match(script, /popupAttributedRevenueByCurrency/);
  assert.match(script, /recentAttributedOrders/);
  assert.doesNotMatch(script, /mockData|Math\.random\(\).*revenue/i);
});

test("AI Concierge dashboard exposes Shopify sales and UTM impact without mock data", () => {
  const html = readFileSync(new URL("../public/admin/ai-concierge.html", import.meta.url), "utf8");
  assert.match(html, /השפעה ומכירות/);
  assert.match(html, /\/api\/analytics\/popup/);
  assert.match(html, /recentAttributedOrders/);
  assert.match(html, /recentLeads/);
  assert.match(html, /לידים שנשמרו ב־Shopify/);
  assert.match(html, /recentCouponOnlyOrders/);
  assert.match(html, /popupAttributedRevenueByCurrency/);
  assert.match(html, /analytics-(?:source|medium|campaign)/);
  assert.match(html, /signal-tracking/);
  assert.match(html, /holdout-percent/);
  assert.match(html, /novahair_exit_timing_v1/);
  assert.match(html, /metric\.exitSignals/);
  assert.doesNotMatch(html, /mockData|Math\.random\(\).*revenue/i);
});
