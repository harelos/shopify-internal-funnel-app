const COMMON_SCHEMA = {
  event_key: "string",
  consent_state: "string",
  occurred_at: "date",
  flow: "string",
  is_test: "boolean",
};

const MERCHANDISE_SCHEMA = {
  product_name: "string",
  product_image: "string",
  variant: "string",
  shade: "string",
  bundle: "string",
  quantity: "number",
  total: "number",
  currency: "string",
};

function ctaSchema(count, single = false) {
  if (single) return { cta_url: "string" };
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`cta_url_e${String(index + 1).padStart(2, "0")}`, "string"]),
  );
}

export const EVENT_DEFINITIONS = [
  {
    name: "shopify.checkout_abandoned",
    schema: { ...COMMON_SCHEMA, checkout_id: "string", customer_id: "string", first_name: "string", email_number: "number", ...MERCHANDISE_SCHEMA, ...ctaSchema(1, true) },
  },
  { name: "shopify.checkout_recovered", schema: { ...COMMON_SCHEMA, checkout_id: "string", customer_id: "string" } },
  { name: "shopify.purchase_completed", schema: { ...COMMON_SCHEMA, checkout_id: "string", order_id: "string", customer_id: "string", first_name: "string", ...MERCHANDISE_SCHEMA } },
  { name: "shopify.marketing_subscribed", schema: { ...COMMON_SCHEMA, customer_id: "string", first_name: "string", ...ctaSchema(10) } },
  { name: "shopify.post_purchase_started", schema: { ...COMMON_SCHEMA, checkout_id: "string", order_id: "string", customer_id: "string", first_name: "string", ...MERCHANDISE_SCHEMA, ...ctaSchema(7) } },
  { name: "shopify.replenishment_due", schema: { ...COMMON_SCHEMA, order_id: "string", customer_id: "string", first_name: "string", ...MERCHANDISE_SCHEMA, ...ctaSchema(4) } },
  { name: "storefront.cart_abandoned", schema: { ...COMMON_SCHEMA, customer_id: "string", first_name: "string", ...MERCHANDISE_SCHEMA, ...ctaSchema(5) } },
  { name: "storefront.product_browsed", schema: { ...COMMON_SCHEMA, customer_id: "string", first_name: "string", ...MERCHANDISE_SCHEMA, ...ctaSchema(3) } },
  { name: "lifecycle.browse_stop", schema: { ...COMMON_SCHEMA, checkout_id: "string", order_id: "string", customer_id: "string" } },
  { name: "lifecycle.cart_stop", schema: { ...COMMON_SCHEMA, checkout_id: "string", order_id: "string", customer_id: "string" } },
  { name: "lifecycle.replenishment_stop", schema: { ...COMMON_SCHEMA, order_id: "string", customer_id: "string" } },
];

