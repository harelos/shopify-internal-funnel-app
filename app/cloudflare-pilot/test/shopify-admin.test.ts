import assert from "node:assert/strict";
import test from "node:test";
import { mergePopupLeadCandidates, type PopupLeadCandidate } from "../src/lib/popup-lead-candidates.ts";

function candidate(id: string, email: string): PopupLeadCandidate {
  return {
    id,
    email,
    tags: ["novahair-popup"],
    emailMarketingConsent: { marketingState: "SUBSCRIBED" },
  };
}

test("merges indexed and recent popup lead candidates without duplicate customers", () => {
  const indexed = candidate("gid://shopify/Customer/1", "indexed@example.com");
  const recent = candidate("gid://shopify/Customer/2", "recent@example.com");

  assert.deepEqual(
    mergePopupLeadCandidates([indexed], [indexed, recent]),
    [indexed, recent],
  );
});
