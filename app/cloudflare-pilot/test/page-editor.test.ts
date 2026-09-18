import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_TTL_MS, cleanEditorMarkup, editableHandle, missingAnchors, previewIsCurrent, previewPath, previewToken, validateBody, validateNova } from "../src/lib/page-editor.js";

describe("editableHandle", () => {
  it("opens sales pages and refuses everything else", () => {
    assert.equal(editableHandle("novahair-sales-staging"), "novahair-sales-staging");
    assert.equal(editableHandle("NovaHair-Sales-QA"), "novahair-sales-qa");
    assert.throws(() => editableHandle("contact"), /only opens sales/);
    assert.throws(() => editableHandle("../etc"), /not a page handle/);
  });
});

describe("validateBody", () => {
  const page = '<div class="nova"><section id="buy"><img id="galMain"><button id="mainCheckout"></button></section><div id="stickyBuyBar"></div></div>';
  it("accepts a body that keeps the anchors the scripts need", () => {
    assert.equal(validateBody(page, { requireAnchors: true }), page);
  });
  it("names the anchors a publish would lose", () => {
    assert.deepEqual(missingAnchors('<div id="buy"></div>'), ["mainCheckout", "stickyBuyBar", "galMain"]);
    assert.throws(() => validateBody('<div id="buy"></div>', { requireAnchors: true }), /#mainCheckout, #stickyBuyBar, #galMain/);
  });
  it("refuses empty and oversized bodies", () => {
    assert.throws(() => validateBody("", {}), /empty/);
    assert.throws(() => validateBody("x".repeat(950_000), {}), /limit/);
  });
});

describe("cleanEditorMarkup", () => {
  it("removes only the editor's own attributes", () => {
    const dirty = '<section data-nh-edit-id="7" contenteditable="true" spellcheck="false" data-nova-bundle="2">hi</section>';
    assert.equal(cleanEditorMarkup(dirty), '<section data-nova-bundle="2">hi</section>');
  });
});

describe("preview links", () => {
  it("mint a 32-hex token and point at the store's app proxy with the internal flag", () => {
    const token = previewToken();
    assert.match(token, /^[a-f0-9]{32}$/);
    assert.equal(previewPath("novahair-sales-staging", token), `/apps/funnels/page-preview/novahair-sales-staging?t=${token}&fc_internal=1`);
  });

  it("are current only with the matching token and within a day", () => {
    const token = previewToken();
    const created = 1_000_000_000_000;
    const row = { token, createdAt: new Date(created).toISOString() };
    assert.equal(previewIsCurrent(row, token, created + 60_000), true);
    assert.equal(previewIsCurrent(row, previewToken(), created + 60_000), false);
    assert.equal(previewIsCurrent(row, "not-a-token", created + 60_000), false);
    assert.equal(previewIsCurrent(row, token, created + PREVIEW_TTL_MS), false);
    assert.equal(previewIsCurrent(null, token, created), false);
  });
});

describe("validateNova", () => {
  it("accepts the page's .nova root and refuses anything else", () => {
    const nova = '<div class="nova rtl"><section id="buy"></section></div>';
    assert.equal(validateNova(nova), nova);
    assert.throws(() => validateNova(""), /no \.nova root/);
    assert.throws(() => validateNova('<section id="buy"></section>'), /must start with the page's \.nova/);
    assert.throws(() => validateNova(`<div class="nova">${"x".repeat(950_000)}</div>`), /limit/);
  });
});
