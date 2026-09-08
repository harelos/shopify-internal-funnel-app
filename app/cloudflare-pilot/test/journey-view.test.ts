import assert from "node:assert/strict";
import test from "node:test";
import { friendlyChannel, humanizeJourneyEvent, journeyDurationMinutes } from "../src/lib/journey-view.js";

test("customer journeys translate technical attribution into owner-readable channels", () => {
  assert.equal(friendlyChannel("facebook", "paid_social"), "Facebook / Instagram ad");
  assert.equal(friendlyChannel("google", "organic"), "Organic search");
  assert.equal(friendlyChannel("newsletter", "email"), "Email");
  assert.equal(friendlyChannel(null, null), "Direct or unattributed");
});

test("customer journeys expose useful section and gallery detail without PII", () => {
  const entry = humanizeJourneyEvent({
    name: "faq_item_opened",
    occurredAt: "2026-09-08T10:00:00.000Z",
    payload: JSON.stringify({ question: "How long is shipping? buyer@example.com", path: "/pages/novahair-sales-staging" }),
  });
  assert.equal(entry?.label, "Opened a frequently asked question");
  assert.equal(entry?.detail, "How long is shipping? [private]");
  assert.equal(entry?.page, "/pages/novahair-sales-staging");
  assert.equal(humanizeJourneyEvent({ name: "consent_changed", occurredAt: new Date(), payload: "{}" }), null);
});

test("customer journey duration is bounded by the first verified touchpoint", () => {
  const timeline = [{ at: "2026-09-08T10:00:00.000Z", category: "visit" as const, label: "Viewed a page", detail: null, page: null }];
  assert.equal(journeyDurationMinutes(timeline, "2026-09-08T10:42:00.000Z"), 42);
  assert.equal(journeyDurationMinutes([], "2026-09-08T10:42:00.000Z"), null);
});

