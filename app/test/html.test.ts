import assert from "node:assert/strict";
import test from "node:test";
import { renderSandboxDocument } from "../src/portability.js";
import { createScenario } from "./helpers.js";

test("import reports unsafe markup, preview excludes script, and publish locks the version", () => {
  const { service, control } = createScenario();
  const version = service.importHtml(control.id, "<!doctype html><html><head><script>window.pwned=true</script></head><body><button onclick=\"window.pwned=true\">Buy</button></body></html>");
  const preview = renderSandboxDocument(version.normalizedHtml);
  assert.equal(version.portabilityReport.scriptsRemoved, 1);
  assert.match(version.portabilityReport.findings.map((finding) => finding.severity).join(","), /review/);
  assert.doesNotMatch(preview, /pwned/);
  service.publishVersion(version.id);
  assert.throws(() => service.updateDraftVersion(version.id, "<main>changed</main>"), /immutable/);
});
