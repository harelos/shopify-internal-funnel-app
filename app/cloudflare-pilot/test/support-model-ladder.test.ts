import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ladderOf(file: string): string[] {
  const source = readFileSync(path.join(root, file), "utf8");
  const start = source.indexOf("const MODEL_LADDER = [");
  assert.ok(start >= 0, `${file} has no model ladder`);
  const block = source.slice(start, source.indexOf("];", start));
  return [...block.matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

const FILES = ["src/lib/support-ai.ts", "src/routes/ai-concierge.ts"];

test("every fallback model is a paid tier, not a rate-limited free one", () => {
  for (const file of FILES) {
    for (const model of ladderOf(file)) {
      // Free tiers were exhausted by other tenants, which is how a whole day of
      // replies ended up escalated instead of sent.
      assert.doesNotMatch(model, /:free$/, `${file} still falls back to ${model}`);
    }
  }
});

test("a hiccup on the primary model has somewhere real to fall", () => {
  for (const file of FILES) {
    const ladder = ladderOf(file);
    assert.ok(ladder.length >= 3, `${file} has only ${ladder.length} model(s)`);
    assert.equal(new Set(ladder).size, ladder.length, `${file} repeats a model`);
    // Spread across providers, so one provider outage cannot empty the ladder.
    const providers = new Set(ladder.map(model => model.split("/")[0]));
    assert.ok(providers.size >= 3, `${file} depends on only ${providers.size} provider(s)`);
  }
});

test("models that no longer exist are not carried forward", () => {
  const retired = ["minimax/minimax-m2.7:free", "z-ai/glm-5.2:free", "google/gemma-4-31b-it:free"];
  for (const file of FILES) {
    const ladder = ladderOf(file);
    for (const model of retired) {
      assert.ok(!ladder.includes(model), `${file} still lists the retired ${model}`);
    }
  }
});

test("a model is never aborted faster than it is known to answer", () => {
  const support = readFileSync(path.join(root, "src/lib/support-ai.ts"), "utf8");
  const concierge = readFileSync(path.join(root, "src/routes/ai-concierge.ts"), "utf8");

  // Measured worst case for the support primary was 13s; aborting at 8s scored
  // a healthy model as a failure and escalated the reply instead of sending it.
  const supportTimeout = Number(/SUPPORT_MODEL_TIMEOUT_MS = ([0-9_]+)/.exec(support)?.[1].replace(/_/g, ""));
  const supportDeadline = Number(/SUPPORT_DEADLINE_MS = ([0-9_]+)/.exec(support)?.[1].replace(/_/g, ""));
  assert.ok(supportTimeout >= 15000, `support aborts a model after ${supportTimeout}ms`);
  assert.ok(supportDeadline >= supportTimeout * 2, "the support budget leaves no room for a fallback");

  // Measured worst case for the slowest concierge model was 3.8s.
  const chatTimeout = Number(/MODEL_TIMEOUT_MS = ([0-9_]+)/.exec(concierge)?.[1].replace(/_/g, ""));
  const chatDeadline = Number(/CHAT_DEADLINE_MS = ([0-9_]+)/.exec(concierge)?.[1].replace(/_/g, ""));
  assert.ok(chatTimeout >= 5000, `the concierge aborts a model after ${chatTimeout}ms`);
  assert.ok(chatDeadline >= chatTimeout * 2, "the concierge budget leaves no room for a fallback");
  // A shopper is waiting, so the budget still has to stay bounded.
  assert.ok(chatDeadline <= 20000, "the concierge would keep a shopper waiting too long");
});

test("each surface leads with the model the benchmark ranked first for its job", () => {
  const support = ladderOf("src/lib/support-ai.ts");
  const chat = ladderOf("src/routes/ai-concierge.ts");
  for (const ladder of [support, chat]) {
    // glm returned an empty body for nine of twenty messages at the production
    // token cap, including a chargeback threat.
    assert.ok(!ladder.includes("z-ai/glm-5.3-flash"), "glm is back in a ladder");
    // gpt-4.1-mini scored 1.3 on factual traps and asserted a regulatory claim.
    assert.notEqual(ladder[0], "openai/gpt-4.1-mini", "a ladder leads with the model that invented a regulatory claim");
  }
  // Service is judged on truth and tone; the shopper chat is judged on selling.
  assert.equal(support[0], "google/gemini-2.5-flash-lite", "support does not lead with the service winner");
  assert.equal(chat[0], "openai/gpt-5.6-luna", "the shopper chat does not lead with the sales winner");
  assert.ok(support.includes("openai/gpt-5.6-luna"), "support has no strong fallback");
});

test("reasoning effort stays where selling was measured to be strongest", () => {
  for (const file of FILES) {
    const source = readFileSync(path.join(root, file), "utf8");
    // High effort took 7.5s and deflected shoppers to customer service instead
    // of answering, halving the selling score.
    assert.match(source, /const REASONING_EFFORT = "minimal"/, `${file} does not pin the measured effort`);
    assert.match(source, /reasoning: \{ effort: REASONING_EFFORT \}/, `${file} does not use the pinned effort`);
    assert.doesNotMatch(source, /effort: "(high|medium)"/, `${file} raises effort above what was measured`);
  }
});

test("the shopper-facing prompt keeps the fact boundary above the sales technique", () => {
  const concierge = readFileSync(path.join(root, "src/routes/ai-concierge.ts"), "utf8");
  // Pushing a model to sell cost 0.7 points of factual accuracy in the
  // benchmark, so the boundary is restated after the technique, not before it.
  const technique = concierge.indexOf("אל תפני אותה לשירות הלקוחות");
  const boundary = concierge.indexOf("גבול העובדות");
  assert.ok(technique > 0, "the selling technique is missing");
  assert.ok(boundary > technique, "the fact boundary must follow the selling technique");
  assert.match(concierge, /מוטב להפסיד מכירה מאשר לומר משפט שאינו נתמך/);
});

test("the shopper-facing prompt opens with a promise and knows when to ask for the email", () => {
  const concierge = readFileSync(path.join(root, "src/routes/ai-concierge.ts"), "utf8");
  // 91% of shoppers left on a first screen that asked them to classify
  // themselves before receiving anything.
  assert.match(concierge, /הודעה ראשונה היא הבטחה, לא שאלה/);
  assert.match(concierge, /אל תבקשי ממנה לסווג את עצמה/);
  assert.match(concierge, /אל תבקשי שם/);
  // The email ask must gate the recommendation, which measures 45-55% against
  // 25-35% when it follows the result instead.
  assert.match(concierge, /בקשי את המייל לפני שאת מוסרת אותה/);
  assert.match(concierge, /לא הנחה/);
  assert.match(concierge, /להמשיך בלי למסור מייל/);
  assert.match(concierge, /אל תבקשי יותר מפעם אחת/);
});
