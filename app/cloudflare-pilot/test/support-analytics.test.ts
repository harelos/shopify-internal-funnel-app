import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSupportSendAuthorizations } from "../src/lib/support-analytics.js";

const since = new Date("2026-09-01T00:00:00.000Z");

test("support send reporting separates policy, owner, agent and legacy sends", () => {
  const drafts = [
    { id: "auto", status: "SENT", sentAt: new Date("2026-09-02T00:00:00.000Z") },
    { id: "owner", status: "SENT", sentAt: new Date("2026-09-03T00:00:00.000Z") },
    { id: "agent", status: "SENT", sentAt: new Date("2026-09-04T00:00:00.000Z") },
    { id: "legacy", status: "SENT", sentAt: new Date("2026-09-05T00:00:00.000Z") },
    { id: "failed", status: "FAILED", sentAt: null },
  ];
  const evidence = [
    { payloadJson: JSON.stringify({ draftId: "auto", actor: "AUTOMATION_POLICY" }) },
    { payloadJson: JSON.stringify({ draftId: "owner", actor: "OWNER_ADMIN" }) },
    { payloadJson: JSON.stringify({ draftId: "agent", actor: "AGENT_API" }) },
  ];
  assert.deepEqual(summarizeSupportSendAuthorizations(drafts, evidence, since), {
    total: 4,
    automatic: 1,
    ownerApproved: 1,
    agentApproved: 1,
    unclassified: 1,
  });
});

test("support send reporting excludes unsent and out-of-range drafts and ignores malformed evidence", () => {
  const drafts = [
    { id: "old", status: "SENT", sentAt: new Date("2026-08-31T23:59:59.000Z") },
    { id: "queued", status: "QUEUED_TO_SEND", sentAt: null },
  ];
  assert.deepEqual(summarizeSupportSendAuthorizations(drafts, [{ payloadJson: "not-json" }], since), {
    total: 0,
    automatic: 0,
    ownerApproved: 0,
    agentApproved: 0,
    unclassified: 0,
  });
});
