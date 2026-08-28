import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("deployed popup dashboard contains required operational sections and no mock dataset", () => {
  const html = readFileSync(new URL("../public/admin/popup-analytics.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/admin/js/popup-analytics.js", import.meta.url), "utf8");
  for (const label of ["Headline metrics", "Popup Funnel", "Coupon Performance", "Dismissals", "Submission Health", "Recent Events"]) {
    assert.match(html, new RegExp(label, "i"));
  }
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(script, /\/api\/analytics\/popup/);
  assert.doesNotMatch(script, /mockData|Math\.random\(\).*revenue/i);
});
