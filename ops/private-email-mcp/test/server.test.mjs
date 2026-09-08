import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../src/server.mjs"), "utf8");
const syncSource = fs.readFileSync(path.join(here, "../src/support-sync.mjs"), "utf8");

test("MCP exposes guarded customer-support agent tools", () => {
  for (const tool of ["support_sync", "support_agent_status", "support_list", "support_get", "support_draft", "support_approve"]) {
    assert.match(source, new RegExp(`['\"]${tool}['\"]`));
  }
  assert.match(source, /confirmSend:\s*z\.literal\(true\)/);
  assert.match(source, /This never sends email/);
});

test("support sync filters mail and never starts a loop when imported by MCP", () => {
  assert.match(syncSource, /triageClass:\s*"IGNORE"/);
  assert.match(syncSource, /pathToFileURL\(process\.argv\[1\]\)/);
  assert.match(syncSource, /SUPPORT_MAIL_SEND_ENABLED/);
});
