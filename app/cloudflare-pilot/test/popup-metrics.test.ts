import assert from "node:assert/strict";
import test from "node:test";
import {
  popupExperienceForVersion,
  popupSessionKey,
  uniquePopupSessionCount,
} from "../src/lib/popup-analytics.js";

test("popup analytics separates exit popup and AI Concierge versions", () => {
  assert.equal(popupExperienceForVersion("novahair_popup_v2"), "exit");
  assert.equal(popupExperienceForVersion("novahair_ai_v1"), "concierge");
});

test("popup funnel metrics count unique sessions instead of repeated events", () => {
  const events = [
    { id: "1", name: "popup_view", visitorId: "visitor-a", payload: JSON.stringify({ sessionId: "session-a" }) },
    { id: "2", name: "popup_view", visitorId: "visitor-a", payload: JSON.stringify({ sessionId: "session-a" }) },
    { id: "3", name: "popup_view", visitorId: "visitor-a", payload: JSON.stringify({ sessionId: "session-b" }) },
    { id: "4", name: "popup_closed", visitorId: "visitor-a", payload: JSON.stringify({ sessionId: "session-a" }) },
  ];
  assert.equal(uniquePopupSessionCount(events, "popup_view"), 2);
  assert.equal(uniquePopupSessionCount(events, "popup_closed"), 1);
  assert.equal(popupSessionKey(events[0]), "session:session-a");
});
