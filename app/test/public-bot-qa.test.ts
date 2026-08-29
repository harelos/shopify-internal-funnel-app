import test from "node:test";
import assert from "node:assert/strict";
import { publicQaEnabled, publicQaReadOnlyTool, verifyPublicQaToken } from "../src/lib/public-bot-qa.js";

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { fn(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("public QA is disabled by default", () => {
  withEnv({ BOT_PUBLIC_QA_MODE: undefined, BOT_PUBLIC_QA_TOKEN: "secret" }, () => {
    assert.equal(publicQaEnabled(), false);
    assert.equal(verifyPublicQaToken("secret"), false);
  });
});

test("public QA requires exact configured token when enabled", () => {
  withEnv({ BOT_PUBLIC_QA_MODE: "true", BOT_PUBLIC_QA_TOKEN: "secret-token" }, () => {
    assert.equal(verifyPublicQaToken("wrong"), false);
    assert.equal(verifyPublicQaToken("secret-token"), true);
  });
});

test("public QA tool allowlist contains read-only tools and excludes writes", () => {
  assert.equal(publicQaReadOnlyTool("product.read"), true);
  assert.equal(publicQaReadOnlyTool("order.read_scoped"), true);
  assert.equal(publicQaReadOnlyTool("offer.request"), false);
  assert.equal(publicQaReadOnlyTool("cart.prepare"), false);
  assert.equal(publicQaReadOnlyTool("resolution.request"), false);
  assert.equal(publicQaReadOnlyTool("risk.case_append"), false);
});
