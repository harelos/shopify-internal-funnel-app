export const FUNNEL_CONTROL_PIXEL_ENDPOINT =
  'https://shopify-funnel-control.tigerbrands-funnel.workers.dev/api/shopify/pixel';

export const FUNNEL_CONTROL_CART_ATTRIBUTE = '__funnel_context__';

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
