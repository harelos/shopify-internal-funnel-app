import assert from "node:assert/strict";
import { test } from "node:test";
import { consentAllowsMarketing, emailSpec, FLOW_SPECS, orderEmailAllowedForConsent, resendTemplateAlias } from "../src/flow-specs";
import { buildAutomationBlueprints, EVENT_DEFINITIONS, toResendWorkflow } from "../scripts/lib/automation-blueprints.mjs";
import { localSuppression } from "../src/dispatch";
import { testDatabase, testEnv } from "./helpers/d1";

const automations = buildAutomationBlueprints(Object.values(FLOW_SPECS));

function durationMinutes(value: string): number {
  const [amountText, unit] = value.split(" ");
  const amount = Number(amountText);
  if (unit?.startsWith("week")) return amount * 7 * 24 * 60;
  if (unit?.startsWith("day")) return amount * 24 * 60;
  if (unit?.startsWith("hour")) return amount * 60;
  return amount;
}

test("six automations contain all 44 sends and start disabled", () => {
  assert.equal(automations.length, 6);
  assert.ok(automations.every((automation: { status: string }) => automation.status === "disabled"));
  const sends = automations.flatMap((automation: { steps: Array<{ type: string }> }) => automation.steps.filter(step => step.type === "send_email"));
  assert.equal(sends.length, 44);
});

test("a paid order unlocks its service emails without a marketing opt-in", () => {
  // E01-E07 service the order she already paid for.
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const spec = emailSpec("post_purchase", n);
    assert.equal(spec.kind, "transactional", `E${n} should be transactional`);
    for (const consent of ["SUBSCRIBED", "NOT_SUBSCRIBED", "UNSUBSCRIBED", "UNKNOWN", "PENDING"]) {
      assert.equal(orderEmailAllowedForConsent(spec, consent), true, `E${n} blocked for ${consent}`);
    }
  }
  // E08-E12 sell something new, so an explicit opt-out still stops them.
  for (const n of [8, 9, 10, 11, 12]) {
    const spec = emailSpec("post_purchase", n);
    assert.notEqual(spec.kind, "transactional", `E${n} should not be transactional`);
    assert.equal(orderEmailAllowedForConsent(spec, "SUBSCRIBED"), true);
    assert.equal(orderEmailAllowedForConsent(spec, "NOT_SUBSCRIBED"), true, `E${n} should reach never-asked buyers`);
    assert.equal(orderEmailAllowedForConsent(spec, "UNSUBSCRIBED"), false, `E${n} must respect an opt-out`);
    assert.equal(orderEmailAllowedForConsent(spec, "REDACTED"), false, `E${n} must respect redaction`);
  }
});

test("a marketing opt-out does not cancel service mail for an order already paid for", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  const emailHash = "hash-marketing-optout";
  try {
    await db.prepare(
      `INSERT INTO suppressions (email_hash, source, reason, occurred_at, active, created_at, updated_at)
       VALUES (?, 'SHOPIFY_CONSENT', 'marketing_unsubscribed', ?, 1, ?, ?)`,
    ).bind(emailHash, "2026-09-11T12:30:21.000Z", "2026-09-11T12:30:21.000Z", "2026-09-11T12:30:21.000Z").run();

    // Transactional scope tolerates a marketing-only suppression.
    assert.equal(await localSuppression(env, emailHash, "all"), false);
    // Marketing scope still respects it.
    assert.equal(await localSuppression(env, emailHash, "marketing"), true);

    // A hard bounce blocks both.
    await db.prepare("UPDATE suppressions SET reason = 'bounced' WHERE email_hash = ?").bind(emailHash).run();
    assert.equal(await localSuppression(env, emailHash, "all"), true);
    assert.equal(await localSuppression(env, emailHash, "marketing"), true);
  } finally {
    await dispose();
  }
});

test("an explicit opt-out is the only consent state that blocks marketing", () => {
  assert.equal(consentAllowsMarketing("SUBSCRIBED"), true);
  assert.equal(consentAllowsMarketing("NOT_SUBSCRIBED"), true);
  assert.equal(consentAllowsMarketing("PENDING"), true);
  assert.equal(consentAllowsMarketing("UNKNOWN"), true);
  assert.equal(consentAllowsMarketing(null), true);
  assert.equal(consentAllowsMarketing("UNSUBSCRIBED"), false);
  assert.equal(consentAllowsMarketing("REDACTED"), false);
});

test("event-driven post-purchase aliases use isolated V2 drafts", () => {
  assert.equal(resendTemplateAlias("post_purchase", 3), "novahair-post-purchase-e03-v2");
  assert.equal(resendTemplateAlias("post_purchase", 4), "novahair-post-purchase-e04-v2");
  assert.equal(resendTemplateAlias("post_purchase", 5), "novahair-post-purchase-e05-v2");
  assert.equal(resendTemplateAlias("post_purchase", 6), "novahair-post-purchase-e06-v2");
  assert.equal(resendTemplateAlias("post_purchase", 7), "novahair-post-purchase-e07-v2");
  assert.equal(resendTemplateAlias("post_purchase", 8), "novahair_post_purchase_e08");
});

