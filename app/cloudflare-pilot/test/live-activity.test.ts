import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deviceClass, normalizeBeaconBatch, summarizeSessions, type LiveRow } from "../src/lib/live-activity.js";

const NOW = Date.parse("2026-09-18T10:00:00Z");

describe("normalizeBeaconBatch", () => {
  it("keeps recognised events, clamps timestamps and bounds text", () => {
    const batch = normalizeBeaconBatch({
      sessionKey: "sess_abcdefgh", visitorKey: "vis_abcdefgh", page: "/pages/novahair-sales-staging",
      device: "iphone-instagram", source: "instagram / cpc", variant: "full_adaptive", isInternal: false,
      events: [
        { kind: "bundle", label: "chose 2 bottles", detail: { bundle: 2, price: 189 }, at: NOW - 1000 },
        { kind: "nonsense", label: "x", at: NOW },
        { kind: "click", label: "x".repeat(500), detail: { text: "y".repeat(500), nested: { a: 1 } }, at: NOW - 999_999 },
      ],
    }, NOW);
    assert.equal(batch.events.length, 2);
    assert.equal(batch.events[0].detail.bundle, 2);
    assert.equal(batch.events[1].label.length, 120);
    assert.equal(batch.events[1].at, NOW, "a timestamp far in the past is replaced with now");
    assert.equal(typeof batch.events[1].detail.nested, "string", "nested objects become text, never stored as objects");
  });
  it("rejects a batch without keys or without usable events", () => {
    assert.throws(() => normalizeBeaconBatch({ sessionKey: "short", visitorKey: "vis_abcdefgh", events: [{ kind: "view" }] }), /session key/);
    assert.throws(() => normalizeBeaconBatch({ sessionKey: "sess_abcdefgh", visitorKey: "vis_abcdefgh", events: [{ kind: "bogus" }] }), /No recognised/);
  });
});

describe("summarizeSessions", () => {
  const row = (over: Partial<LiveRow>): LiveRow => ({
    id: Math.random().toString(36).slice(2), sessionKey: "s1", visitorKey: "v1", occurredAt: new Date(NOW - 60_000).toISOString(),
    receivedAt: new Date(NOW - 60_000).toISOString(), kind: "view", label: "landed", page: "/pages/x", detail: "{}",
    device: "iphone", source: "instagram", variant: "value_delta", isInternal: 0, ...over,
  });
  it("folds a session into one card with the steps it reached", () => {
    const sessions = summarizeSessions([
      row({ kind: "view", label: "landed", occurredAt: new Date(NOW - 90_000).toISOString() }),
      row({ kind: "shade", label: "picked black", detail: JSON.stringify({ shade: "black" }), occurredAt: new Date(NOW - 80_000).toISOString() }),
      row({ kind: "bundle", label: "chose 2 bottles", detail: JSON.stringify({ bundle: 2 }), occurredAt: new Date(NOW - 70_000).toISOString() }),
      row({ kind: "module", label: "saw upgrade offer", detail: JSON.stringify({ module: "value_delta" }), occurredAt: new Date(NOW - 60_000).toISOString() }),
      row({ kind: "cart_add", label: "added to cart", occurredAt: new Date(NOW - 50_000).toISOString() }),
      row({ kind: "section", label: "reached reviews", occurredAt: new Date(NOW - 40_000).toISOString() }),
    ], NOW);
    assert.equal(sessions.length, 1);
    const s = sessions[0];
    assert.equal(s.events, 6);
    assert.equal(s.reached.shade, "black");
    assert.equal(s.reached.bundle, "2");
    assert.equal(s.reached.cart, true);
    assert.equal(s.reached.checkout, false);
    assert.deepEqual(s.modules, ["value_delta"]);
    assert.equal(s.lastLabel, "added to cart", "section views do not overwrite the last real action");
    assert.equal(s.active, true);
  });
  it("marks a session idle after the active window and sorts newest first", () => {
    const sessions = summarizeSessions([
      row({ sessionKey: "old", occurredAt: new Date(NOW - 10 * 60_000).toISOString() }),
      row({ sessionKey: "new", occurredAt: new Date(NOW - 5_000).toISOString() }),
    ], NOW);
    assert.equal(sessions[0].sessionKey, "new");
    assert.equal(sessions[0].active, true);
    assert.equal(sessions[1].active, false);
  });
});

describe("deviceClass", () => {
  it("tells the in-app browsers apart from plain phones", () => {
    assert.equal(deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/430.0.0]"), "iphone-facebook");
    assert.equal(deviceClass("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Instagram 300.0.0"), "android-instagram");
    assert.equal(deviceClass("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/152 Mobile"), "android");
    assert.equal(deviceClass("Mozilla/5.0 (Windows NT 10.0) Chrome/152"), "desktop");
  });
});
