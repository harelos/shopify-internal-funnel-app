import { getShopifyConfig, isValidShopDomain } from "./shopify-config.js";

export class ShopifyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyConfigurationError";
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, retryAfterHeader?: string | null, throttleStatus?: { currentlyAvailable?: number; restoreRate?: number }) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(10_000, retryAfter * 1000);
  const available = Number(throttleStatus?.currentlyAvailable);
  const restoreRate = Number(throttleStatus?.restoreRate);
  if (Number.isFinite(available) && Number.isFinite(restoreRate) && restoreRate > 0 && available < 50) {
    return Math.min(10_000, Math.max(250, Math.ceil(((50 - available) / restoreRate) * 1000)));
  }
  return Math.min(5000, 300 * (2 ** attempt) + Math.floor(Math.random() * 250));
}

export class ShopifyAdminClient {
  private readonly exchangedTokens = new Map<string, { token: string; expiresAt: number }>();

  private async exchangeSessionToken(sessionToken: string): Promise<string> {
    const config = getShopifyConfig();
    if (!config.clientId || !process.env.SHOPIFY_CLIENT_SECRET || !isValidShopDomain(config.shopDomain)) {
      throw new ShopifyConfigurationError("SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET are required for token exchange.");
    }

    const cached = this.exchangedTokens.get(config.shopDomain);
    if (cached && cached.expiresAt > Date.now() + 30000) return cached.token;

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: config.clientId,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      subject_token: sessionToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: "urn:shopify:params:oauth:token-type:online-access-token",
    });
    const response = await fetch(`https://${config.shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Shopify token exchange returned HTTP ${response.status}.`);

    const payload = await response.json() as { access_token?: string; expires_in?: number };
    if (!payload.access_token) throw new Error("Shopify token exchange returned no access token.");
    this.exchangedTokens.set(config.shopDomain, {
      token: payload.access_token,
      expiresAt: Date.now() + Math.max(60000, (payload.expires_in ?? 3600) * 1000),
    });
    return payload.access_token;
  }

  private async resolveAccessToken(sessionToken?: string): Promise<string> {
    const config = getShopifyConfig();
    if (sessionToken) return this.exchangeSessionToken(sessionToken);
    if (config.hasAccessToken) return process.env.SHOPIFY_ACCESS_TOKEN as string;
    throw new ShopifyConfigurationError("A Shopify session token or rotated SHOPIFY_ACCESS_TOKEN is required.");
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}, sessionToken?: string): Promise<T> {
    const config = getShopifyConfig();
    if (!config.liveConnect) {
      throw new ShopifyConfigurationError("Live Shopify connection is disabled. Set SHOPIFY_LIVE_CONNECT=true only after rotating credentials.");
    }
    if (!isValidShopDomain(config.shopDomain)) {
      throw new ShopifyConfigurationError("SHOP_DOMAIN must be a valid myshopify.com domain.");
    }
    const accessToken = await this.resolveAccessToken(sessionToken);
    const endpoint = `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(12000),
        });
      } catch {
        lastError = new Error("Shopify Admin API network request failed.");
        if (attempt < 2) {
          await sleep(retryDelayMs(attempt));
          continue;
        }
        throw lastError;
      }

      const raw = await response.text();
      let payload: {
        data?: T;
        errors?: Array<{ message?: string; extensions?: { code?: string } }>;
        extensions?: { cost?: { throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
      } = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }

      const throttled = payload.errors?.some(error => error.extensions?.code === "THROTTLED") || response.status === 429;
      const retryableHttp = response.status >= 500;
      if ((!response.ok && (throttled || retryableHttp)) || throttled) {
        lastError = new Error(throttled ? "Shopify Admin API request was throttled." : `Shopify Admin API returned HTTP ${response.status}.`);
        if (attempt < 2) {
          await sleep(retryDelayMs(attempt, response.headers.get("retry-after"), payload.extensions?.cost?.throttleStatus));
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        throw new Error(`Shopify Admin API returned HTTP ${response.status}.`);
      }
      if (payload.errors?.length) {
        throw new Error(`Shopify Admin API GraphQL error: ${payload.errors[0]?.message ?? "unknown error"}`);
      }
      if (!payload.data) throw new Error("Shopify Admin API returned no data.");
      return payload.data;
    }

    throw lastError || new Error("Shopify Admin API request failed.");
  }

  async storeSummary(sessionToken?: string) {
    return this.graphql<{
      shop: {
        name: string;
        myshopifyDomain: string;
        primaryDomain: { url: string } | null;
      };
    }>(`query StoreSummary { shop { name myshopifyDomain primaryDomain { url } } }`, {}, sessionToken);
  }

  async shopifyqlQuery(queryText: string, sessionToken?: string) {
    return this.graphql<{
      shopifyqlQuery: {
        tableData?: {
          columns?: Array<{ name: string; dataType: string; displayName?: string }>;
          rowData?: Array<Record<string, string | number | null>>;
        };
        parseErrors?: Array<{ code?: string; message?: string }>;
      };
    }>(`query ShopifyAnalytics($query: String!) {
      shopifyqlQuery(query: $query) {
        tableData { columns { name dataType } rowData }
        parseErrors { code message }
      }
    }`, { query: queryText }, sessionToken);
  }
}
