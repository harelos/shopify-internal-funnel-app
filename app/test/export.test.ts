import assert from "node:assert/strict";
import test from "node:test";
import { buildFunnelReport, reportToCsv, reportToJson } from "../src/analytics.js";
import { createScenario } from "./helpers.js";

test("CSV and JSON exports identify test data and preserve analytics fields", () => {
  const { service, funnel } = createScenario();
  const report = buildFunnelReport(service.store, funnel.id);
  const csv = reportToCsv(report);
  const parsed = JSON.parse(reportToJson(report)) as typeof report;
  assert.match(csv, /data_mode/);
  assert.match(csv, /TEST/);
  assert.equal(parsed.dataMode, "TEST");
  assert.equal(parsed.funnelId, funnel.id);
  assert.equal(parsed.definitions.aov.includes("Attributed revenue"), true);
});
