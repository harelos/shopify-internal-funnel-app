import assert from "node:assert/strict";
import { test } from "node:test";
import { FLOW_SPECS } from "../src/flow-specs";
import { buildAutomationBlueprints, EVENT_DEFINITIONS, toResendWorkflow } from "../scripts/lib/automation-blueprints.mjs";

const automations = buildAutomationBlueprints(Object.values(FLOW_SPECS));

function durationMinutes(value: string): number {
  const [amountText, unit] = value.split(" ");
  const amount = Number(amountText);
  if (unit?.startsWith("week")) return amount * 7 * 24 * 60;
  if (unit?.startsWith("day")) return amount * 24 * 60;
  if (unit?.startsWith("hour")) return amount * 60;
  return amount;
}

test("six automations contain all 39 sends and start disabled", () => {
  assert.equal(automations.length, 6);
  assert.ok(automations.every((automation: { status: string }) => automation.status === "disabled"));
  const sends = automations.flatMap((automation: { steps: Array<{ type: string }> }) => automation.steps.filter(step => step.type === "send_email"));
  assert.equal(sends.length, 39);
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
