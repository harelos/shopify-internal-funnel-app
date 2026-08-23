export interface BotModelConfigDraft {
  provider?: string;
  model: string;
  trafficPct: number;
}

export interface BotConfigurationDraft {
  version: number;
  identity: {
    name: string;
    label: string;
    welcome: string;
    placement: string;
  };
  routing: {
    support: boolean;
    retention: boolean;
    risk: boolean;
  };
  playbook: {
    stages: string;
    methods: string;
  };
  offers: {
    firstPct: number;
    secondPct: number;
    maxPct: number;
    firstMinMessages: number;
    secondMinMessages: number;
    marginFloorIls: number | null;
  };
  models: BotModelConfigDraft[];
  crm: {
    progressive: boolean;
    email: boolean;
    phone: boolean;
  };
  security: {
    messagesPer5m: number;
    messagesPerHour: number;
    maxUserChars: number;
  };
}

export interface BotConfigValidationResult {
  ok: boolean;
  errors: string[];
  config?: BotConfigurationDraft;
}

const DEFAULT_STAGES = "DISCOVER,QUALIFY,RECOMMEND,OBJECTION,OFFER,CLOSE,FOLLOW_UP";
const DEFAULT_METHODS = "SPIN; truthful influence principles; benefit/proof framing; objection handling; clear CTA";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asNullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, Math.round(asFiniteNumber(value, fallback))));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, asFiniteNumber(value, fallback)));
}

export function defaultBotConfigurationDraft(): BotConfigurationDraft {
  return {
    version: 1,
    identity: {
      name: "TIGER Sales Assistant",
      label: "Digital sales assistant",
      welcome: "מה תרצי לדעת לפני שאת מחליטה?",
      placement: "all-funnels",
    },
    routing: { support: true, retention: true, risk: true },
    playbook: { stages: DEFAULT_STAGES, methods: DEFAULT_METHODS },
    offers: {
      firstPct: 5,
      secondPct: 10,
      maxPct: 10,
      firstMinMessages: 3,
      secondMinMessages: 5,
      marginFloorIls: null,
    },
    models: [
      { provider: "openai", model: "gpt", trafficPct: 100 },
    ],
    crm: { progressive: true, email: true, phone: true },
    security: { messagesPer5m: 20, messagesPerHour: 80, maxUserChars: 2000 },
  };
}

export function normalizeAndValidateBotConfiguration(input: unknown): BotConfigValidationResult {
  const source = input && typeof input === "object" ? input as Record<string, any> : {};
  const defaults = defaultBotConfigurationDraft();
  const identity = source.identity && typeof source.identity === "object" ? source.identity : {};
  const routing = source.routing && typeof source.routing === "object" ? source.routing : {};
  const playbook = source.playbook && typeof source.playbook === "object" ? source.playbook : {};
  const offers = source.offers && typeof source.offers === "object" ? source.offers : {};
  const crm = source.crm && typeof source.crm === "object" ? source.crm : {};
  const security = source.security && typeof source.security === "object" ? source.security : {};
  const rawModels = Array.isArray(source.models) ? source.models : defaults.models;

  const models = rawModels
    .slice(0, 12)
    .map((item: any) => ({
      provider: asString(item?.provider || item?.model?.split?.(":")?.[0], "custom"),
      model: asString(item?.model),
      trafficPct: clampNumber(item?.trafficPct, 0, 100, 0),
    }))
    .filter((item: BotModelConfigDraft) => item.model.length > 0);

  const config: BotConfigurationDraft = {
    version: 1,
    identity: {
      name: asString(identity.name, defaults.identity.name).slice(0, 80),
      label: asString(identity.label, defaults.identity.label).slice(0, 120),
      welcome: asString(identity.welcome, defaults.identity.welcome).slice(0, 500),
      placement: asString(identity.placement, defaults.identity.placement).slice(0, 80),
    },
    routing: {
      support: asBoolean(routing.support, true),
      retention: asBoolean(routing.retention, true),
      risk: asBoolean(routing.risk, true),
    },
    playbook: {
      stages: asString(playbook.stages, defaults.playbook.stages).slice(0, 500),
      methods: asString(playbook.methods, defaults.playbook.methods).slice(0, 2000),
    },
    offers: {
      firstPct: clampNumber(offers.firstPct, 0, 100, defaults.offers.firstPct),
      secondPct: clampNumber(offers.secondPct, 0, 100, defaults.offers.secondPct),
      maxPct: clampNumber(offers.maxPct, 0, 100, defaults.offers.maxPct),
      firstMinMessages: clampInt(offers.firstMinMessages, 0, 50, defaults.offers.firstMinMessages),
      secondMinMessages: clampInt(offers.secondMinMessages, 0, 50, defaults.offers.secondMinMessages),
      marginFloorIls: asNullableFiniteNumber(offers.marginFloorIls),
    },
    models,
    crm: {
      progressive: asBoolean(crm.progressive, true),
      email: asBoolean(crm.email, true),
      phone: asBoolean(crm.phone, true),
    },
    security: {
      messagesPer5m: clampInt(security.messagesPer5m, 1, 500, defaults.security.messagesPer5m),
      messagesPerHour: clampInt(security.messagesPerHour, 1, 5000, defaults.security.messagesPerHour),
      maxUserChars: clampInt(security.maxUserChars, 100, 20000, defaults.security.maxUserChars),
    },
  };

  const errors: string[] = [];
  if (!config.identity.name) errors.push("Assistant name is required.");
  if (!config.identity.label) errors.push("Transparent assistant label is required.");
  if (!models.length) errors.push("At least one model is required.");
  const trafficTotal = Number(models.reduce((sum, item) => sum + item.trafficPct, 0).toFixed(4));
  if (trafficTotal !== 100) errors.push("Model traffic allocation must total exactly 100%.");
  if (config.offers.firstPct > config.offers.maxPct) errors.push("First discount tier cannot exceed the maximum discount.");
  if (config.offers.secondPct > config.offers.maxPct) errors.push("Second discount tier cannot exceed the maximum discount.");
  if (config.offers.secondPct < config.offers.firstPct) errors.push("Second discount tier cannot be lower than the first discount tier.");
  if (config.offers.secondMinMessages < config.offers.firstMinMessages) errors.push("Second discount tier cannot unlock before the first tier.");
  if (config.offers.marginFloorIls != null && config.offers.marginFloorIls < 0) errors.push("Margin floor cannot be negative.");
  if (config.security.messagesPerHour < config.security.messagesPer5m) errors.push("Hourly message allowance cannot be lower than the 5-minute allowance.");

  return errors.length ? { ok: false, errors } : { ok: true, errors: [], config };
}
