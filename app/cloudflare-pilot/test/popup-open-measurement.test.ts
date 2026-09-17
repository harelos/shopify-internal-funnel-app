import assert from "node:assert/strict";
import test from "node:test";
import { popupOpenedSessionCount } from "../src/lib/popup-analytics.js";

const ev = (name: string, sessionId: string) => ({ id: `${name}:${sessionId}`, name, visitorId: null, payload: JSON.stringify({ sessionId }) });

test("a conversation proves the popup opened even when the view event is lost", () => {
  const result = popupOpenedSessionCount([
    ev("popup_view", "a"), ev("popup_ai_step", "a"),
    ev("popup_ai_step", "b"), ev("popup_ai_step", "b"),
    ev("popup_ai_step", "c"),
  ]);
  assert.equal(result.viewEvents, 1);
  assert.equal(result.inferredFromConversation, 2);
  assert.equal(result.opened, 3);
});

test("a session is never counted twice", () => {
  const result = popupOpenedSessionCount([
    ev("popup_view", "a"), ev("popup_view", "a"),
    ev("popup_ai_step", "a"), ev("popup_ai_step", "a"),
  ]);
  assert.equal(result.opened, 1);
  assert.equal(result.inferredFromConversation, 0);
});

test("a view without a conversation still counts as opened", () => {
  const result = popupOpenedSessionCount([ev("popup_view", "a"), ev("popup_closed", "a")]);
  assert.equal(result.opened, 1);
  assert.equal(result.viewEvents, 1);
});

test("unrelated events do not inflate the opened count", () => {
  const result = popupOpenedSessionCount([
    ev("popup_signal", "a"), ev("popup_eligible", "a"), ev("popup_suppressed", "b"),
  ]);
  assert.equal(result.opened, 0);
});

test("an empty period reports nothing rather than guessing", () => {
  const result = popupOpenedSessionCount([]);
  assert.deepEqual(result, { opened: 0, viewEvents: 0, inferredFromConversation: 0 });
});
