type SharedElementContext = {
  experimentId: string;
  experimentKey: string;
  posthogFlagKey: string | null;
  variantId: string;
  variantKey: string;
  slotId: string;
  slotKey: string;
  pagePath: string;
};

function featureProperty(flagKey: string | null, variantKey: string) {
  return flagKey ? { [`$feature/${flagKey}`]: variantKey } : {};
}

export function buildElementExposureProperties(input: SharedElementContext & {
  eventId: string;
  assignmentId: string;
  allocationVersion: number;
  isInternal: boolean;
}) {
  return {
    event_schema_version: 1,
    event_id: input.eventId,
    "$insert_id": input.eventId,
    source: "funnel_control_element_ab",
    experiment_id: input.experimentId,
    experiment_key: input.experimentKey,
    experiment_variant: input.variantKey,
    variant_id: input.variantId,
    variant_key: input.variantKey,
    assignment_id: input.assignmentId,
    allocation_version: input.allocationVersion,
    slot_id: input.slotId,
    slot_key: input.slotKey,
    page_path: input.pagePath,
    is_internal: input.isInternal,
    ...(input.posthogFlagKey ? {
      $feature_flag: input.posthogFlagKey,
      $feature_flag_response: input.variantKey,
    } : {}),
    ...featureProperty(input.posthogFlagKey, input.variantKey),
  };
}

export async function captureElementExposureToPostHog(
  visitorId: string,
  input: Parameters<typeof buildElementExposureProperties>[0],
) {
  if (input.isInternal) return false;
  const { capturePostHogServerEvent } = await import("../lib/posthog-server.js");
  const properties = buildElementExposureProperties(input);
  const distinctId = `element:${visitorId}`;
  const events = [capturePostHogServerEvent("experiment_exposed", distinctId, properties)];
  if (input.posthogFlagKey) {
    const flagEventId = `${input.eventId}:flag`;
    events.push(capturePostHogServerEvent("$feature_flag_called", distinctId, {
      ...properties,
      event_id: flagEventId,
      "$insert_id": flagEventId,
    }));
  }
  const results = await Promise.all(events);
  return results.every(Boolean);
}

export function buildElementPurchaseProperties(input: SharedElementContext & {
  eventId: string;
  assignmentId: string;
  orderId: string;
  checkoutToken: string;
  revenue: number;
  currency: string;
}) {
  return {
    event_schema_version: 1,
    event_id: input.eventId,
    "$insert_id": input.eventId,
    source: "shopify_paid_order",
    experiment_id: input.experimentId,
    experiment_key: input.experimentKey,
    experiment_variant: input.variantKey,
    variant_id: input.variantId,
    variant_key: input.variantKey,
    assignment_id: input.assignmentId,
    slot_id: input.slotId,
    slot_key: input.slotKey,
    page_path: input.pagePath,
    order_id: input.orderId,
    checkout_token: input.checkoutToken,
    revenue: input.revenue,
    value: input.revenue,
    currency: input.currency,
    is_internal: false,
    ...featureProperty(input.posthogFlagKey, input.variantKey),
  };
}

export async function captureElementPurchaseToPostHog(
  visitorId: string,
  input: Parameters<typeof buildElementPurchaseProperties>[0],
) {
  const { capturePostHogServerEvent } = await import("../lib/posthog-server.js");
  return capturePostHogServerEvent(
    "element_purchase_attributed",
    `element:${visitorId}`,
    buildElementPurchaseProperties(input),
  );
}
