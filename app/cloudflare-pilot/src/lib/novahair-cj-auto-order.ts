export interface ExpectedBundle {
  bundle_size: number;
  black: number;
  dark_brown: number;
  light_brown: number;
  purple: number;
  red: number;
  free_kit: number;
  expected_weight_g: number;
  original_sku: string;
}

export type NovaHairComponentKey = "black" | "dark_brown" | "light_brown" | "purple" | "red" | "free_kit";

export interface CjPhysicalMapping {
  vid: string;
  sku: string;
  name: string;
  weight_g: number;
}

export const CJ_PHYSICAL_MAPPINGS: Record<NovaHairComponentKey, CjPhysicalMapping> = {
  black: { vid: "2412030839551624000", sku: "CJYD223160001AZ", name: "Black", weight_g: 330.0 },
  dark_brown: { vid: "2412030839551624200", sku: "CJYD223160002BY", name: "Dark Brown", weight_g: 330.0 },
  light_brown: { vid: "2412030839551624400", sku: "CJYD223160003CX", name: "Light Brown", weight_g: 330.0 },
  purple: { vid: "2412030839551624700", sku: "CJYD223160005EV", name: "Purple", weight_g: 330.0 },
  red: { vid: "2412030839551624600", sku: "CJYD223160004DW", name: "Red", weight_g: 330.0 },
  free_kit: { vid: "ED56BD86-3AF9-4E8E-9855-FBD046D33613", sku: "CJBJMRPF00756-Suit", name: "Free Hair Dye Kit", weight_g: 110.0 },
};

export interface NovaHairCjProductLine {
  vid: string;
  sku: string;
  quantity: number;
  storeLineItemId?: string;
}

export interface NovaHairCjCreateOrderPayload {
  orderNumber: string;
  shippingZip?: string;
  shippingCountry: string;
  shippingCountryCode: string;
  shippingProvince: string;
  shippingCity: string;
  shippingPhone?: string;
  shippingCustomerName: string;
  shippingAddress: string;
  shippingAddress2?: string;
  email?: string;
  remark: string;
  payType: 3;
  logisticName: string;
  fromCountryCode: string;
  platform: "shopify";
  storeOrderTime?: number;
  orderFlow: 1;
  isSandbox?: 0 | 1;
  products: NovaHairCjProductLine[];
}

export class NovaHairCjAutoOrderError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "NovaHairCjAutoOrderError";
    this.code = code;
    this.details = details;
  }
}

const COMPONENT_ORDER: NovaHairComponentKey[] = ["black", "dark_brown", "light_brown", "purple", "red", "free_kit"];

function compactText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function optionalText(value: unknown): string | undefined {
  const text = compactText(value);
  return text ? text : undefined;
}

function normalizePhone(value: unknown): string | undefined {
  const raw = compactText(value);
  if (!raw) return undefined;
  return raw.replace(/[^\d+]/g, "").replace(/^00972/, "+972").replace(/^\+9720/, "+972");
}