test("every native delay/wait remains within Resend's 30-day ceiling", () => {
  const timed = automations.flatMap((automation: { steps: Array<{ type: string; config?: { duration?: string; timeout?: string } }> }) =>
    automation.steps.filter(step => step.type === "delay" || step.type === "wait_for_event"),
  );
  for (const step of timed) {
    const value = step.config?.duration ?? step.config?.timeout;
    assert.ok(value);
    assert.ok(durationMinutes(value) <= 30 * 24 * 60, value);
  }
});

test("checkout automation routes D1-released email numbers without email-only recovery waits", () => {
  const checkout = automations.find((automation: { name: string }) => automation.name.includes("Abandoned Checkout"));
  assert.ok(checkout);
  assert.equal(checkout.steps[0].config.event_name, "shopify.checkout_abandoned");
  assert.equal(checkout.steps.filter((step: { type: string }) => step.type === "wait_for_event").length, 0);
  const conditions = checkout.steps.filter((step: { type: string }) => step.type === "condition");
  assert.equal(conditions.length, 10);
  assert.ok(conditions.every((step: { config: { field: string } }) => step.config.field === "event.email_number"));
});

test("post-purchase automation routes D1-released emails and contains no guessed delivery delays", () => {
  const flow = automations.find((automation: { name: string }) => automation.name === "NovaHair — Post-Purchase");
  assert.ok(flow);
  assert.equal(flow.steps.filter((step: { type: string }) => step.type === "delay").length, 0);
  const conditions = flow.steps.filter((step: { type: string }) => step.type === "condition");
  assert.equal(conditions.length, 12);
  assert.ok(conditions.every((step: { config: { field: string } }) => step.config.field === "event.email_number"));
  const trackingSend = flow.steps.find((step: { key: string }) => step.key === "send_e03");
  assert.equal(trackingSend.config.template.id, "novahair-post-purchase-e03-v2");
  assert.deepEqual(trackingSend.config.template.variables.TRACKING_URL, { var: "event.cta_url" });
  assert.deepEqual(trackingSend.config.template.variables.TRACKING_NUMBER, { var: "event.tracking_number" });
});

test("purchase and stage-advance stop events guard earlier native flows", () => {
  const waitsByAutomation = Object.fromEntries(automations.map((automation: { name: string; steps: Array<{ type: string; config: { event_name?: string } }> }) => [
    automation.name,
    automation.steps.filter(step => step.type === "wait_for_event").map(step => step.config.event_name),
  ]));
  assert.deepEqual(new Set(waitsByAutomation["NovaHair — Welcome"]), new Set(["shopify.purchase_completed"]));
  assert.deepEqual(new Set(waitsByAutomation["NovaHair — Abandoned Cart"]), new Set(["lifecycle.cart_stop"]));
  assert.deepEqual(new Set(waitsByAutomation["NovaHair — Browse Abandonment"]), new Set(["lifecycle.browse_stop"]));
  assert.deepEqual(new Set(waitsByAutomation["NovaHair — Replenishment / Winback"]), new Set(["lifecycle.replenishment_stop"]));
});

test("normalized event catalog contains all required events", () => {
  const names = new Set(EVENT_DEFINITIONS.map(event => event.name));
  for (const name of [
    "shopify.checkout_abandoned",
    "shopify.checkout_recovered",
    "shopify.purchase_completed",
    "shopify.marketing_subscribed",
    "shopify.post_purchase_started",
    "shopify.replenishment_due",
    "storefront.cart_abandoned",
    "storefront.product_browsed",
  ]) assert.ok(names.has(name), name);
});

test("provisioning converts blueprints to the current Resend workflow shape", () => {
  const aliases = automations.flatMap((automation: { steps: Array<{ type: string; config: { template?: { id: string } } }> }) =>
    automation.steps.filter(step => step.type === "send_email").map(step => step.config.template?.id).filter(Boolean),
  ) as string[];
  const subjects = new Map(aliases.map(alias => [alias, `Subject for ${alias}`]));
  for (const automation of automations) {
    const workflow = toResendWorkflow(automation, "NovaHair <hello@email.tigerbrandsglobal.com>", "support@tigerbrandsglobal.com", subjects);
    const trigger = workflow.steps.find((step: { type: string }) => step.type === "trigger");
    assert.ok(trigger?.config.eventName);
    assert.ok("next" in trigger);
    for (const step of workflow.steps) {
      assert.ok(!("event_name" in step.config));
      if (step.type === "send_email") {
        assert.ok(step.config.subject);
        assert.equal(step.config.replyTo, "support@tigerbrandsglobal.com");
      }
      if (step.type === "condition" || step.type === "wait_for_event") assert.ok(step.branches);
    }
  }
});
