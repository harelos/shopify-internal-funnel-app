export interface PopupAttribution {
  code?: string;
  visitorId?: string;
  sessionId?: string;
  version?: string;
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

/** Extracts only pseudonymous popup markers from Shopify order line-item properties. */
export function extractPopupAttribution(payload: Record<string, unknown>): PopupAttribution | null {
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  for (const rawItem of lineItems) {
    const item = record(rawItem);
    if (!item) continue;
    const properties = Array.isArray(item.properties)
      ? item.properties.reduce<Record<string, unknown>>((acc, property) => {
        const propertyRecord = record(property);
        const name = text(propertyRecord?.name);
        if (name) acc[name] = propertyRecord?.value;
        return acc;
      }, {})
      : record(item.properties) ?? {};
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
