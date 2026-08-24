import test from "node:test";
import assert from "node:assert/strict";
import { defaultPopupCampaign, normalizeAndValidatePopupCampaign } from "../src/lib/popup-config-contract.js";

test("default popup campaign is valid and fail-safe close controls cannot be disabled", () => {
  const input = defaultPopupCampaign();
  const result = normalizeAndValidatePopupCampaign({
    ...input,
    safety: {
      ...input.safety,
      visibleCloseButton: false,
      escClose: false,
      localImmediateClose: false,
      restoreFocus: false,
      cleanupBodyScroll: false,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.config?.safety.visibleCloseButton, true);
  assert.equal(result.config?.safety.escClose, true);
  assert.equal(result.config?.safety.localImmediateClose, true);
  assert.equal(result.config?.safety.restoreFocus, true);
  assert.equal(result.config?.safety.cleanupBodyScroll, true);
});

test("default campaign excludes known-bad commerce traffic and targets Israel", () => {
  const input = defaultPopupCampaign();
  assert.equal(input.targeting.commerceTrafficMode, "exclude_known_bad");
  assert.deepEqual(input.targeting.qualifiedCountries, ["IL"]);

  const result = normalizeAndValidatePopupCampaign({
    ...input,
    targeting: {
      ...input.targeting,
      commerceTrafficMode: "invalid-mode",
      qualifiedCountries: ["il", "US", "not-a-country", "IL"],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.config?.targeting.commerceTrafficMode, "exclude_known_bad");
  assert.deepEqual(result.config?.targeting.qualifiedCountries, ["IL", "US"]);
});

test("variant allocation must total 10000 basis points", () => {
  const input = defaultPopupCampaign();
  input.variants[0].weightBasisPoints = 2000;
  input.variants[1].weightBasisPoints = 2000;
  const result = normalizeAndValidatePopupCampaign(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /10000 basis points/);
});

test("cart maximum cannot be lower than cart minimum", () => {
  const input = defaultPopupCampaign();
  input.targeting.cartMinSubtotal = 200;
  input.targeting.cartMaxSubtotal = 100;
  const result = normalizeAndValidatePopupCampaign(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /cartMaxSubtotal/);
});
