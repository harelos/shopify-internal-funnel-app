import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isTestNameAnswer, looksLikeInternalTraffic, INTERNAL_QUERY_FLAG } from "../src/lib/internal-traffic.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the team's own testing is recognised from the name it types", () => {
  // Eighteen of nineteen typed names in the live data were this word.
  for (const answer of ["בדיקה", "  בדיקה  ", "טסט", "test", "QA", "asdf", "123"]) {
    assert.equal(looksLikeInternalTraffic({ stepId: "ask_name", freeText: answer }), true, `missed ${answer}`);
  }
});

test("a real name is never mistaken for testing", () => {
  for (const name of ["רינת", "מיכל", "שרה כהן", "Dana"]) {
    assert.equal(looksLikeInternalTraffic({ stepId: "ask_name", freeText: name }), false, `wrongly flagged ${name}`);
  }
});

test("a test word outside the name field is left alone", () => {
  // A customer may legitimately write the word in a sentence elsewhere.
  assert.equal(isTestNameAnswer("problem", "בדיקה"), false);
  assert.equal(looksLikeInternalTraffic({ stepId: "problem", freeText: "עשיתי בדיקה אצל הרופא" }), false);
});

test("an explicit internal marker wins regardless of content", () => {
  assert.equal(looksLikeInternalTraffic({ internalFlag: "1" }), true);
  assert.equal(looksLikeInternalTraffic({ query: { [INTERNAL_QUERY_FLAG]: "true" } }), true);
  assert.equal(looksLikeInternalTraffic({ attribution: [`/pages/x?${INTERNAL_QUERY_FLAG}=1`] }), true);
});

test("the markers that already worked keep working", () => {
  for (const marker of ["codex_qa", "production_test", "production_qa", "popup-qa", "concierge_email_release_3"]) {
    assert.equal(looksLikeInternalTraffic({ attribution: [marker] }), true, `regressed on ${marker}`);
  }
});

test("ordinary customer traffic stays a customer", () => {
  assert.equal(looksLikeInternalTraffic({
    attribution: ["facebook", "paid", "/pages/novahair-sales-staging"],
    stepId: "situation", freeText: "",
  }), false);
});

test("neither assistant may speak about regulatory approval", () => {
  const concierge = readFileSync(path.join(root, "src/routes/ai-concierge.ts"), "utf8");
  const support = readFileSync(path.join(root, "src/lib/support-ai.ts"), "utf8");
  // A model asserted that approval was not required to a customer asking about
  // pregnancy. Both directions of that claim are now forbidden.
  assert.match(concierge, /אין למותג אישור משרד הבריאות/);
  assert.match(concierge, /אסור גם לומר שאישור אינו נדרש/);
  assert.match(support, /holds no Ministry of Health approval/);
  assert.match(support, /never state that approval is unnecessary/);
});
