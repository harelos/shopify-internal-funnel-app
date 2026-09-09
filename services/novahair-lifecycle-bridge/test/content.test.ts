import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildTemplateManifest } from "../scripts/lib/template-render.mjs";

const source = JSON.parse(await readFile(new URL("../content/flows.json", import.meta.url), "utf8"));
const manifest = buildTemplateManifest(source);

function isInternalLine(line: string): boolean {
  return line === "IMPLEMENTATION RULES — SHOPIFY MESSAGING"
    || line === "GROWTH TEAM PRIORITY ORDER"
    || /^הערת Growth(?: Team)?:/u.test(line)
    || /^Growth Test אופציונלי:/u.test(line);
}

test("master plan produces exactly 39 Hebrew-first lifecycle templates", () => {
  assert.equal(source.flows.length, 6);
  assert.equal(manifest.count, 39);
  assert.deepEqual(source.flows.map((flow: { emails: unknown[] }) => flow.emails.length), [10, 10, 5, 3, 7, 4]);
});

test("every template is RTL, mobile-first, unsubscribable, and marker-free", () => {
  for (const template of manifest.templates) {
    assert.match(template.html, /<html lang="he" dir="rtl">/);
    assert.match(template.html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0"/);
    assert.match(template.html, /style="width:100%;max-width:600px;/);
    assert.match(template.html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
    assert.doesNotMatch(template.html, /<style>|<div\b/i);
    assert.doesNotMatch(template.html, /style="[^"]*(?:padding|margin|background|border):/i);
    assert.doesNotMatch(template.html, /IMPLEMENTATION RULES|GROWTH TEAM PRIORITY ORDER|\[(?:בלוק|כפתור|קישור|כאן להכניס)/u);
    assert.doesNotMatch(template.text, /IMPLEMENTATION RULES|GROWTH TEAM PRIORITY ORDER|\[(?:בלוק|כפתור|קישור|כאן להכניס)/u);
  }
});

test("approved subject, preview, copy, and CTA are retained", () => {
  for (const flow of source.flows) {
    const flowTemplates = manifest.templates.filter((template: { flow: string }) => template.flow === ({
      "ABANDONED CHECKOUT": "abandoned_checkout",
      WELCOME: "welcome",
      "ABANDONED CART": "abandoned_cart",
      "BROWSE ABANDONMENT": "browse_abandonment",
      "POST-PURCHASE": "post_purchase",
      "REPLENISHMENT / WINBACK": "replenishment",
    } as Record<string, string>)[flow.name]);
    for (const email of flow.emails) {
      const template = flowTemplates.find((item: { email_number: number }) => item.email_number === email.number);
      assert.ok(template, `${flow.name} E${email.number}`);
      assert.equal(template.subject, email.subject);
      assert.equal(template.preview, email.preview);
      const boundary = email.body.findIndex(isInternalLine);
      const lines = (boundary >= 0 ? email.body.slice(0, boundary) : email.body)
        .filter((line: string) => !line.startsWith("["));
      for (const line of lines) {
        const normalized = line.replaceAll("[שם פרטי]", "{{{CUSTOMER_NAME}}}");
        assert.ok(template.text.includes(normalized), `${template.alias} omitted approved line: ${line}`);
      }
    }
  }
});

test("all customer-facing commercial links resolve only through CTA_URL", () => {
  for (const template of manifest.templates) {
    const hrefs = [...template.html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    assert.ok(hrefs.length >= 1);
    for (const href of hrefs) {
      assert.ok(["{{{CTA_URL}}}", "{{{RESEND_UNSUBSCRIBE_URL}}}"].includes(href), `${template.alias}: ${href}`);
    }
  }
});
