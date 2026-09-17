import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const monitor = readFileSync(path.join(root, "src/services/novahair-monitor.ts"), "utf8");

test("a pre-issued CJ token is used without an exchange", () => {
  // Every API key on the account is rejected while the issued token works, and
  // the exchange endpoint is the part CJ rate-limits.
  assert.match(monitor, /const issued = getEnvVar\("CJ_ACCESS_TOKEN"\)/);
  assert.match(monitor, /if \(issued\) return issued;/);
  // Inside getCjToken, the issued token must be returned before the exchange
  // is reached. The URL constant itself is declared earlier in the file.
  const fn = monitor.slice(monitor.indexOf("async function getCjToken"));
  const body = fn.slice(0, fn.indexOf("\nasync function", 1));
  const issuedAt = body.indexOf("CJ_ACCESS_TOKEN");
  const exchange = body.indexOf("CJ_AUTH_URL");
  assert.ok(issuedAt >= 0, "getCjToken never reads the issued token");
  assert.ok(exchange > issuedAt, "the exchange must only run when no token is configured");
});
