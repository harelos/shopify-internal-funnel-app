import test from "node:test";
import assert from "node:assert/strict";
import { executeBotTool, BotToolExecutionError } from "../src/lib/bot-tool-executor.js";
import type { BotAgentRole, DiscountDecision } from "../src/lib/bot-sales-brain.js";

const noOffer: DiscountDecision = { action: "NO_OFFER", reason: "NO_QUALIFIED_PRICE_HESITATION" };
const offer5: DiscountDecision = { action: "OFFER_DISCOUNT", pct: 5, reason: "FIRST_STAGE_SAVE", projectedMarginAfterDiscountIls: 80 };

function context(role: BotAgentRole, discount: DiscountDecision = noOffer) {
  return { role, conversationId: "conv-1", discount };
}

test("server boundary denies cross-role tool access before a handler can run", async () => {
  let called = false;
  await assert.rejects(
    executeBotTool("order.read_scoped", { orderName: "#1001", email: "x@example.com" }, context("SALES"), {
      orderTool: { async readVerifiedOrder() { called = true; throw new Error("should not run"); } },
    }),
    (error: unknown) => error instanceof BotToolExecutionError && error.code === "TOOL_NOT_ALLOWED",
  );
  assert.equal(called, false);
});

test("security role cannot execute commerce tools", async () => {
  await assert.rejects(
    executeBotTool("offer.request", {}, context("SECURITY", offer5)),
    (error: unknown) => error instanceof BotToolExecutionError && error.code === "TOOL_NOT_ALLOWED",
  );
});

test("offer tool fails closed without deterministic authorization", async () => {
  await assert.rejects(
    executeBotTool("offer.request", {}, context("SALES", noOffer)),
    (error: unknown) => error instanceof BotToolExecutionError && error.code === "OFFER_NOT_AUTHORIZED",
  );
});

test("authorized offer returns percentage but never invents or allocates a coupon", async () => {
  const result = await executeBotTool("offer.request", {}, context("SALES", offer5)) as any;
  assert.equal(result.authorized, true);
  assert.equal(result.pct, 5);
  assert.equal(result.couponAllocated, false);
  assert.equal(result.couponCode, null);
});

test("public QA mode blocks non-read-only tools even when the role normally allows them", async () => {
  const previous = process.env.BOT_PUBLIC_QA_MODE;
  process.env.BOT_PUBLIC_QA_MODE = "true";
  try {
    await assert.rejects(
      executeBotTool("offer.request", {}, context("SALES", offer5)),
      (error: unknown) => error instanceof BotToolExecutionError && error.code === "PUBLIC_QA_WRITE_BLOCKED",
    );
  } finally {
    if (previous === undefined) delete process.env.BOT_PUBLIC_QA_MODE;
    else process.env.BOT_PUBLIC_QA_MODE = previous;
  }
});

test("public QA mode permits authoritative product reads", async () => {
  const previous = process.env.BOT_PUBLIC_QA_MODE;
  process.env.BOT_PUBLIC_QA_MODE = "true";
  try {
    let received: any = null;
    const result = await executeBotTool(
      "product.read",
      { query: "NovaHair" },
      context("SALES"),
      { productTool: { async readProduct(input) { received = input; return [{ id: "gid://shopify/Product/1", title: "NovaHair", handle: "novahair", description: "", status: "ACTIVE", onlineStoreUrl: null, productType: null, vendor: null, options: [], variants: [] }]; } } },
    ) as any;
    assert.equal(received.query, "NovaHair");
    assert.equal(result.source, "SHOPIFY_ADMIN_READ_ONLY");
    assert.equal(result.count, 1);
    assert.equal(result.products[0].title, "NovaHair");
  } finally {
    if (previous === undefined) delete process.env.BOT_PUBLIC_QA_MODE;
    else process.env.BOT_PUBLIC_QA_MODE = previous;
  }
});

test("public QA mode still permits verified read-only order access", async () => {
  const previous = process.env.BOT_PUBLIC_QA_MODE;
  process.env.BOT_PUBLIC_QA_MODE = "true";
  try {
    const result = await executeBotTool(
      "order.read_scoped",
      { orderName: "#1001", email: "buyer@example.com" },
      context("SUPPORT"),
      { orderTool: { async readVerifiedOrder() { return { id: "gid://shopify/Order/1", name: "#1001", displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", createdAt: "2026-08-23T00:00:00Z", fulfillments: [] }; } } },
    ) as any;
    assert.equal(result.name, "#1001");
  } finally {
    if (previous === undefined) delete process.env.BOT_PUBLIC_QA_MODE;
    else process.env.BOT_PUBLIC_QA_MODE = previous;
  }
});

test("support order access requires contact verification material", async () => {
  await assert.rejects(executeBotTool("order.read_scoped", { orderName: "#1001" }, context("SUPPORT")), (error: unknown) => error instanceof BotToolExecutionError && error.code === "ORDER_VERIFICATION_REQUIRED");
});

test("support scoped order tool passes contact to verifier and returns only verifier result", async () => {
  let received: any = null;
  const expected = { id: "gid://shopify/Order/1", name: "#1001", displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", createdAt: "2026-08-23T00:00:00Z", fulfillments: [{ status: "SUCCESS", deliveredAt: null, trackingInfo: [{ company: "Carrier", number: "ABC", url: "https://tracking.example/ABC" }] }] };
  const result = await executeBotTool("order.read_scoped", { orderName: "#1001", email: "buyer@example.com" }, context("SUPPORT"), { orderTool: { async readVerifiedOrder(input) { received = input; return expected; } } });
  assert.equal(received.email, "buyer@example.com");
  assert.deepEqual(result, expected);
});

test("tracking tool strips financial status from returned shape", async () => {
  const result = await executeBotTool("tracking.read_scoped", { orderName: "#1001", phone: "+972501234567" }, context("SUPPORT"), { orderTool: { async readVerifiedOrder() { return { id: "gid://shopify/Order/1", name: "#1001", displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", createdAt: "2026-08-23T00:00:00Z", fulfillments: [{ status: "SUCCESS", deliveredAt: null, trackingInfo: [] }] }; } } }) as any;
  assert.equal(result.displayFulfillmentStatus, "FULFILLED");
  assert.equal("displayFinancialStatus" in result, false);
  assert.equal("createdAt" in result, false);
});

test("unimplemented policy tool fails explicitly instead of fabricating results", async () => {
  await assert.rejects(executeBotTool("policy.read", {}, context("SALES")), (error: unknown) => error instanceof BotToolExecutionError && error.code === "TOOL_NOT_IMPLEMENTED");
});
