import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { shadeLine } from "../src/lib/shipment-outreach-text.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

/**
 * Every reply the owner writes is meant to teach the AI how he answers. Filing
 * them all as PENDING_REVIEW left 356 of his replies unused while the AI kept
 * drafting from 35 stale approved ones.
 */
test("an ordinary owner reply is approved for the AI on arrival", () => {
  const desk = read("src/services/support-desk.ts");
  assert.match(desk, /const teachable = ownerReply\.length >= 20/);
  assert.match(desk, /qualityStatus: teachable \? "APPROVED" : "PENDING_REVIEW"/);
  // A reply with no real customer message behind it teaches nothing.
  assert.match(desk, /inbound\.textBody && inbound\.textBody\.trim\(\)\.length >= 10/);
});

/**
 * The approve button posted and never handled a rejection, so a 409 on an
 * already-queued draft looked exactly like a dead button.
 */
test("a failed send says so instead of doing nothing", () => {
  const ui = read("public/admin/js/support.js");
  const approve = ui.slice(ui.indexOf("async function approveDraft"), ui.indexOf("async function rejectDraft"));
  assert.match(approve, /try \{/);
  assert.match(approve, /catch \(error\)/);
  assert.match(approve, /notify\(error\.message/);
  // The button must not stay stuck on "Sending…" after a failure.
  assert.match(approve, /button\.disabled = false/);
  // It is the Worker that sends now, not the Railway connector.
  assert.doesNotMatch(approve, /Namecheap mail connector/);
  const reject = ui.slice(ui.indexOf("async function rejectDraft"));
  assert.match(reject.slice(0, 600), /catch \(error\)/);
});

test("the only-variant placeholder never reaches a customer as a shade", () => {
  const order = (variantTitle: string | null) => ({ lineItems: { nodes: [{ name: "NovaHair", variantTitle, quantity: 1 }] } });
  assert.equal(shadeLine(order("Default Title")), "");
  // This store renders that placeholder in Hebrew, which reached a customer.
  assert.equal(shadeLine(order("ברירת מחדל")), "");
  assert.equal(shadeLine(order(null)), "");
  assert.equal(shadeLine(order("חום כהה")), " (חום כהה)");
});
