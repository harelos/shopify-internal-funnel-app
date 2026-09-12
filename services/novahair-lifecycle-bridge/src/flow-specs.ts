import type { LifecycleFlow } from "./types";

export interface EmailScheduleSpec {
  number: number;
  offsetMinutes: number;
  content: string;
  // An anchor is a real-world state, never a label for a timer. In particular,
  // shipment messages must not be sent merely because an order is N days old.
  anchor?: "trigger" | "purchase" | "tracking" | "delay" | "delivered";
}

export interface FlowScheduleSpec {
  flow: LifecycleFlow;
  triggerEvent: string;
  triggerDelayMinutes?: number;
  emails: EmailScheduleSpec[];
}

const day = 24 * 60;

export const FLOW_SPECS: Record<LifecycleFlow, FlowScheduleSpec> = {
  abandoned_checkout: {
    flow: "abandoned_checkout",
    triggerEvent: "shopify.checkout_abandoned",
    emails: [
      { number: 1, offsetMinutes: 60, content: "e01_checkout_reminder" },
      { number: 2, offsetMinutes: 6 * 60, content: "e02_shade_confidence" },
      { number: 3, offsetMinutes: day, content: "e03_white_hair_proof" },
      { number: 4, offsetMinutes: 2 * day, content: "e04_how_it_works" },
      { number: 5, offsetMinutes: 3 * day, content: "e05_salon_cost" },
      { number: 6, offsetMinutes: 4 * day, content: "e06_objections" },
      { number: 7, offsetMinutes: 5 * day, content: "e07_social_proof" },
      { number: 8, offsetMinutes: 7 * day, content: "e08_trust" },
      { number: 9, offsetMinutes: 10 * day, content: "e09_human_support" },
      { number: 10, offsetMinutes: 14 * day, content: "e10_final_reminder" },
    ],
  },
  welcome: {
    flow: "welcome",
    triggerEvent: "shopify.marketing_subscribed",
    emails: [
      { number: 1, offsetMinutes: 0, content: "e01_welcome" },
      { number: 2, offsetMinutes: day, content: "e02_problem" },
      { number: 3, offsetMinutes: 2 * day, content: "e03_usage" },
      { number: 4, offsetMinutes: 3 * day, content: "e04_proof" },
      { number: 5, offsetMinutes: 5 * day, content: "e05_shade_guide" },
      { number: 6, offsetMinutes: 7 * day, content: "e06_salon_cost" },
      { number: 7, offsetMinutes: 9 * day, content: "e07_white_hair" },
      { number: 8, offsetMinutes: 12 * day, content: "e08_mistakes" },
      { number: 9, offsetMinutes: 16 * day, content: "e09_customer_story" },
      { number: 10, offsetMinutes: 21 * day, content: "e10_final_welcome" },
    ],
  },
  abandoned_cart: {
    flow: "abandoned_cart",
    triggerEvent: "storefront.cart_abandoned",
    triggerDelayMinutes: 2 * 60,
    emails: [
      { number: 1, offsetMinutes: 0, content: "e01_cart_reminder" },
      { number: 2, offsetMinutes: 10 * 60, content: "e02_shade_confidence" },
      { number: 3, offsetMinutes: 46 * 60, content: "e03_proof" },
      { number: 4, offsetMinutes: 94 * 60, content: "e04_faq" },
      { number: 5, offsetMinutes: 166 * 60, content: "e05_final_cart" },
    ],
  },
  browse_abandonment: {
    flow: "browse_abandonment",
    triggerEvent: "storefront.product_browsed",
    triggerDelayMinutes: 4 * 60,
    emails: [
      { number: 1, offsetMinutes: 0, content: "e01_shade_curiosity" },
      { number: 2, offsetMinutes: day, content: "e02_product_fit" },
      { number: 3, offsetMinutes: 68 * 60, content: "e03_proof_next_step" },
    ],
  },
  post_purchase: {
    flow: "post_purchase",
    triggerEvent: "shopify.post_purchase_started",
    emails: [
      { number: 1, offsetMinutes: 4 * 60, content: "e01_order_next_steps", anchor: "purchase" },
      { number: 2, offsetMinutes: 2 * day, content: "e02_first_use_prep", anchor: "purchase" },
      { number: 3, offsetMinutes: 0, content: "e03_shipping_checkin", anchor: "tracking" },
      { number: 4, offsetMinutes: 0, content: "e04_shipping_support", anchor: "delay" },
      { number: 5, offsetMinutes: day, content: "e05_first_use_walkthrough", anchor: "delivered" },
      { number: 6, offsetMinutes: 4 * day, content: "e06_troubleshooting", anchor: "delivered" },
      { number: 7, offsetMinutes: 10 * day, content: "e07_hair_care", anchor: "delivered" },
      { number: 8, offsetMinutes: 14 * day, content: "e08_review", anchor: "delivered" },
      { number: 9, offsetMinutes: 21 * day, content: "e09_soft_cross_sell", anchor: "delivered" },
    ],
  },
  replenishment: {
    flow: "replenishment",
    triggerEvent: "shopify.replenishment_due",
    emails: [
      { number: 1, offsetMinutes: 0, content: "e01_root_return" },
      { number: 2, offsetMinutes: 7 * day, content: "e02_easy_reorder" },
      { number: 3, offsetMinutes: 17 * day, content: "e03_bundle_logic" },
      { number: 4, offsetMinutes: 38 * day, content: "e04_winback" },
    ],
  },
};

export function emailSpec(flow: LifecycleFlow, emailNumber: number): EmailScheduleSpec {
  const spec = FLOW_SPECS[flow].emails.find(email => email.number === emailNumber);
  if (!spec) throw new Error(`unknown_lifecycle_email:${flow}:${emailNumber}`);
  return spec;
}

// Resend retains historic aliases permanently. E05-E07 were duplicated from the
// previously published, delivery-anchored templates so their earlier reporting
// remains intact; these explicit production aliases keep the catalog and
// webhook attribution pointing at the current delivery-aware templates.
export function resendTemplateAlias(flow: LifecycleFlow, emailNumber: number): string {
  if (flow === "post_purchase" && emailNumber >= 3 && emailNumber <= 4) {
    return `novahair-post-purchase-e${String(emailNumber).padStart(2, "0")}-v2`;
  }
  if (flow === "post_purchase" && emailNumber >= 5 && emailNumber <= 7) {
    return `novahair-post-purchase-e${String(emailNumber).padStart(2, "0")}-v2`;
  }
  return `novahair_${flow}_e${String(emailNumber).padStart(2, "0")}`;
}

export function dueAt(start: string | Date, offsetMinutes: number): string {
  const timestamp = typeof start === "string" ? new Date(start).getTime() : start.getTime();
  if (!Number.isFinite(timestamp)) throw new Error("invalid_schedule_start");
  return new Date(timestamp + offsetMinutes * 60_000).toISOString();
}

export function replenishmentOffsetDays(bundle: string | null | undefined, quantity: number): number {
  const normalized = (bundle ?? "").toLowerCase();
  const units = Math.max(1, quantity);
  if (/6|six/.test(normalized) || units >= 6) return 150;
  if (/4|four/.test(normalized) || units >= 4) return 105;
  if (/2|two/.test(normalized) || units >= 2) return 60;
  return 35;
}
