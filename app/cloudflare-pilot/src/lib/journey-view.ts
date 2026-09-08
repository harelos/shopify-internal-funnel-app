export interface JourneyEventInput {
  name: string;
  occurredAt: Date | string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  deviceClass?: string | null;
  payload?: string | null;
}

export interface JourneyTimelineEntry {
  at: string;
  category: "visit" | "engagement" | "intent" | "checkout" | "purchase" | "experience" | "experiment";
  label: string;
  detail: string | null;
  page: string | null;
}

const EVENT_LABELS: Record<string, { category: JourneyTimelineEntry["category"]; label: string }> = {
  page_view: { category: "visit", label: "Viewed a page" },
  FUNNEL_PAGE_VIEWED: { category: "visit", label: "Viewed a funnel page" },
  view_item: { category: "engagement", label: "Viewed the NovaHair offer" },
  gallery_image_viewed: { category: "engagement", label: "Viewed a gallery image" },
  gallery_image_clicked: { category: "engagement", label: "Opened a gallery image" },
  section_viewed: { category: "engagement", label: "Reached a page section" },
  faq_item_opened: { category: "engagement", label: "Opened a frequently asked question" },
  testimonial_clicked: { category: "engagement", label: "Opened a customer story" },
  cta_click: { category: "intent", label: "Clicked a call to action" },
  FUNNEL_CTA_CLICKED: { category: "intent", label: "Clicked a funnel call to action" },
  add_to_cart_succeeded: { category: "intent", label: "Added the offer to cart" },
  cart_drawer_opened: { category: "intent", label: "Opened the cart" },
  view_cart: { category: "intent", label: "Viewed the cart" },
  checkout_clicked: { category: "checkout", label: "Continued to checkout" },
  begin_checkout: { category: "checkout", label: "Started checkout" },
  popup_view: { category: "experience", label: "Opened an on-site assistant" },
  popup_email_started: { category: "experience", label: "Started the assistant email step" },
  popup_submit_success: { category: "experience", label: "Saved an assistant recommendation" },
  popup_continue_clicked: { category: "experience", label: "Continued from the assistant" },
  popup_coupon_revealed: { category: "experience", label: "Revealed an assistant offer" },
  popup_closed: { category: "experience", label: "Closed the on-site assistant" },
  element_exposure: { category: "experiment", label: "Saw an experiment variant" },
};

function parsePayload(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function text(value: unknown, max = 100): string | null {
  if (typeof value !== "string") return null;
  const clean = value
    .replace(/[\r\n<>]/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[private]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[private]")
    .replace(/\s{2,}/g, " ")
    .trim();
  return clean ? clean.slice(0, max) : null;
}

function payloadValue(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = text(payload[key]);
    if (value) return value;
  }
  return null;
}

export function friendlyChannel(source: string | null | undefined, medium: string | null | undefined): string {
  const normalizedSource = String(source || "").toLowerCase();
  const normalizedMedium = String(medium || "").toLowerCase();
  if (/(facebook|instagram|meta|fb)/.test(normalizedSource)) return "Facebook / Instagram ad";
  if (/(google|bing)/.test(normalizedSource) && /(cpc|paid|ppc)/.test(normalizedMedium)) return "Paid search";
  if (/(email|newsletter|shopify_email|klaviyo)/.test(`${normalizedSource} ${normalizedMedium}`)) return "Email";
  if (/(organic|seo)/.test(normalizedMedium) || /(google|bing)/.test(normalizedSource)) return "Organic search";
  if (normalizedSource && !/(direct|none|not set|unattributed)/.test(normalizedSource)) return "Referral";
  return "Direct or unattributed";
}

export function humanizeJourneyEvent(event: JourneyEventInput): JourneyTimelineEntry | null {
  const definition = EVENT_LABELS[event.name];
  if (!definition) return null;
  const payload = parsePayload(event.payload);
  const page = payloadValue(payload, "page_path", "pagePath", "path", "page", "url");
  let detail: string | null = null;
  if (event.name === "gallery_image_viewed" || event.name === "gallery_image_clicked") {
    detail = payloadValue(payload, "image_title", "imageTitle", "gallery_image_id", "image_id", "imageId");
  } else if (event.name === "section_viewed") {
    detail = payloadValue(payload, "section_title", "sectionTitle", "section_id", "sectionId");
  } else if (event.name === "faq_item_opened") {
    detail = payloadValue(payload, "question", "question_text", "faq_title", "faq_id");
  } else if (event.name === "testimonial_clicked") {
    detail = payloadValue(payload, "testimonial_title", "testimonial_id", "image_title");
  } else if (["cta_click", "FUNNEL_CTA_CLICKED", "checkout_clicked"].includes(event.name)) {
    detail = payloadValue(payload, "cta_text", "ctaText", "source_cta", "cta_id", "ctaId", "section_id");
  } else if (event.name === "add_to_cart_succeeded") {
    detail = payloadValue(payload, "bundle_name", "bundle_id", "shade", "shade_id");
  } else if (event.name.startsWith("popup_")) {
    const experience = payloadValue(payload, "experience");
    const version = payloadValue(payload, "popupVersion", "popup_version");
    detail = experience === "concierge" || version?.startsWith("novahair_ai") ? "AI Concierge" : "Exit experience";
  }
  return {
    at: new Date(event.occurredAt).toISOString(),
    category: definition.category,
    label: definition.label,
    detail,
    page,
  };
}

export function journeyDurationMinutes(timeline: JourneyTimelineEntry[], paidAt: Date | string): number | null {
  const purchaseAt = new Date(paidAt).getTime();
  const firstAt = timeline.length ? new Date(timeline[0].at).getTime() : NaN;
  if (!Number.isFinite(firstAt) || !Number.isFinite(purchaseAt) || purchaseAt < firstAt) return null;
  return Math.round((purchaseAt - firstAt) / 60000);
}

export function compactJourneyTimeline(entries: JourneyTimelineEntry[]): JourneyTimelineEntry[] {
  return [...entries]
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
    .filter((entry, index, all) => {
      if (index === 0) return true;
      const previous = all[index - 1];
      const sameContent = entry.label === previous.label && entry.detail === previous.detail && entry.page === previous.page;
      if (!sameContent) return true;
      if (entry.at === previous.at) return false;
      if (entry.category !== "experiment") return true;
      return new Date(entry.at).getTime() - new Date(previous.at).getTime() > 30 * 60_000;
    });
}
