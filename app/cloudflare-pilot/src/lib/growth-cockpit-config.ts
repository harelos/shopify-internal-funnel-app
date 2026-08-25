export const DEFAULT_REPORTING_TIMEZONE = "Asia/Jerusalem";

export const GROWTH_COCKPIT_PRESETS = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "all_time",
] as const;

export type GrowthCockpitPreset = typeof GROWTH_COCKPIT_PRESETS[number];

const DATE_LABEL_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export interface GrowthCockpitDateRange {
  preset: GrowthCockpitPreset | "custom";
  timezone: string;
  localFrom: string | null;
  localTo: string | null;
  from: string | null;
  toExclusive: string | null;
}

export interface GrowthCockpitComparisonWindow {
  range: GrowthCockpitDateRange | null;
  reason: string | null;
}

export interface GrowthCockpitConfig {
  reportingTimezone: string;
  reportingCurrency: string | null;
  reportingCurrencyConfigured: boolean;
  access: {
    data: { mechanism: "SHOPIFY_SESSION_TOKEN"; enforced: true };
    document: { mechanism: "SHOPIFY_SESSION_TOKEN"; enforced: true; shell: "NOINDEX_STATIC_SHELL"; releaseBlocked: false };
    requiredBeforeProduction: "CLOUDFLARE_ACCESS_OR_SERVER_ADMIN_SESSION";
  };
  sources: {
    revenue: "SHOPIFY";
    orders: "SHOPIFY";
    popupEvents: "D1";
    metaSpend: "META_ADS_API" | "NOT_CONFIGURED";
    cjCosts: "CJ_COST_LEDGER" | "NOT_CONFIGURED";
    paymentFees: "SHOPIFY_TRANSACTION_FEES" | "NOT_CONFIGURED";
  };
}

function assertTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid reporting timezone: ${timezone}`);
  }
  return timezone;
}

function dateParts(instant: Date, timezone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return Object.fromEntries(formatter.formatToParts(instant)
    .filter(part => part.type !== "literal")
    .map(part => [part.type, Number(part.value)]));
}

function timezoneOffsetMs(instant: Date, timezone: string): number {
  const parts = dateParts(instant, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - instant.getTime();
}

function zonedMidnight(dateLabel: string, timezone: string): Date {
  const [year, month, day] = dateLabel.split("-").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = wallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    guess = wallClock - timezoneOffsetMs(new Date(guess), timezone);
  }
  return new Date(guess);
}

function isValidDateLabel(value: string): boolean {
  if (!DATE_LABEL_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function localDateLabel(instant: Date, timezone: string): string {
  const parts = dateParts(instant, timezone);
  return [parts.year, parts.month, parts.day]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function addCalendarDays(dateLabel: string, days: number): string {
  const [year, month, day] = dateLabel.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function dateRangeForLabels(
  preset: GrowthCockpitDateRange["preset"],
  localFrom: string | null,
  localTo: string | null,
  timezone: string,
): GrowthCockpitDateRange {
  return {
    preset,
    timezone,
    localFrom,
    localTo,
    from: localFrom ? zonedMidnight(localFrom, timezone).toISOString() : null,
    toExclusive: localTo ? zonedMidnight(addCalendarDays(localTo, 1), timezone).toISOString() : null,
  };
}

export function resolveGrowthCockpitRange(input: {
  preset?: string;
  from?: string;
  to?: string;
  now?: Date;
  timezone?: string;
}): GrowthCockpitDateRange {
  const timezone = assertTimezone(input.timezone || DEFAULT_REPORTING_TIMEZONE);
  const now = input.now || new Date();
  if (Number.isNaN(now.getTime())) throw new Error("Invalid reference time.");

  if (input.from || input.to) {
    if (!input.from || !input.to || !isValidDateLabel(input.from) || !isValidDateLabel(input.to)) {
      throw new Error("Custom ranges require valid from and to dates in YYYY-MM-DD format.");
    }
    if (input.from > input.to) throw new Error("The range start cannot be after the range end.");
    return dateRangeForLabels("custom", input.from, input.to, timezone);
  }

  const today = localDateLabel(now, timezone);
  switch (input.preset || "today") {
    case "today":
      return dateRangeForLabels("today", today, today, timezone);
    case "yesterday": {
      const yesterday = addCalendarDays(today, -1);
      return dateRangeForLabels("yesterday", yesterday, yesterday, timezone);
    }
    case "last_7_days":
      return dateRangeForLabels("last_7_days", addCalendarDays(today, -6), today, timezone);
    case "last_30_days":
      return dateRangeForLabels("last_30_days", addCalendarDays(today, -29), today, timezone);
    case "all_time":
      return dateRangeForLabels("all_time", null, null, timezone);
    default:
      throw new Error(`Unsupported date preset: ${input.preset}`);
  }
}

export function previousEquivalentGrowthCockpitRange(range: GrowthCockpitDateRange): GrowthCockpitComparisonWindow {
  if (range.preset === "all_time" || !range.localFrom || !range.localTo) {
    return { range: null, reason: "All-time reporting has no equivalent prior period." };
  }
  if (range.preset === "today") {
    return { range: null, reason: "Today is in progress, so it is not automatically compared with a completed day." };
  }
  const [fromYear, fromMonth, fromDay] = range.localFrom.split("-").map(Number);
  const [toYear, toMonth, toDay] = range.localTo.split("-").map(Number);
  const periodDays = Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000) + 1;
  const previousTo = addCalendarDays(range.localFrom, -1);
  const previousFrom = addCalendarDays(previousTo, -(periodDays - 1));
  return {
    range: dateRangeForLabels("custom", previousFrom, previousTo, range.timezone),
    reason: null,
  };
}

export function normalizeReportingCurrency(value: string | undefined): string | null {
  const currency = value?.trim().toUpperCase() || "";
  return CURRENCY_PATTERN.test(currency) ? currency : null;
}

export function getGrowthCockpitConfig(readEnv: (name: string) => string = name => process.env[name] || ""): GrowthCockpitConfig {
  const reportingTimezone = assertTimezone(readEnv("REPORTING_TIMEZONE") || DEFAULT_REPORTING_TIMEZONE);
  const reportingCurrency = normalizeReportingCurrency(readEnv("REPORTING_CURRENCY"));
  return {
    reportingTimezone,
    reportingCurrency,
    reportingCurrencyConfigured: Boolean(reportingCurrency),
    access: {
      data: { mechanism: "SHOPIFY_SESSION_TOKEN", enforced: true },
      document: { mechanism: "SHOPIFY_SESSION_TOKEN", enforced: true, shell: "NOINDEX_STATIC_SHELL", releaseBlocked: false },
      requiredBeforeProduction: "CLOUDFLARE_ACCESS_OR_SERVER_ADMIN_SESSION",
    },
    sources: {
      revenue: "SHOPIFY",
      orders: "SHOPIFY",
      popupEvents: "D1",
      metaSpend: readEnv("META_AD_ACCOUNT_ID") && readEnv("META_ACCESS_TOKEN") ? "META_ADS_API" : "NOT_CONFIGURED",
      cjCosts: "CJ_COST_LEDGER",
      paymentFees: "SHOPIFY_TRANSACTION_FEES",
    },
  };
}
