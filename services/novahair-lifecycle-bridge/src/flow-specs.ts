import type { LifecycleFlow } from "./types";

export interface EmailScheduleSpec {
  number: number;
  offsetMinutes: number;
  content: string;
}

export interface FlowScheduleSpec {
  flow: LifecycleFlow;
  triggerEvent: string;
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
    emails: [
      { number: 1, offsetMinutes: 2 * 60, content: "e01_cart_reminder" },
      { number: 2, offsetMinutes: 12 * 60, content: "e02_shade_confidence" },
      { number: 3, offsetMinutes: 2 * day, content: "e03_proof" },
      { number: 4, offsetMinutes: 4 * day, content: "e04_faq" },
      { number: 5, offsetMinutes: 7 * day, content: "e05_final_cart" },
    ],
  },
  browse_abandonment: {
    flow: "browse_abandonment",
    triggerEvent: "storefront.product_browsed",
    emails: [
      { number: 1, offsetMinutes: 4 * 60, content: "e01_shade_curiosity" },
      { number: 2, offsetMinutes: 28 * 60, content: "e02_product_fit" },
      { number: 3, offsetMinutes: 3 * day, content: "e03_proof_next_step" },
    ],
  },
  post_purchase: {
    flow: "post_purchase",
    triggerEvent: "shopify.post_purchase_started",
    emails: [
      { number: 1, offsetMinutes: 4 * 60, content: "e01_order_next_steps" },
      { number: 2, offsetMinutes: 3 * day, content: "e02_first_use_prep" },
      { number: 3, offsetMinutes: 10 * day, content: "e03_first_use_walkthrough" },
      { number: 4, offsetMinutes: 12 * day, content: "e04_troubleshooting" },
      { number: 5, offsetMinutes: 21 * day, content: "e05_hair_care" },
      { number: 6, offsetMinutes: 28 * day, content: "e06_review" },
      { number: 7, offsetMinutes: 40 * day, content: "e07_soft_cross_sell" },
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
