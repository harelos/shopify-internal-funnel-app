/**
 * Minimal Shopify OAuth handler.
 *
 * Exists for one reason: a function-only Shopify app has no backend, so it can
 * never complete the OAuth callback and therefore never receives an app-owned
 * Admin API token. Without that token `cartTransformCreate` is impossible,
 * because Shopify requires the call to come from the app that owns the function.
 *
 * This service is disposable. Delete it once the token has been captured.
 * No dependencies - node:http only.
 */

import http from "node:http";
import crypto from "node:crypto";

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SHOPIFY_API_KEY || "";
const API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SCOPES = process.env.SHOPIFY_SCOPES || "read_orders,read_products,read_cart_transforms,write_cart_transforms";
const APP_URL = process.env.APP_URL || "";

const SHOP_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

function html(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.25rem;background:#0f1115;color:#e6e8eb}
code{background:#1b1f27;padding:.15rem .4rem;border-radius:4px;word-break:break-all}
.tok{display:block;background:#10261a;border:1px solid #2f6b45;padding:1rem;border-radius:8px;font:14px ui-monospace,monospace;margin:1rem 0}
a{color:#7cc7ff}</style>${body}`);
}

/** Shopify signs callback params with the app secret; reject anything unsigned. */
function verifyHmac(query) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("&");
  const digest = crypto.createHmac("sha256", API_SECRET).update(message).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(String(hmac), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const q = Object.fromEntries(url.searchParams);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, configured: Boolean(API_KEY && API_SECRET && APP_URL) }));
  }

  // Start install: /auth?shop=novahair-dev.myshopify.com
  if (url.pathname === "/auth") {
    const shop = String(q.shop || "");
    if (!SHOP_RE.test(shop)) return html(res, 400, "<h1>Bad shop</h1><p>Pass <code>?shop=your-store.myshopify.com</code></p>");
    if (!API_KEY || !APP_URL) return html(res, 500, "<h1>Not configured</h1><p>SHOPIFY_API_KEY / APP_URL missing.</p>");
    const state = crypto.randomBytes(16).toString("hex");
    const redirect = `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(API_KEY)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(`${APP_URL}/auth/callback`)}` +
      `&state=${state}`;
    res.writeHead(302, { Location: redirect });
    return res.end();
  }

  // OAuth callback: exchange the code for a permanent Admin API token.
  if (url.pathname === "/auth/callback") {
    const shop = String(q.shop || "");
    if (!SHOP_RE.test(shop)) return html(res, 400, "<h1>Bad shop</h1>");
    if (!verifyHmac(q)) return html(res, 401, "<h1>Invalid HMAC</h1><p>Request was not signed by Shopify.</p>");
    if (!q.code) return html(res, 400, "<h1>No code</h1>");

    try {
      const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: API_KEY, client_secret: API_SECRET, code: q.code }),
      });
      const data = await r.json();
      if (!data.access_token) {
        return html(res, 502, `<h1>Exchange failed</h1><pre>${JSON.stringify(data, null, 2)}</pre>`);
      }
      console.log(`[TOKEN] shop=${shop} scopes=${data.scope}`);
      console.log(`[TOKEN] ${data.access_token}`);
      return html(res, 200, `<h1>Installed</h1><p>App-owned Admin API token for <code>${shop}</code>:</p>
<span class="tok">${data.access_token}</span>
<p>Scopes: <code>${data.scope || ""}</code></p>
<p>Copy this into the chat, then this service can be deleted.</p>`);
    } catch (e) {
      return html(res, 500, `<h1>Error</h1><pre>${String(e)}</pre>`);
    }
  }

  html(res, 200, `<h1>NovaHair OAuth helper</h1>
<p>Temporary. Captures an app-owned Shopify Admin token so the cart transform can be registered.</p>
<p>Start: <a href="/auth?shop=novahair-dev.myshopify.com">/auth?shop=novahair-dev.myshopify.com</a></p>
<p>Configured: <code>${Boolean(API_KEY && API_SECRET && APP_URL)}</code></p>`);
});

server.listen(PORT, () => console.log(`oauth-helper listening on ${PORT}`));
