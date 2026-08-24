import assert from "node:assert/strict";
import test from "node:test";

import { runSupportAgentSimulation } from "../src/support/agent/engine.js";

test("WISMO uses Shopify facts and remains draft-only", () => {
  const result = runSupportAgentSimulation({
    message: "איפה ההזמנה שלי? יש מעקב?",
    locale: "he",
    facts: {
      order: {
        found: true,
        orderName: "#1234",
        trackingAvailable: true,
        trackingUrl: "https://tracking.example/1234",
        fulfillmentStatus: "FULFILLED",
      },
    },
  });

  assert.equal(result.intent, "shipping_status");
  assert.equal(result.decision, "AUTO_DRAFT");
  assert.equal(result.sendAllowed, false);
  assert.equal(result.shopifyMutationAllowed, false);
  assert.match(result.draft || "", /tracking\.example/);
  assert.ok(result.truthSources.includes("SHOPIFY"));
});

test("refund request can only propose a write and requires approval", () => {
  const result = runSupportAgentSimulation({
    message: "אני רוצה החזר כספי על ההזמנה",
    facts: {
      order: { found: true, orderName: "#55", financialStatus: "PAID" },
      knowledge: { returnPolicyKnown: true },
    },
  });

  assert.equal(result.intent, "refund_request");
  assert.equal(result.decision, "HUMAN_APPROVAL");
  assert.equal(result.requiresHuman, true);
  assert.equal(result.shopifyMutationAllowed, false);
  assert.ok(result.toolPlan.some((tool) => tool.tool === "PROPOSE_REFUND" && tool.mode === "PROPOSE_WRITE"));
});

test("discount request never invents a coupon", () => {
  const result = runSupportAgentSimulation({ message: "יש קופון או הנחה?" });
  assert.equal(result.intent, "discount_request");
  assert.equal(result.decision, "HUMAN_APPROVAL");
  assert.match(result.draft || "", /לא מייצר|authorized offer engine/i);
  assert.ok(result.toolPlan.some((tool) => tool.tool === "REQUEST_SERVER_OFFER"));
});

test("legal or chargeback language is human-only", () => {
  const result = runSupportAgentSimulation({ message: "אם לא תענו אני עושה chargeback ופונה לעורך דין" });
  assert.equal(result.intent, "legal_chargeback");
  assert.equal(result.decision, "HUMAN_ONLY");
  assert.equal(result.risk, "HIGH");
  assert.equal(result.draft, null);
});

test("unknown requests do not auto-resolve", () => {
  const result = runSupportAgentSimulation({ message: "יש לי שאלה קצת מוזרה שלא קשורה לשום דבר" });
  assert.equal(result.intent, "other");
  assert.equal(result.decision, "HUMAN_ONLY");
  assert.equal(result.sendAllowed, false);
});
