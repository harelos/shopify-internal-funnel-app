import { getShopifyConfig, isValidShopDomain, workerEnvValue } from "./shopify-config.js";

export class ShopifyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyConfigurationError";
  }
}

export class ShopifyAdminClient {
  private readonly exchangedTokens = new Map<string, { token: string; expiresAt: number }>();

  private async exchangeSessionToken(sessionToken: string): Promise<string> {
    const config = getShopifyConfig();
    const clientSecret = workerEnvValue("SHOPIFY_CLIENT_SECRET");
    if (!config.clientId || !clientSecret || !isValidShopDomain(config.shopDomain)) {
      throw new ShopifyConfigurationError("SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET are required for token exchange.");
    }

    const cached = this.exchangedTokens.get(config.shopDomain);
    if (cached && cached.expiresAt > Date.now() + 30000) return cached.token;

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: config.clientId,
      client_secret: clientSecret,
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
    if (config.hasAccessToken) {
      return workerEnvValue("SHOPIFY_ADMIN_ACCESS_TOKEN") || workerEnvValue("SHOPIFY_ACCESS_TOKEN");
    }
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

    const response = await fetch(`https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Shopify Admin API returned HTTP ${response.status}.`);
    }

    const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
    if (payload.errors?.length) {
      throw new Error(`Shopify Admin API GraphQL error: ${payload.errors[0]?.message ?? "unknown error"}`);
    }
    if (!payload.data) throw new Error("Shopify Admin API returned no data.");
    return payload.data;
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

  async findPopupLeadByTag(verificationTag: string, sessionToken?: string) {
    return this.graphql<{
      customers: {
        nodes: Array<{
          id: string;
          tags: string[];
          emailMarketingConsent: { marketingState: string } | null;
        }>;
      };
    }>(`query PopupLead($query: String!) {
      customers(first: 5, query: $query) {
        nodes { id tags emailMarketingConsent { marketingState } }
      }
    }`, { query: `tag:\"${verificationTag}\"` }, sessionToken);
  }

  async shopifyqlQuery(queryText: string, sessionToken?: string) {
    return this.graphql<{
      shopifyqlQuery: {
        tableData?: {
          columns?: Array<{ name: string; dataType: string; displayName?: string }>;
          rows?: Array<Record<string, string | number | null>>;
        };
        parseErrors?: string[];
      };
    }>(`query ShopifyAnalytics($query: String!) {
      shopifyqlQuery(query: $query) {
        tableData { columns { name dataType } rowData }
        parseErrors { code message }
      }
    }`, { query: queryText }, sessionToken);
  }
}