function duration(minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error(`invalid_duration_minutes:${minutes}`);
  if (minutes % 10080 === 0) return `${minutes / 10080} ${minutes === 10080 ? "week" : "weeks"}`;
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? "day" : "days"}`;
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function templateConfig(flow, number, checkoutRouting = false) {
  const suffix = String(number).padStart(2, "0");
  return {
    template: {
      id: `novahair_${flow}_e${suffix}`,
      variables: {
        CUSTOMER_NAME: { var: "event.first_name" },
        CTA_URL: { var: checkoutRouting ? "event.cta_url" : `event.cta_url_e${suffix}` },
        PRODUCT_NAME: { var: "event.product_name" },
        VARIANT: { var: "event.variant" },
        BUNDLE: { var: "event.bundle" },
      },
    },
    from: "__RESEND_FROM__",
    reply_to: "__RESEND_REPLY_TO__",
  };
}

function checkoutAutomation(flowSpec) {
  const steps = [{ key: "start", type: "trigger", config: { event_name: flowSpec.triggerEvent } }];
  const connections = [{ from: "start", to: "route_e01", type: "default" }];
  for (let number = 1; number <= 10; number += 1) {
    const route = `route_e${String(number).padStart(2, "0")}`;
    const send = `send_e${String(number).padStart(2, "0")}`;
    const next = `route_e${String(number + 1).padStart(2, "0")}`;
    steps.push({
      key: route,
      type: "condition",
      config: { type: "rule", field: "event.email_number", operator: "eq", value: number },
    });
    steps.push({ key: send, type: "send_email", config: templateConfig("abandoned_checkout", number, true) });
    connections.push({ from: route, to: send, type: "condition_met" });
    if (number < 10) connections.push({ from: route, to: next, type: "condition_not_met" });
  }
  return {
    name: "NovaHair — Abandoned Checkout — D1 Correlated",
    status: "disabled",
    strategy: "Each email is released by D1 only while its exact Shopify checkout ID remains abandoned.",
    steps,
    connections,
  };
}

function stoppedSequence(flowSpec, stopEvent) {
  const steps = [{ key: "start", type: "trigger", config: { event_name: flowSpec.triggerEvent } }];
  const connections = [];
  let previous = "start";
  let previousOffset = 0;
  for (const email of flowSpec.emails) {
    const delta = email.offsetMinutes - previousOffset;
    const suffix = String(email.number).padStart(2, "0");
    const sendKey = `send_e${suffix}`;
    if (delta > 0) {
      const waitKey = `wait_stop_before_e${suffix}`;
      steps.push({
        key: waitKey,
        type: "wait_for_event",
        config: { event_name: stopEvent, timeout: duration(delta) },
      });
      connections.push({ from: previous, to: waitKey, type: "default" });
      connections.push({ from: waitKey, to: sendKey, type: "timeout" });
      // An event_received branch intentionally has no next node: the run ends.
    } else {
      connections.push({ from: previous, to: sendKey, type: "default" });
    }
    steps.push({ key: sendKey, type: "send_email", config: templateConfig(flowSpec.flow, email.number) });
    previous = sendKey;
    previousOffset = email.offsetMinutes;
  }
  return { steps, connections };
}

function delayedSequence(flowSpec) {
  const steps = [{ key: "start", type: "trigger", config: { event_name: flowSpec.triggerEvent } }];
  const connections = [];
  let previous = "start";
  let previousOffset = 0;
  for (const email of flowSpec.emails) {
    const delta = email.offsetMinutes - previousOffset;
    const suffix = String(email.number).padStart(2, "0");
    const sendKey = `send_e${suffix}`;
    if (delta > 0) {
      const delayKey = `delay_before_e${suffix}`;
      steps.push({ key: delayKey, type: "delay", config: { duration: duration(delta) } });
      connections.push({ from: previous, to: delayKey, type: "default" });
      connections.push({ from: delayKey, to: sendKey, type: "default" });
    } else {
      connections.push({ from: previous, to: sendKey, type: "default" });
    }
    steps.push({ key: sendKey, type: "send_email", config: templateConfig(flowSpec.flow, email.number) });
    previous = sendKey;
    previousOffset = email.offsetMinutes;
  }
  return { steps, connections };
}

const AUTOMATION_NAMES = {
  welcome: "NovaHair — Welcome",
  abandoned_cart: "NovaHair — Abandoned Cart",
  browse_abandonment: "NovaHair — Browse Abandonment",
  post_purchase: "NovaHair — Post-Purchase",
  replenishment: "NovaHair — Replenishment / Winback",
};

export function buildAutomationBlueprints(flowSpecs) {
  const byFlow = Object.fromEntries(flowSpecs.map(spec => [spec.flow, spec]));
  const checkout = checkoutAutomation(byFlow.abandoned_checkout);
  const configurations = [
    ["welcome", "shopify.purchase_completed"],
    ["abandoned_cart", "lifecycle.cart_stop"],
    ["browse_abandonment", "lifecycle.browse_stop"],
    ["replenishment", "lifecycle.replenishment_stop"],
  ];
  const automations = [checkout];
  for (const [flow, stopEvent] of configurations) {
    const sequence = stoppedSequence(byFlow[flow], stopEvent);
    automations.push({
      name: AUTOMATION_NAMES[flow],
      status: "disabled",
      stop_event: stopEvent,
      ...sequence,
    });
  }
  automations.push({
    name: AUTOMATION_NAMES.post_purchase,
    status: "disabled",
    source_of_truth: "Verified Shopify paid order webhook",
    ...delayedSequence(byFlow.post_purchase),
  });
  return automations;
}

export function hydrateAutomation(automation, from, replyTo) {
  return JSON.parse(
    JSON.stringify(automation)
      .replaceAll("__RESEND_FROM__", from)
      .replaceAll("__RESEND_REPLY_TO__", replyTo),
  );
}

export function toResendWorkflow(automation, from, replyTo, subjectsByTemplate) {
  const hydrated = hydrateAutomation(automation, from, replyTo);
  const outgoing = new Map();
  for (const edge of hydrated.connections ?? []) {
    const edges = outgoing.get(edge.from) ?? [];
    edges.push(edge);
    outgoing.set(edge.from, edges);
  }

  const subjectFor = alias => subjectsByTemplate instanceof Map
    ? subjectsByTemplate.get(alias)
    : subjectsByTemplate?.[alias];

  return {
    steps: hydrated.steps.map(step => {
      const edges = outgoing.get(step.key) ?? [];
      let config = step.config;
      if (step.type === "trigger") {
        config = { eventName: step.config.event_name };
      } else if (step.type === "wait_for_event") {
        config = {
          eventName: step.config.event_name,
          timeout: step.config.timeout,
          ...(step.config.filter_rule ? { filterRule: step.config.filter_rule } : {}),
        };
      } else if (step.type === "send_email") {
        const templateId = step.config.template.id;
        const subject = subjectFor(templateId);
        if (!subject) throw new Error(`automation_subject_missing:${templateId}`);
        config = {
          template: step.config.template,
          from: step.config.from,
          subject,
          replyTo: step.config.reply_to,
        };
      }

      if (step.type === "condition") {
        return {
          key: step.key,
          type: step.type,
          config,
          branches: {
            condition_met: edges.find(edge => edge.type === "condition_met")?.to ?? null,
            condition_not_met: edges.find(edge => edge.type === "condition_not_met")?.to ?? null,
          },
        };
      }
      if (step.type === "wait_for_event") {
        return {
          key: step.key,
          type: step.type,
          config,
          branches: {
            event_received: edges.find(edge => edge.type === "event_received")?.to ?? null,
            timeout: edges.find(edge => edge.type === "timeout")?.to ?? null,
          },
        };
      }
      return {
        key: step.key,
        type: step.type,
        config,
        next: edges.find(edge => edge.type === "default")?.to ?? null,
      };
    }),
  };
}

export { duration };
