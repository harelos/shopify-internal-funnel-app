export interface ExpectedBundle {
  bundle_size: number;
  black: number;
  dark_brown: number;
  /** Added to the catalogue after launch; see BOTTLE_ORDER_BY_SEGMENTS. */
  medium_brown: number;
  light_brown: number;
  purple: number;
  red: number;
  /**
   * Sold since September 2026. It has no variant on the six-shade listing;
   * it is supplied from a second CJ listing (see CJ_PHYSICAL_MAPPINGS).
   * Absent on bundles queued before the shade existed.
   */
  golden_blonde?: number;
  free_kit: number;
  expected_weight_g: number;
  original_sku: string;
  /** Absent on NovaHair bundles, which are built from the colour counts. */
  brand?: "novahair" | "oceaura";
  /** Component lines spelled out in advance; the colour counts are then unused. */
  lines?: NovaHairCjProductLine[];
  /** Products sold beside the bundle that CJ ships in the same parcel. */
  addons?: ExpectedAddon[];
  /** Extra-bottle upsell lines, already folded into the colour counts above. */
  extras?: Array<{ sku: string; quantity: number }>;
}

export interface ExpectedAddon {
  sku: string;
  vid: string;
  name: string;
  quantity: number;
}

export type NovaHairBottleKey = "black" | "dark_brown" | "medium_brown" | "light_brown" | "purple" | "red" | "golden_blonde";
export type NovaHairComponentKey = NovaHairBottleKey | "free_kit";
/** Every shade the store sells. Kept as its own name for the call sites that mean "a colour, not the kit". */
export type NovaHairShadeKey = NovaHairBottleKey;

export interface CjPhysicalMapping {
  vid: string;
  sku: string;
  name: string;
  weight_g: number;
}

export const BOTTLE_WEIGHT_G = 330.0;
export const FREE_KIT_WEIGHT_G = 110.0;

/**
 * Six shades come from CJ listing 2412030839551623800 (330 g, $2.09).
 * Golden Blonde has no variant there at all, which left #4481 paid and
 * unshippable; it is supplied from listing 2609141240481605400 ("Gold",
 * 370 g, $1.82), a different box from a different factory. Verified against
 * CJ on 2026-09-17.
 */
export const CJ_PHYSICAL_MAPPINGS: Record<NovaHairComponentKey, CjPhysicalMapping> = {
  black: { vid: "2412030839551624000", sku: "CJYD223160001AZ", name: "Black", weight_g: BOTTLE_WEIGHT_G },
  dark_brown: { vid: "2412030839551624200", sku: "CJYD223160002BY", name: "Dark Brown", weight_g: BOTTLE_WEIGHT_G },
  light_brown: { vid: "2412030839551624400", sku: "CJYD223160003CX", name: "Light Brown", weight_g: BOTTLE_WEIGHT_G },
  purple: { vid: "2412030839551624700", sku: "CJYD223160005EV", name: "Purple", weight_g: BOTTLE_WEIGHT_G },
  medium_brown: { vid: "2507140803121609000", sku: "CJYD223160006FU", name: "Medium Brown", weight_g: BOTTLE_WEIGHT_G },
  red: { vid: "2412030839551624600", sku: "CJYD223160004DW", name: "Red", weight_g: BOTTLE_WEIGHT_G },
  golden_blonde: { vid: "2609141240481606305", sku: "CJYD316315806FU", name: "Golden Blonde", weight_g: 370.0 },
  free_kit: { vid: "ED56BD86-3AF9-4E8E-9855-FBD046D33613", sku: "CJBJMRPF00756-Suit", name: "Free Hair Dye Kit", weight_g: FREE_KIT_WEIGHT_G },
};

/**
 * Shades the store sells that CJ cannot supply. Empty since Golden Blonde was
 * sourced on 2026-09-17, and kept because the next shade added to the store
 * will arrive the same way: a parcel that needs one is refused with
 * NO_SUPPLIER_MAPPING and parked where a person will see it, instead of being
 * shipped short or, as happened to #4481, never ordered and never mentioned.
 */
export const UNMAPPED_COMPONENTS: Record<string, { name: string; reason: string }> = {};

/**
 * Products sold beside the bundle that CJ ships in the same parcel, keyed by
 * the Shopify SKU, which is CJ's own variant SKU. Verified against CJ on
 * 2026-09-17. A CJ-sourced SKU missing from this table refuses the whole
 * parcel rather than falling out of it: the automatic order used to carry
 * only the bundle, and customers paid for masks that were never sent.
 */
