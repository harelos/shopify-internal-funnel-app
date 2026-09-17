import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanEditorMarkup, editableHandle, missingAnchors, validateBody } from "../src/lib/page-editor.js";

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
