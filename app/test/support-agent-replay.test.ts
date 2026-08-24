import assert from "node:assert/strict";
import test from "node:test";

import { defaultSupportReplayCases, runDefaultSupportReplaySuite } from "../src/support/agent/evaluation.js";

test("common ecommerce support replay suite passes without an LLM key", () => {
  const suite = runDefaultSupportReplaySuite();
  assert.ok(defaultSupportReplayCases.length >= 20);
  assert.equal(suite.failed, 0, JSON.stringify(suite.results.filter((result) => !result.passed), null, 2));
  assert.equal(suite.passed, suite.total);
});