export function normalizedNovaHairOrderNumber(value: unknown): string {
  const normalized = compactText(value).replace(/^#/, "").replace(/[^\w-]/g, "");
  if (!normalized) {
    throw new NovaHairCjAutoOrderError("MISSING_ORDER_NUMBER", "NovaHair CJ auto order requires a Shopify order number.");
  }
  return normalized;
}

export function novaHairAutoCjOrderNumber(orderNum: unknown): string {
  const number = normalizedNovaHairOrderNumber(orderNum);
  return `AUTO-${number}`.slice(0, 50);
}

export function buildNovaHairCjProductLines(expected: ExpectedBundle, storeLineItemId?: string): NovaHairCjProductLine[] {
  const bottleCount = expected.black + expected.dark_brown + expected.light_brown + expected.purple + expected.red;
  if (bottleCount <= 0 || bottleCount !== expected.bundle_size) {
    throw new NovaHairCjAutoOrderError("INVALID_BUNDLE_QUANTITY", "NovaHair bundle quantities do not match the selected bundle size.", {
      bundleSize: expected.bundle_size,
      bottleCount,
    });
  }
  if (expected.free_kit <= 0) {
    throw new NovaHairCjAutoOrderError("MISSING_FREE_KIT", "NovaHair CJ order requires the free coloring kit line.");
  }

  return COMPONENT_ORDER
    .map(component => ({ component, mapping: CJ_PHYSICAL_MAPPINGS[component], quantity: Number(expected[component] || 0) }))
    .filter(line => Number.isFinite(line.quantity) && line.quantity > 0)
    .map(line => ({
      vid: line.mapping.vid,
      sku: line.mapping.sku,
      quantity: line.quantity,
      ...(storeLineItemId ? { storeLineItemId } : {}),
    }));
}

function storeOrderTimestampSeconds(orderPayload: Record<string, unknown>): number | undefined {
  const raw = compactText(orderPayload.processed_at ?? orderPayload.created_at);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : Math.floor(parsed.getTime() / 1000);
}

function customerName(address: Record<string, unknown>, orderPayload: Record<string, unknown>): string | undefined {
  const explicit = optionalText(address.name);
  if (explicit) return explicit;
  const firstLast = [address.first_name, address.last_name].map(optionalText).filter(Boolean).join(" ");
  if (firstLast) return firstLast;
  const customer = orderPayload.customer && typeof orderPayload.customer === "object" && !Array.isArray(orderPayload.customer)
    ? orderPayload.customer as Record<string, unknown>
    : {};
  return [customer.first_name, customer.last_name].map(optionalText).filter(Boolean).join(" ") || undefined;
}

export function buildNovaHairCjCreateOrderPayload(
  orderPayload: Record<string, unknown>,
  expected: ExpectedBundle,
  options: {
    orderNumber?: string;
    logisticName?: string;
    fromCountryCode?: string;
    isSandbox?: boolean;
  } = {},
): NovaHairCjCreateOrderPayload {
  const address = orderPayload.shipping_address && typeof orderPayload.shipping_address === "object" && !Array.isArray(orderPayload.shipping_address)
    ? orderPayload.shipping_address as Record<string, unknown>
    : {};
  const orderNum = normalizedNovaHairOrderNumber(orderPayload.name ?? orderPayload.order_number);
  const lineItems = Array.isArray(orderPayload.line_items) ? orderPayload.line_items as Array<Record<string, unknown>> : [];
  const bundleLine = lineItems.find(line => compactText(line.sku) === expected.original_sku);
  const storeLineItemId = optionalText(bundleLine?.id);

  const payload: NovaHairCjCreateOrderPayload = {
    orderNumber: options.orderNumber ?? novaHairAutoCjOrderNumber(orderNum),
    shippingZip: optionalText(address.zip),
    shippingCountry: optionalText(address.country) ?? "Israel",
    shippingCountryCode: (optionalText(address.country_code) ?? "IL").toUpperCase(),
    shippingProvince: optionalText(address.province) ?? optionalText(address.city) ?? "Israel",
    shippingCity: optionalText(address.city) ?? optionalText(address.province) ?? "Israel",
    shippingPhone: normalizePhone(address.phone ?? orderPayload.phone),
    shippingCustomerName: customerName(address, orderPayload) ?? "",
    shippingAddress: optionalText(address.address1) ?? "",
    shippingAddress2: optionalText(address.address2),
    email: optionalText(orderPayload.email ?? orderPayload.contact_email),
    remark: `Auto NovaHair fulfillment for Shopify order #${orderNum}; source ${expected.original_sku}`,
    payType: 3,
    logisticName: options.logisticName ?? "CJPacket YP Special Line",
    fromCountryCode: options.fromCountryCode ?? "CN",
    platform: "shopify",
    storeOrderTime: storeOrderTimestampSeconds(orderPayload),
    orderFlow: 1,
    ...(options.isSandbox ? { isSandbox: 1 as const } : {}),
    products: buildNovaHairCjProductLines(expected, storeLineItemId),
  };

  const missing = [
    ["shippingCustomerName", payload.shippingCustomerName],
    ["shippingAddress", payload.shippingAddress],
    ["shippingCountry", payload.shippingCountry],
    ["shippingCountryCode", payload.shippingCountryCode],
    ["shippingProvince", payload.shippingProvince],
    ["shippingCity", payload.shippingCity],
  ].filter(([, value]) => !optionalText(value)).map(([field]) => field);

  if (missing.length > 0) {
    throw new NovaHairCjAutoOrderError("MISSING_SHIPPING_FIELDS", "NovaHair CJ auto order is missing required shipping fields.", { missing });
  }

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")) as unknown as NovaHairCjCreateOrderPayload;
}