export const CJ_ADDON_MAPPINGS: Record<string, CjPhysicalMapping> = {
  CJYD231269201AZ: { vid: "2503011116441608900", sku: "CJYD231269201AZ", name: "Argan Oil Hair Mask 500g", weight_g: 568 },
  CJJT228873001AZ: { vid: "2502110727121606600", sku: "CJJT228873001AZ", name: "Hair Gloss Spray 100ml", weight_g: 145 },
  CJYD268780701AZ: { vid: "2512250315511638400", sku: "CJYD268780701AZ", name: "Keratin Hair Serum 50ml", weight_g: 95 },
  CJYD197393402BY: { vid: "1760593893348872192", sku: "CJYD197393402BY", name: "Scalp Massage Shampoo Brush (Purple)", weight_g: 60 },
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

/** Every bottle colour, in no particular order; free_kit is not a bottle. */
export const BOTTLE_KEYS: NovaHairBottleKey[] = ["black", "dark_brown", "medium_brown", "light_brown", "purple", "red", "golden_blonde"];

/** Alias for the call sites that mean "every shade", supplied or not. */
export const ALL_SHADE_KEYS: NovaHairShadeKey[] = BOTTLE_KEYS;

/**
 * How many of one component a parcel needs, read by name.
 *
 * UNMAPPED_COMPONENTS is keyed by shades that do not exist in the type yet —
 * that is the whole point of it — so the lookup cannot be statically typed.
 */
export function componentQuantity(expected: ExpectedBundle, key: string): number {
  return Number((expected as unknown as Record<string, unknown>)[key] || 0);
}

/** What CJ will weigh: each shade at its own listing's weight, plus the kits. */
export function bundleWeightG(bottles: Partial<Record<NovaHairShadeKey, number>>, kits: number): number {
  const shades = BOTTLE_KEYS.reduce((sum, key) => sum + (Number(bottles[key]) || 0) * CJ_PHYSICAL_MAPPINGS[key].weight_g, 0);
  return shades + kits * FREE_KIT_WEIGHT_G;
}

/**
 * A NOVASALE SKU lists one quantity per colour, in catalogue order. Each new
 * shade widened the SKU: Medium Brown was inserted third, Golden Blonde was
 * appended last. All three shapes are still sold, and reading a wider SKU
 * with a narrower order would ship the wrong colour, so the segment count
 * selects the order. Read from the live catalogue on 2026-09-17: the
 * single-colour variants NOVASALE-{2,4}-0-0-0-0-0-0-{n} are titled
 * "בלונד זהוב" and the mixes "שחור 2 + בלונד זהוב 2" keep the older order in
 * front of it.
 */
export const BOTTLE_ORDER_BY_SEGMENTS: Record<number, NovaHairShadeKey[]> = {
  5: ["black", "dark_brown", "light_brown", "purple", "red"],
  6: ["black", "dark_brown", "medium_brown", "light_brown", "purple", "red"],
  7: ["black", "dark_brown", "medium_brown", "light_brown", "purple", "red", "golden_blonde"],
};

const REGEX_NOVASALE = /^NOVASALE-(2|4|6)((?:-\d+){5,7})$/;

export function emptyShadeCounts(): Record<NovaHairShadeKey, number> {
  return Object.fromEntries(ALL_SHADE_KEYS.map(key => [key, 0])) as Record<NovaHairShadeKey, number>;
}

/**
 * Reads a NOVASALE bundle SKU into per-shade bottle counts.
 *
 * Lives here, beside the CJ mappings, rather than in the monitor: the monitor
 * imports the Worker runtime, which kept this pure logic untestable, and
 * getting it wrong ships a customer the wrong hair colour.
 */
export function decodeBundleSku(sku: string, parentQuantity: number = 1): ExpectedBundle | null {
  const text = String(sku ?? "").trim();
  const m = REGEX_NOVASALE.exec(text);
  if (!m) return null;
  const bundleSize = parseInt(m[1], 10);
  const quantities = m[2].split("-").slice(1).map(value => parseInt(value, 10));
  const order = BOTTLE_ORDER_BY_SEGMENTS[quantities.length];
  if (!order || quantities.some(value => !Number.isFinite(value) || value < 0)) return null;
  if (quantities.reduce((sum, value) => sum + value, 0) !== bundleSize) return null;

  const multiplier = Math.max(1, Math.floor(Number(parentQuantity) || 1));
  const bottles = emptyShadeCounts();
  order.forEach((key, index) => { bottles[key] = quantities[index] * multiplier; });

  return {
    bundle_size: bundleSize * multiplier,
    ...bottles,
    free_kit: 1 * multiplier,
    expected_weight_g: bundleWeightG(bottles, 1 * multiplier),
    original_sku: text,
  };
}

/** True when this SKU is a NovaHair bundle line this code can read. */
export function isNovaHairBundleSku(sku: string): boolean {
  return REGEX_NOVASALE.test(String(sku ?? "").trim());
}

/**
 * The extra-bottle upsell (products 10415681110311 and 10415681274151):
 * NOVAEXTRA-{bottles}-{shade}[-{shade}...], one shade slug per bottle, so
 * NOVAEXTRA-2-black-dark_brown is one Black and one Dark Brown. The bottles
 * are the same CJ variants as the bundle's and travel in the same parcel;
 * there is no kit. Slugs read from the live catalogue on 2026-09-17.
 */
const REGEX_NOVAEXTRA = /^NOVAEXTRA-(\d+)((?:-[a-z_]+)+)$/i;

export const EXTRA_BOTTLE_SLUGS: Record<string, NovaHairShadeKey> = {
  black: "black",
  dark_brown: "dark_brown",
  medium_brown: "medium_brown",
  light_brown: "light_brown",
  purple: "purple",
  red: "red",
  blonde: "golden_blonde",
};

/** True when this SKU is an extra-bottle upsell line this code can read. */
export function isExtraBottlesSku(sku: string): boolean {
  return decodeExtraBottlesSku(sku) !== null;
}

export function decodeExtraBottlesSku(sku: string, parentQuantity: number = 1): Record<NovaHairShadeKey, number> | null {
  const m = REGEX_NOVAEXTRA.exec(String(sku ?? "").trim());
  if (!m) return null;
  const bottles = parseInt(m[1], 10);
  const slugs = m[2].split("-").slice(1).map(slug => slug.toLowerCase());
  // One slug per bottle; a SKU that says two and names one cannot be trusted.
  if (!Number.isFinite(bottles) || bottles <= 0 || slugs.length !== bottles) return null;
  const multiplier = Math.max(1, Math.floor(Number(parentQuantity) || 1));
  const counts = emptyShadeCounts();
  for (const slug of slugs) {
    const key = EXTRA_BOTTLE_SLUGS[slug];
    if (!key) return null;
    counts[key] += multiplier;
  }
  return counts;
}

const COMPONENT_ORDER: NovaHairComponentKey[] = ["black", "dark_brown", "medium_brown", "light_brown", "purple", "red", "golden_blonde", "free_kit"];

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

/**
 * Everything CJ must put in the parcel, as CJ lines.
 *
 * Refuses, rather than ships short, when a shade has no CJ variant: the
 * customer paid for it, and a parcel missing it is a complaint and a refund,
 * not a fulfilment.
 */
export function buildNovaHairCjProductLines(expected: ExpectedBundle, storeLineItemId?: string): NovaHairCjProductLine[] {
  const tag = storeLineItemId ? { storeLineItemId } : {};
  const lines: NovaHairCjProductLine[] = [];
  const explicit = Array.isArray(expected.lines) && expected.lines.length > 0;

  const unmapped = Object.keys(UNMAPPED_COMPONENTS).filter(key => componentQuantity(expected, key) > 0);
  if (unmapped.length) {
    throw new NovaHairCjAutoOrderError(
      "NO_SUPPLIER_MAPPING",
      `CJ has no variant for ${unmapped.map(key => UNMAPPED_COMPONENTS[key].name).join(", ")}; this parcel cannot be ordered until one exists.`,
      { components: unmapped.map(key => ({ component: key, quantity: componentQuantity(expected, key) })) },
    );
  }

  // A bundle that already names its components (OceAura) skips the colour
  // arithmetic and the free-kit rule, which are NovaHair's alone.
  if (explicit) {
    lines.push(...(expected.lines as NovaHairCjProductLine[])
      .filter(line => Number.isFinite(line.quantity) && line.quantity > 0)
      .map(line => ({ vid: line.vid, sku: line.sku, quantity: line.quantity, ...tag })));
  }

  // Summed over every shade there is. Naming them one by one here is what
  // blocked Medium Brown orders after the shade was added: the decoder read
  // them correctly and this guard then rejected the bundle as empty.
  const bottleCount = BOTTLE_KEYS.reduce((sum, key) => sum + (Number(expected[key]) || 0), 0);
  if (!explicit) {
    if (bottleCount <= 0 || bottleCount !== expected.bundle_size) {
      throw new NovaHairCjAutoOrderError("INVALID_BUNDLE_QUANTITY", "NovaHair bundle quantities do not match the selected bundle size.", {
        bundleSize: expected.bundle_size,
        bottleCount,
      });
    }
    // The kit ships with every bundle; extra bottles bought on their own carry none.
    if (expected.free_kit <= 0 && /NOVASALE-/i.test(expected.original_sku)) {
      throw new NovaHairCjAutoOrderError("MISSING_FREE_KIT", "NovaHair CJ order requires the free coloring kit line.");
    }
  }

  lines.push(...COMPONENT_ORDER
    .map(component => ({ component, mapping: CJ_PHYSICAL_MAPPINGS[component], quantity: Number(expected[component] || 0) }))
    .filter(line => Number.isFinite(line.quantity) && line.quantity > 0)
    .map(line => ({ vid: line.mapping.vid, sku: line.mapping.sku, quantity: line.quantity, ...tag })));

  for (const addon of expected.addons || []) {
    if (!Number.isFinite(addon.quantity) || addon.quantity <= 0) continue;
    lines.push({ vid: addon.vid, sku: addon.sku, quantity: addon.quantity, ...tag });
  }

  return lines;
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

function parcelRemark(orderNum: string, expected: ExpectedBundle): string {
  const parts = [`Auto ${expected.brand === "oceaura" ? "OceAura" : "NovaHair"} fulfillment for Shopify order #${orderNum}; source ${expected.original_sku}`];
  if (expected.extras?.length) parts.push(`extras ${expected.extras.map(extra => `${extra.sku} x${extra.quantity}`).join(", ")}`);
  if (expected.addons?.length) parts.push(`add-ons ${expected.addons.map(addon => `${addon.sku} x${addon.quantity}`).join(", ")}`);
  return parts.join("; ").slice(0, 500);
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
  // CJ refuses an order with no postcode. Israeli shoppers often leave it
  // blank, and Shopify does not require it for Israel, so the billing address
  // is the one other place the same person may have typed it.
  const billing = orderPayload.billing_address && typeof orderPayload.billing_address === "object" && !Array.isArray(orderPayload.billing_address)
    ? orderPayload.billing_address as Record<string, unknown>
    : {};
  const orderNum = normalizedNovaHairOrderNumber(orderPayload.name ?? orderPayload.order_number);
  const lineItems = Array.isArray(orderPayload.line_items) ? orderPayload.line_items as Array<Record<string, unknown>> : [];
  const bundleLine = lineItems.find(line => compactText(line.sku) === expected.original_sku);
  const storeLineItemId = optionalText(bundleLine?.id);
  const products = buildNovaHairCjProductLines(expected, storeLineItemId);
  // An add-on line points at its own Shopify line, not the bundle's.
  for (const addon of expected.addons || []) {
    const line = lineItems.find(item => compactText(item.sku).toUpperCase() === addon.sku.toUpperCase());
    const lineId = optionalText(line?.id);
    if (!lineId) continue;
    for (const product of products) if (product.sku === addon.sku) product.storeLineItemId = lineId;
  }

  const payload: NovaHairCjCreateOrderPayload = {
    orderNumber: options.orderNumber ?? novaHairAutoCjOrderNumber(orderNum),
    shippingZip: optionalText(address.zip) ?? optionalText(billing.zip),
    shippingCountry: optionalText(address.country) ?? "Israel",
    shippingCountryCode: (optionalText(address.country_code) ?? "IL").toUpperCase(),
    shippingProvince: optionalText(address.province) ?? optionalText(address.city) ?? "Israel",
    shippingCity: optionalText(address.city) ?? optionalText(address.province) ?? "Israel",
    shippingPhone: normalizePhone(address.phone ?? orderPayload.phone),
    shippingCustomerName: customerName(address, orderPayload) ?? "",
    shippingAddress: optionalText(address.address1) ?? "",
    shippingAddress2: optionalText(address.address2),
    email: optionalText(orderPayload.email ?? orderPayload.contact_email),
    remark: parcelRemark(orderNum, expected),
    payType: 3,
    logisticName: options.logisticName ?? "CJPacket YP Special Line",
    fromCountryCode: options.fromCountryCode ?? "CN",
    platform: "shopify",
    storeOrderTime: storeOrderTimestampSeconds(orderPayload),
    orderFlow: 1,
    ...(options.isSandbox ? { isSandbox: 1 as const } : {}),
    products,
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
