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

  async orderFinancialSummary(input: {
    from?: string | null;
    toExclusive?: string | null;
    sessionToken?: string;
    now?: Date;
    maxPages?: number;
  }) {
    type OrderNode = {
      id: string;
      processedAt: string;
      test: boolean;
      cancelledAt: string | null;
      displayFinancialStatus: string | null;
      netPaymentSet: { shopMoney: { amount: string; currencyCode: string } };
      transactions: Array<{
        kind: string;
        status: string;
        fees: Array<{
          amount: { amount: string; currencyCode: string };
          taxAmount: { amount: string; currencyCode: string };
        }>;
      }>;
    };
    type OrdersPage = {
      orders: {
        nodes: OrderNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };

    const clauses = ["test:false"];
    if (input.from) clauses.push(`processed_at:>='${input.from}'`);
    if (input.toExclusive) clauses.push(`processed_at:<'${input.toExclusive}'`);
    const searchQuery = clauses.join(" ");
    const maxPages = Math.max(1, Math.min(input.maxPages ?? 20, 50));
    const nodes: OrderNode[] = [];
    let cursor: string | null = null;
    let hasNextPage = false;

    for (let page = 0; page < maxPages; page += 1) {
      const data: OrdersPage = await this.graphql<OrdersPage>(`query GrowthCockpitOrders($after: String, $query: String!) {
        orders(first: 100, after: $after, query: $query, sortKey: PROCESSED_AT) {
          nodes {
            id
            processedAt
            test
            cancelledAt
            displayFinancialStatus
            netPaymentSet { shopMoney { amount currencyCode } }
            transactions {
              kind
              status
              fees {
                amount { amount currencyCode }
                taxAmount { amount currencyCode }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`, { after: cursor, query: searchQuery }, input.sessionToken);
      nodes.push(...data.orders.nodes);
      hasNextPage = data.orders.pageInfo.hasNextPage;
      cursor = data.orders.pageInfo.endCursor;
      if (!hasNextPage || !cursor) break;
    }

    const currencies = [...new Set(nodes.map(order => order.netPaymentSet.shopMoney.currencyCode.toUpperCase()))];
    const netPayments = nodes.reduce((sum, order) => sum + Number(order.netPaymentSet.shopMoney.amount || 0), 0);
    const paidOrders = nodes.filter(order => Number(order.netPaymentSet.shopMoney.amount || 0) > 0).length;
    const successfulSaleOrders = nodes.filter(order => order.transactions.some(transaction => transaction.kind === "SALE" && transaction.status === "SUCCESS"));
    const feeRows = successfulSaleOrders.reduce((sum, order) => sum + order.transactions.reduce((transactionSum, transaction) => {
      if (transaction.kind !== "SALE" || transaction.status !== "SUCCESS") return transactionSum;
      return transactionSum + transaction.fees.length;
    }, 0), 0);
    const feeCurrencies = [...new Set(successfulSaleOrders.flatMap(order => order.transactions
      .filter(transaction => transaction.kind === "SALE" && transaction.status === "SUCCESS")
      .flatMap(transaction => transaction.fees.map(fee => fee.amount.currencyCode.toUpperCase()))))];
    const feeOrders = successfulSaleOrders.filter(order => order.transactions.some(transaction => transaction.kind === "SALE" && transaction.status === "SUCCESS" && transaction.fees.length > 0)).length;
    const paymentFeesAmount = successfulSaleOrders.reduce((sum, order) => sum + order.transactions.reduce((transactionSum, transaction) => {
      if (transaction.kind !== "SALE" || transaction.status !== "SUCCESS") return transactionSum;
      return transactionSum + transaction.fees.reduce((feeSum, fee) => feeSum + Number(fee.amount.amount || 0) + Number(fee.taxAmount.amount || 0), 0);
    }, 0), 0);
    const now = input.now ?? new Date();
    const accessibleFrom = new Date(now.getTime() - 60 * 86400000);
    const rangeWithinDefaultOrderWindow = Boolean(input.from) && new Date(input.from as string) >= accessibleFrom;
    const complete = rangeWithinDefaultOrderWindow && !hasNextPage && currencies.length <= 1;

    return {
      source: "SHOPIFY_ADMIN_ORDERS",
      rows: nodes.length,
      orders: paidOrders,
      amount: currencies.length <= 1 ? Number(netPayments.toFixed(2)) : null,
      currency: currencies.length === 1 ? currencies[0] : null,
      quality: complete ? "ACTUAL" as const : "PARTIAL" as const,
      truncated: hasNextPage,
      rangeWithinDefaultOrderWindow,
      definition: "Sum of Shopify Order.netPaymentSet.shopMoney after refunds; includes amounts collected for tax and shipping.",
      paymentFees: feeRows > 0 && feeCurrencies.length <= 1
        ? {
            amount: Number(paymentFeesAmount.toFixed(2)),
            currency: feeCurrencies[0] ?? null,
            quality: feeOrders === successfulSaleOrders.length ? "ACTUAL" as const : "PARTIAL" as const,
            source: "SHOPIFY_TRANSACTION_FEES",
            rows: feeRows,
            definition: "Sum of successful SALE transaction fees and fee tax amounts returned by Shopify Payments.",
          }
        : null,
    };
  }
}
