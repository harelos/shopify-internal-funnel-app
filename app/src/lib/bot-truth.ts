export type BotTruthAuthority =
  | "SHOPIFY_STORE_FACT"
  | "KNOWLEDGE_PACK"
  | "BUSINESS_RULE"
  | "MODEL_PROSE";

export const BOT_TRUTH_HIERARCHY: ReadonlyArray<{ authority: BotTruthAuthority; rank: number; label: string }> = [
  { authority: "SHOPIFY_STORE_FACT", rank: 400, label: "Structured Shopify/store facts" },
  { authority: "KNOWLEDGE_PACK", rank: 300, label: "Versioned internal knowledge packs" },
  { authority: "BUSINESS_RULE", rank: 200, label: "Deterministic business rules" },
  { authority: "MODEL_PROSE", rank: 100, label: "Model-generated prose" },
];

const authorityRank = Object.fromEntries(BOT_TRUTH_HIERARCHY.map(item => [item.authority, item.rank])) as Record<BotTruthAuthority, number>;

export const BOT_RESTRICTED_FACT_KEYS = new Set([
  "product_price",
  "shipping_terms",
  "discount",
  "coupon_code",
  "guarantee",
  "inventory",
  "delivery_promise",
  "refund_policy",
  "private_customer_info",
]);

export const BOT_NEVER_EXPOSE_KEYS = new Set([
  "internal_margin",
  "contribution_margin",
  "supplier_cost",
  "cogs",
  "provider_secret",
  "coupon_inventory",
]);

export interface BotTruthCandidate<T = unknown> {
  key: string;
  value: T;
  authority: BotTruthAuthority;
  sourceId: string;
  version?: string | null;
  verifiedAt?: string | Date | null;
}

export interface BotTruthResolution<T = unknown> {
  key: string;
  status: "RESOLVED" | "UNCERTAIN" | "MISSING";
  candidate: BotTruthCandidate<T> | null;
  conflictingCandidates: BotTruthCandidate<T>[];
  reason: string;
}

function normalized(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ").toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  } catch {
    return String(value);
  }
}

export function resolveBotTruth<T = unknown>(key: string, candidates: BotTruthCandidate<T>[]): BotTruthResolution<T> {
  const usable = candidates.filter(candidate => candidate.key === key && candidate.value !== undefined && candidate.value !== null);
  if (!usable.length) {
    return { key, status: "MISSING", candidate: null, conflictingCandidates: [], reason: "NO_AUTHORITATIVE_FACT" };
  }

  const highestRank = Math.max(...usable.map(candidate => authorityRank[candidate.authority] || 0));
  const top = usable.filter(candidate => (authorityRank[candidate.authority] || 0) === highestRank);
  const distinctValues = new Set(top.map(candidate => normalized(candidate.value)));

  if (distinctValues.size > 1) {
    return {
      key,
      status: "UNCERTAIN",
      candidate: null,
      conflictingCandidates: top,
      reason: "CONFLICT_AT_HIGHEST_AUTHORITY",
    };
  }

  return {
    key,
    status: "RESOLVED",
    candidate: top[0],
    conflictingCandidates: [],
    reason: `RESOLVED_FROM_${top[0].authority}`,
  };
}

export function canExposeTruthToCustomer(resolution: BotTruthResolution): boolean {
  if (resolution.status !== "RESOLVED" || !resolution.candidate) return false;
  const key = resolution.key.toLowerCase();
  if (BOT_NEVER_EXPOSE_KEYS.has(key)) return false;
  if (BOT_RESTRICTED_FACT_KEYS.has(key) && resolution.candidate.authority === "MODEL_PROSE") return false;
  return true;
}

export function requiresApprovedLookup(key: string, resolution: BotTruthResolution): boolean {
  const normalizedKey = key.toLowerCase();
  if (BOT_NEVER_EXPOSE_KEYS.has(normalizedKey)) return false;
  if (!BOT_RESTRICTED_FACT_KEYS.has(normalizedKey)) return false;
  return !canExposeTruthToCustomer(resolution);
}
