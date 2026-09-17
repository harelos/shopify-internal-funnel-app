import test from "node:test";
import assert from "node:assert/strict";
import { renderSupportContextMarkdown } from "../src/lib/support-context.js";

test("support context renders approved facts and owner examples as Markdown", () => {
  const markdown = renderSupportContextMarkdown({
    approvedFacts: ["Delivery is available throughout Israel."],
    approvedExamples: [{ topic: "GENERAL_SHIPPING", customerMessage: "כמה זמן משלוח?", ownerReply: "בדרך כלל המשלוח מגיע בתוך כמה ימי עסקים." }],
  });
  assert.match(markdown, /## Approved store facts/);
  assert.match(markdown, /Delivery is available throughout Israel/);
  assert.match(markdown, /כמה זמן משלוח/);
  assert.match(markdown, /## Safety rules/);
});

test("support context never fabricates an example when none is approved", () => {
  const markdown = renderSupportContextMarkdown({ approvedFacts: [], approvedExamples: [] });
  assert.match(markdown, /No approved owner-reply examples/);
  assert.doesNotMatch(markdown, /Customer:\n\nundefined/);
});

