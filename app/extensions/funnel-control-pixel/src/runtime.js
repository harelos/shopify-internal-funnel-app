export const FUNNEL_CONTROL_PIXEL_ENDPOINT =
  'https://shopify-funnel-control.tigerbrands-funnel.workers.dev/api/shopify/pixel';

export const FUNNEL_CONTROL_CART_ATTRIBUTE = '__funnel_context__';
const CONCIERGE_MARKER_KEYS = new Set([
  '_nh_popup', '_nh_conversation_id', '_nh_visitor_id', '_nh_session_id',
  '_nh_version', '_nh_agent', '_nh_trigger', '_nh_device',
]);

/**
 * Keep checkout telemetry on the app-owned origin. The merchant setting remains
 * in the extension schema for compatibility with the existing pixel record, but
 * it can never redirect checkout data to another host and an empty setting can
 * no longer disable the pixel silently.
 */
export function resolvePixelEndpoint(configuredEndpoint) {
  const configured = String(configuredEndpoint || '').trim();
  return configured === FUNNEL_CONTROL_PIXEL_ENDPOINT
    ? configured
    : FUNNEL_CONTROL_PIXEL_ENDPOINT;
}

function text(value, maxLength) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function checkoutAttributes(checkout) {
  return Array.isArray(checkout?.attributes) ? checkout.attributes : [];
}

/**
 * Read only the app-owned private cart attribute. Other checkout attributes can
 * contain shopper data and must never enter the analytics envelope.
 */
export function cartContextFromEvent(event) {
  const checkout = event?.data?.checkout;
  const attribute = checkoutAttributes(checkout).find((candidate) =>
    candidate?.key === FUNNEL_CONTROL_CART_ATTRIBUTE,
  );
  const value = text(attribute?.value, 3400);
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Extract the Concierge's deliberately allow-listed pseudonymous marker from
 * checkout attributes. We never forward arbitrary cart attributes (which may
 * contain shopper data), and we do not forward UTM/click IDs here because the
 * app-owned funnel context already carries those separately.
 */
export function conciergeContextFromEvent(event) {
  const checkout = event?.data?.checkout;
  const attributes = checkoutAttributes(checkout);
  const values = {};
  for (const candidate of attributes) {
    const key = text(candidate?.key, 80);
    if (!key || !CONCIERGE_MARKER_KEYS.has(key)) continue;
    values[key] = text(candidate?.value, 180) || '';
  }
  if (values._nh_popup !== '1') return {};
  return {
    popup: true,
    conversationId: values._nh_conversation_id || '',
    visitorId: values._nh_visitor_id || '',
    sessionId: values._nh_session_id || '',
    version: values._nh_version || '',
    agent: values._nh_agent || '',
    trigger: values._nh_trigger || '',
    device: values._nh_device || '',
  };
}

/**
 * Reduce Shopify's standard checkout payload before it crosses the network.
 * Email, phone, addresses, line items and arbitrary cart attributes are never
 * forwarded. Shopify webhooks remain authoritative for money and order state.
 */
export function reduceCheckoutEvent(event) {
  const checkout = event?.data?.checkout;
  const order = checkout?.order;
  const customer = order?.customer;
  return {
    id: text(event?.id, 180),
    name: text(event?.name, 80),
    timestamp: text(event?.timestamp, 80),
    data: {
      checkout: {
        token: text(checkout?.token, 300),
        order: {
          id: text(order?.id, 180),
          customer: {id: text(customer?.id, 180)},
        },
      },
    },
  };
}
