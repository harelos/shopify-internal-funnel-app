export const FUNNEL_CONTROL_PIXEL_ENDPOINT =
  'https://shopify-funnel-control.tigerbrands-funnel.workers.dev/api/shopify/pixel';

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
