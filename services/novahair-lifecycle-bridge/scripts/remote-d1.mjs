// A D1 binding that speaks to the Cloudflare D1 HTTP API, so the real
// campaign code can be driven against production from a workstation without
// handing out the Worker's admin token.
//
// Read-write. Use deliberately.

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "0027b85e1def200db0607ba57a01e86a";
const DATABASE = process.env.LIFECYCLE_D1_DATABASE_ID ?? "3b3d2e40-28b3-456f-9109-2607fbc51b17";
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`;

async function execute(sql, params, token) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const body = await response.json();
  if (!body.success) throw new Error(`d1_error ${JSON.stringify(body.errors)} for ${sql.slice(0, 120)}`);
  return body.result[0];
}

export function remoteD1(token = process.env.CF_TOKEN) {
  if (!token) throw new Error("CF_TOKEN missing");
  const prepare = (sql) => {
    const bound = [];
    const statement = {
      sql,
      params: bound,
      bind(...params) {
        const next = prepare(sql);
        next.params.push(...params);
        return next;
      },
      async first(column) {
        const result = await execute(sql, statement.params, token);
        const row = result.results?.[0] ?? null;
        if (!row) return null;
        return column === undefined ? row : row[column];
      },
      async all() {
        const result = await execute(sql, statement.params, token);
        return { results: result.results ?? [], success: true, meta: result.meta ?? {} };
      },
      async run() {
        const result = await execute(sql, statement.params, token);
        return { success: true, meta: result.meta ?? {} };
      },
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements) {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  };
}

export function productionEnv(token = process.env.CF_TOKEN, overrides = {}) {
  return {
    DB: remoteD1(token),
    APP_URL: "https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev",
    SHOP_DOMAIN: "jacobfelipe.myshopify.com",
    SHOPIFY_STOREFRONT_DOMAIN: "tigerbrandsglobal.com",
    SHOPIFY_API_VERSION: "2026-07",
    LIFECYCLE_MODE: "production",
    LIFECYCLE_ENABLED: "true",
    LIFECYCLE_ACTIVATED_AT: "2026-09-08T19:01:36.122Z",
    // Only needed for hashing/encryption in code paths this script does not
    // take; the Worker holds the real values.
    LIFECYCLE_DATA_KEY: process.env.LIFECYCLE_DATA_KEY ?? "",
    LIFECYCLE_HASH_KEY: process.env.LIFECYCLE_HASH_KEY ?? "",
    ...overrides,
  };
}
