import assert from "node:assert/strict";
import test from "node:test";
import {
  getGrowthCockpitConfig,
  previousEquivalentGrowthCockpitRange,
  resolveGrowthCockpitRange,
} from "../src/lib/growth-cockpit-config.js";

const fixedNow = new Date("2026-08-25T10:00:00.000Z");

test("Growth Cockpit resolves calendar presets in the reporting timezone", () => {
  const today = resolveGrowthCockpitRange({ preset: "today", now: fixedNow, timezone: "Asia/Jerusalem" });
  assert.equal(today.localFrom, "2026-08-25");
  assert.equal(today.localTo, "2026-08-25");
  assert.equal(today.from, "2026-08-24T21:00:00.000Z");
  assert.equal(today.toExclusive, "2026-08-25T21:00:00.000Z");

  const yesterday = resolveGrowthCockpitRange({ preset: "yesterday", now: fixedNow, timezone: "Asia/Jerusalem" });
  assert.equal(yesterday.localFrom, "2026-08-24");
  assert.equal(yesterday.localTo, "2026-08-24");

  const lastSeven = resolveGrowthCockpitRange({ preset: "last_7_days", now: fixedNow, timezone: "Asia/Jerusalem" });
  assert.equal(lastSeven.localFrom, "2026-08-19");
  assert.equal(lastSeven.localTo, "2026-08-25");
});

test("Growth Cockpit rejects incomplete and reversed custom ranges", () => {
  assert.throws(() => resolveGrowthCockpitRange({ from: "2026-08-25", now: fixedNow }), /require valid from and to dates/);
  assert.throws(() => resolveGrowthCockpitRange({ from: "2026-08-26", to: "2026-08-25", now: fixedNow }), /cannot be after/);
  assert.throws(() => resolveGrowthCockpitRange({ preset: "last_90_days", now: fixedNow }), /Unsupported date preset/);
});

test("Growth Cockpit does not invent a reporting currency", () => {
  const missing = getGrowthCockpitConfig(() => "");
  assert.equal(missing.reportingCurrency, null);
  assert.equal(missing.reportingCurrencyConfigured, false);
  assert.equal(missing.access.document.enforced, true);
  assert.equal(missing.access.document.releaseBlocked, false);

  const configured = getGrowthCockpitConfig(name => name === "REPORTING_CURRENCY" ? "usd" : "");
  assert.equal(configured.reportingCurrency, "USD");
});

test("Growth Cockpit comparison uses completed equivalent calendar periods", () => {
  const today = resolveGrowthCockpitRange({ preset: "today", now: fixedNow, timezone: "Asia/Jerusalem" });
  assert.match(previousEquivalentGrowthCockpitRange(today).reason || "", /in progress/);

  const yesterday = resolveGrowthCockpitRange({ preset: "yesterday", now: fixedNow, timezone: "Asia/Jerusalem" });
  const previousYesterday = previousEquivalentGrowthCockpitRange(yesterday).range!;
  assert.equal(previousYesterday.localFrom, "2026-08-23");
  assert.equal(previousYesterday.localTo, "2026-08-23");

  const lastSeven = resolveGrowthCockpitRange({ preset: "last_7_days", now: fixedNow, timezone: "Asia/Jerusalem" });
  const previousSeven = previousEquivalentGrowthCockpitRange(lastSeven).range!;
  assert.equal(previousSeven.localFrom, "2026-08-12");
  assert.equal(previousSeven.localTo, "2026-08-18");

  const custom = resolveGrowthCockpitRange({ from: "2026-08-10", to: "2026-08-12", timezone: "Asia/Jerusalem" });
  const previousCustom = previousEquivalentGrowthCockpitRange(custom).range!;
  assert.equal(previousCustom.localFrom, "2026-08-07");
  assert.equal(previousCustom.localTo, "2026-08-09");
});
