import type { SupportAgentDecision, SupportAgentInput, SupportIntent, SupportToolName } from "./contracts.js";
import { runSupportAgentSimulation } from "./engine.js";

export type SupportReplayCase = {
  id: string;
  input: SupportAgentInput;
  expectedIntent: SupportIntent;
  expectedDecision: SupportAgentDecision;
  requiredTools?: SupportToolName[];
  forbiddenDraftPatterns?: RegExp[];
};

export type SupportReplayResult = {
  id: string;
  passed: boolean;
  errors: string[];
};

export const defaultSupportReplayCases: SupportReplayCase[] = [
  {
    id: "wismo-he",
    input: { message: "איפה ההזמנה שלי? יש מעקב?", facts: { order: { found: true, orderName: "#TEST1", trackingAvailable: true, trackingUrl: "https://tracking.example/test" } } },
    expectedIntent: "shipping_status",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_SHOPIFY_ORDER", "READ_TRACKING"],
  },
  {
    id: "wismo-missing-order",
    input: { message: "Where is my order?" , locale: "en" },
    expectedIntent: "shipping_status",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_SHOPIFY_ORDER"],
  },
  {
    id: "shipping-policy",
    input: { message: "כמה זמן משלוח?" },
    expectedIntent: "shipping_policy",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_STORE_POLICY"],
  },
  {
    id: "delivered-not-received",
    input: { message: "The package says delivered but I did not receive it" },
    expectedIntent: "delivery_issue",
    expectedDecision: "HUMAN_APPROVAL",
    requiredTools: ["READ_SHOPIFY_ORDER", "READ_TRACKING", "ESCALATE_HUMAN"],
  },
  {
    id: "cancel-order",
    input: { message: "Please cancel my order" },
    expectedIntent: "order_cancel",
    expectedDecision: "HUMAN_APPROVAL",
    requiredTools: ["READ_SHOPIFY_ORDER", "PROPOSE_CANCEL_ORDER"],
  },
  {
    id: "change-address",
    input: { message: "שמתי כתובת לא נכונה, אפשר שינוי כתובת?" },
    expectedIntent: "address_change",
    expectedDecision: "HUMAN_APPROVAL",
    requiredTools: ["READ_SHOPIFY_ORDER", "PROPOSE_ADDRESS_CHANGE"],
  },
  {
    id: "change-order",
    input: { message: "I need to change an item in my order" },
    expectedIntent: "order_change",
    expectedDecision: "HUMAN_APPROVAL",
    requiredTools: ["READ_SHOPIFY_ORDER", "PROPOSE_ORDER_EDIT"],
  },
  {
    id: "return-request",
    input: { message: "I want to return an item" },
    expectedIntent: "return_request",
    expectedDecision: "HUMAN_APPROVAL",
    requiredTools: ["READ_SHOPIFY_ORDER", "READ_STORE_POLICY", "PROPOSE_RETURN"],
  },
  {
    id: "return-status",
    input: { message: "What is the status of my return?" },
    expectedIntent: "return_status",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_RETURN_STATUS"],
  },
  {
    id: "exchange-request",
    input: { message: "I want to exchange this item for another shade" },
    expectedIntent: "exchange_request",
    expectedDecision: "HUMAN_APPROVAL",
    requiredTools: ["READ_SHOPIFY_ORDER", "READ_STORE_POLICY", "PROPOSE_EXCHANGE"],
  },
  {
    id: "exchange-status",
    input: { message: "What is the status of my exchange?" },
    expectedIntent: "exchange_status",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_RETURN_STATUS"],
  },
  {
    id: "refund-request",
    input: { message: "אני רוצה החזר כספי" },
    expectedIntent: "refund_request",
    expectedDecision: "HUMAN_APPROVAL",
    requiredTools: ["READ_SHOPIFY_ORDER", "READ_STORE_POLICY", "PROPOSE_REFUND"],
    forbiddenDraftPatterns: [/\b(?:5|10|15|20)%\b/i, /coupon|קופון/i],
  },
  {
    id: "refund-status",
    input: { message: "When will my refund arrive?" },
    expectedIntent: "refund_status",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_SHOPIFY_ORDER"],
  },
  {
    id: "damaged-item",
    input: { message: "המוצר הגיע פגום" },
    expectedIntent: "damaged_item",
    expectedDecision: "HUMAN_APPROVAL",
    requiredTools: ["READ_SHOPIFY_ORDER", "PROPOSE_RESHIP"],
  },
  {
    id: "wrong-item",
    input: { message: "I received the wrong item" },
    expectedIntent: "wrong_missing_item",
    expectedDecision: "HUMAN_APPROVAL",
    requiredTools: ["READ_SHOPIFY_ORDER", "PROPOSE_RESHIP"],
  },
  {
    id: "product-usage",
    input: { message: "איך משתמשים במוצר?", productKey: "synthetic-product" },
    expectedIntent: "product_usage",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_PRODUCT_FACTS"],
  },
  {
    id: "product-question",
    input: { message: "Does the product contain this ingredient?" },
    expectedIntent: "product_question",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_PRODUCT_FACTS"],
  },
  {
    id: "product-recommendation",
    input: { message: "Which product do you recommend?" },
    expectedIntent: "product_recommendation",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_PRODUCT_FACTS"],
  },
  {
    id: "shade-recommendation",
    input: { message: "איזה גוון מתאים לי?" },
    expectedIntent: "shade_recommendation",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_PRODUCT_FACTS"],
  },
  {
    id: "stock-request",
    input: { message: "Is this shade in stock?" },
    expectedIntent: "stock_request",
    expectedDecision: "AUTO_DRAFT",
    requiredTools: ["READ_PRODUCT_FACTS"],
  },
  {
    id: "discount-request",
    input: { message: "יש קופון או הנחה?" },
    expectedIntent: "discount_request",
    expectedDecision: "HUMAN_APPROVAL",
    requiredTools: ["REQUEST_SERVER_OFFER"],
    forbiddenDraftPatterns: [/\b(?:5|10|15|20)%\b/i, /[A-Z0-9]{6,}.*coupon/i],
  },
  {
    id: "feedback",
    input: { message: "רציתי להגיד שהחוויה הייתה מעולה, פידבק קטן" },
    expectedIntent: "feedback",
    expectedDecision: "AUTO_DRAFT",
  },
  {
    id: "thanks-close",
    input: { message: "תודה רבה!" },
    expectedIntent: "thanks_no_reply",
    expectedDecision: "NO_REPLY",
  },
  {
    id: "legal-escalation",
    input: { message: "I will do a chargeback and contact a lawyer" },
    expectedIntent: "legal_chargeback",
    expectedDecision: "HUMAN_ONLY",
    requiredTools: ["ESCALATE_HUMAN"],
  },
  {
    id: "unknown-escalation",
    input: { message: "blorp zeta uncommon request" },
    expectedIntent: "other",
    expectedDecision: "HUMAN_ONLY",
    requiredTools: ["ESCALATE_HUMAN"],
  },
];

export function runSupportReplayCase(testCase: SupportReplayCase): SupportReplayResult {
  const result = runSupportAgentSimulation(testCase.input);
  const errors: string[] = [];
  if (result.intent !== testCase.expectedIntent) errors.push(`intent ${result.intent} != ${testCase.expectedIntent}`);
  if (result.decision !== testCase.expectedDecision) errors.push(`decision ${result.decision} != ${testCase.expectedDecision}`);
  if (result.sendAllowed !== false) errors.push("sendAllowed must remain false");
  if (result.shopifyMutationAllowed !== false) errors.push("shopifyMutationAllowed must remain false");

  for (const tool of testCase.requiredTools || []) {
    if (!result.toolPlan.some((item) => item.tool === tool)) errors.push(`missing tool ${tool}`);
  }
  for (const pattern of testCase.forbiddenDraftPatterns || []) {
    if (pattern.test(result.draft || "")) errors.push(`draft matched forbidden pattern ${pattern}`);
  }
  return { id: testCase.id, passed: errors.length === 0, errors };
}

export function runDefaultSupportReplaySuite() {
  const results = defaultSupportReplayCases.map(runSupportReplayCase);
  const failed = results.filter((result) => !result.passed);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
}
