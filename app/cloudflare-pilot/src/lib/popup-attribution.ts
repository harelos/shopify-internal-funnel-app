export interface PopupAttribution {
  method: "CART_NOTE_ATTRIBUTES" | "LINE_ITEM_PROPERTIES";
  code?: string;
  visitorId?: string;
  sessionId?: string;
  conversationId?: string;
  version?: string;
  agent?: string;
  trigger?: string;
  page?: string;
  device?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function attributesRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return value.reduce<Record<string, unknown>>((acc, attribute) => {
      const item = record(attribute);
      const name = text(item?.name);
      if (name) acc[name] = item?.value;
      return acc;
    }, {});
  }
  return record(value) ?? {};
}

function newConciergeAttribution(payload: Record<string, unknown>): PopupAttribution | null {
  const attributes = attributesRecord(payload.note_attributes ?? payload.attributes);
  if (String(attributes._nh_popup ?? "") !== "1") return null;
  const value = (key: string) => text(attributes[key]);
  return {
    method: "CART_NOTE_ATTRIBUTES",
    ...(value("_nh_coupon") ? { code: value("_nh_coupon") } : {}),
    ...(value("_nh_visitor_id") ? { visitorId: value("_nh_visitor_id") } : {}),
    ...(value("_nh_session_id") ? { sessionId: value("_nh_session_id") } : {}),
    ...(value("_nh_conversation_id") ? { conversationId: value("_nh_conversation_id") } : {}),
    ...(value("_nh_version") ? { version: value("_nh_version") } : {}),
    ...(value("_nh_agent") ? { agent: value("_nh_agent") } : {}),
    ...(value("_nh_trigger") ? { trigger: value("_nh_trigger") } : {}),
    ...(value("_nh_page") ? { page: value("_nh_page") } : {}),
    ...(value("_nh_device") ? { device: value("_nh_device") } : {}),
    ...(value("_nh_utm_source") ? { utmSource: value("_nh_utm_source") } : {}),
    ...(value("_nh_utm_medium") ? { utmMedium: value("_nh_utm_medium") } : {}),
    ...(value("_nh_utm_campaign") ? { utmCampaign: value("_nh_utm_campaign") } : {}),
  };
}

/** Extracts pseudonymous popup markers from the current cart attributes and the legacy line-item format. */
export function extractPopupAttribution(payload: Record<string, unknown>): PopupAttribution | null {
  const current = newConciergeAttribution(payload);
  if (current) return current;
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  for (const rawItem of lineItems) {
    const item = record(rawItem);
    if (!item) continue;
    const properties = attributesRecord(item.properties);
    if (String(properties._NOVA_EXIT_POPUP ?? "") !== "1") continue;
    const code = text(properties._NOVA_EXIT_COUPON);
    const visitorId = text(properties._NOVA_EXIT_VISITOR);
    const sessionId = text(properties._NOVA_EXIT_SESSION);
    const version = text(properties._NOVA_EXIT_VERSION);
    const page = text(properties._NOVA_EXIT_PAGE);
    const device = text(properties._NOVA_EXIT_DEVICE);
    const utmSource = text(properties._NOVA_EXIT_UTM_SOURCE);
    const utmMedium = text(properties._NOVA_EXIT_UTM_MEDIUM);
    const utmCampaign = text(properties._NOVA_EXIT_UTM_CAMPAIGN);
    return {
      method: "LINE_ITEM_PROPERTIES",
      ...(code ? { code } : {}),
      ...(visitorId ? { visitorId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(version ? { version } : {}),
      ...(page ? { page } : {}),
      ...(device ? { device } : {}),
      ...(utmSource ? { utmSource } : {}),
      ...(utmMedium ? { utmMedium } : {}),
      ...(utmCampaign ? { utmCampaign } : {}),
    };
  }
  return null;
}

/** Extracts Shopify's authoritative discount code list without other order data. */
export function extractDiscountCodes(payload: Record<string, unknown>): string[] {
  const entries = Array.isArray(payload.discount_codes) ? payload.discount_codes : [];
  return [...new Set(entries
    .map(entry => text(record(entry)?.code))
    .filter((code): code is string => Boolean(code))
    .map(code => code.toUpperCase()))];
}
