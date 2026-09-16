import { Router } from "express";
import { requireShopifySession } from "../middleware/shopify-auth.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { getShipmentStatus } from "../lib/cj-tracking-store.js";
import type { ShipmentStatus } from "../lib/cj-tracking.js";

/**
 * The storefront "where is my package" page, served through the app proxy at
 * /apps/funnels/track.
 *
 * The header used to send customers to a third-party tracking widget that
 * looked up the Shopify tracking number on its own and showed either nothing
 * or a stale scan, while CJ's feed already showed the parcel released from
 * Israeli customs. This page reads CJ's events directly, so what the customer
 * sees is what the warehouse and the support desk see.
 */
const router = Router();
const shopify = new ShopifyAdminClient();

const STAGE_STEPS: Array<{ key: string; label: string; from: number }> = [
  { key: "packed", label: "נארזה במחסן", from: 1 },
  { key: "left", label: "יצאה לדרך", from: 2 },
  { key: "flight", label: "בטיסה לישראל", from: 4 },
  { key: "israel", label: "הגיעה לישראל", from: 5 },
  { key: "customs", label: "שוחררה מהמכס", from: 7 },
  { key: "lastmile", label: "בדרך אלייך", from: 8 },
  { key: "done", label: "נמסרה", from: 10 },
];

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function contactMatches(order: any, email: string, phone: string): boolean {
  const known = [order?.email, order?.customer?.email].map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
  if (email && known.includes(email)) return true;
  const knownPhones = [order?.phone, order?.customer?.phone, order?.shippingAddress?.phone].map(digits).filter(v => v.length >= 7);
  const given = digits(phone);
  if (given.length >= 7 && knownPhones.some(p => p.endsWith(given.slice(-7)))) return true;
  return false;
}

function page(body: string, title = "מעקב אחר החבילה"): string {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} · TigerBrandsGlobal</title>
<style>
:root{--ink:#1f1a17;--muted:#6b625c;--line:#e8e1db;--accent:#1b7a5a;--bg:#faf7f4;--card:#fff;--warn:#b8541c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans Hebrew",sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:28px 18px 60px}h1{font-size:26px;margin:0 0 6px}p.lead{color:var(--muted);margin:0 0 22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px}
label{display:block;font-weight:600;margin:12px 0 6px}input{width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:12px;font-size:16px;background:#fff}
button{width:100%;margin-top:16px;padding:14px;border:0;border-radius:12px;background:var(--accent);color:#fff;font-size:17px;font-weight:700;cursor:pointer}
.status{font-size:20px;font-weight:700;margin:0 0 6px}.next{color:var(--muted);margin:0 0 14px}
.steps{display:flex;gap:4px;margin:14px 0 18px}.steps span{flex:1;height:8px;border-radius:6px;background:var(--line)}.steps span.on{background:var(--accent)}
.steplabels{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin:-10px 0 16px}
.timeline{list-style:none;margin:0;padding:0;border-inline-start:2px solid var(--line)}.timeline li{position:relative;padding:0 16px 12px 0;color:var(--muted);font-size:14px}
.timeline li:before{content:"";position:absolute;inset-inline-start:-7px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--line)}.timeline li:first-child{color:var(--ink);font-weight:600}.timeline li:first-child:before{background:var(--accent)}
.meta{font-size:13px;color:var(--muted);margin-top:14px}.meta a{color:var(--accent)}.err{color:var(--warn);font-weight:600}
.help{font-size:14px;color:var(--muted)}.help a{color:var(--accent);font-weight:600}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

function form(prefill: { order?: string; email?: string; phone?: string }, error?: string): string {
  return `<h1>איפה החבילה שלי?</h1><p class="lead">הזיני את מספר ההזמנה ואת המייל או הטלפון שאיתם הזמנת, ונראה לך את הסריקה האחרונה של חברת המשלוחים.</p>
<div class="card"><form method="get" action="/apps/funnels/track">
${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<label for="order">מספר הזמנה</label><input id="order" name="order" inputmode="numeric" placeholder="למשל 4364" value="${escapeHtml(prefill.order || "")}" required>
<label for="email">מייל</label><input id="email" name="email" type="email" placeholder="המייל שאיתו הזמנת" value="${escapeHtml(prefill.email || "")}">
<label for="phone">או טלפון</label><input id="phone" name="phone" type="tel" placeholder="050-0000000" value="${escapeHtml(prefill.phone || "")}">
<button type="submit">הראי לי איפה החבילה</button></form></div>
<p class="help">מספר ההזמנה מופיע במייל האישור (למשל #4364). לא מוצאת? כתבי לנו ל-support@tigerbrandsglobal.com ונבדוק מיד.</p>`;
}

function statusCard(order: any, status: ShipmentStatus | null, trackingNumber: string | null): string {
  const orderName = escapeHtml(order.name);
  const first = escapeHtml(order.customer?.firstName || "");
  const items = (order.lineItems?.nodes || []).map((n: any) => escapeHtml(n.variantTitle ? `${n.name} · ${n.variantTitle}` : n.name)).slice(0, 4).join("<br>");
  if (order.cancelledAt) return `<div class="card"><p class="status">ההזמנה ${orderName} בוטלה</p><p class="next">אם זה לא מה שציפית לו, כתבי לנו ונבדוק.</p></div>`;
  if (!trackingNumber) {
    return `<div class="card"><p class="status">${first ? `${first}, ` : ""}הזמנה ${orderName} נקלטה ונארזת</p>
<p class="next">עדיין לא נוצר מספר מעקב. בדרך כלל החבילה יוצאת מהמחסן תוך 2–4 ימי עסקים ואז יופיעו כאן הסריקות.</p>
<div class="meta">${items}</div></div>`;
  }
  if (!status) {
    return `<div class="card"><p class="status">הזמנה ${orderName} בדרך</p><p class="next">חברת המשלוחים לא החזירה כרגע סריקות. נסי שוב בעוד כמה דקות.</p>
<div class="meta">מספר מעקב: ${escapeHtml(trackingNumber)} · <a href="https://t.17track.net/en#nums=${encodeURIComponent(trackingNumber)}" rel="noopener" target="_blank">17TRACK</a></div></div>`;
  }
  const steps = STAGE_STEPS.map(step => `<span class="${status.progress >= step.from ? "on" : ""}"></span>`).join("");
  const labels = STAGE_STEPS.map(step => `<i>${step.label}</i>`).join("");
  const timeline = status.timelineHe.map(row => `<li>${escapeHtml(row.text)}</li>`).join("");
  return `<div class="card">
<p class="status">${first ? `${first}, ` : ""}${escapeHtml(status.statusHe)}</p>
<p class="next">${escapeHtml(status.nextStepHe)}</p>
<div class="steps">${steps}</div><div class="steplabels">${labels}</div>
<ul class="timeline">${timeline || "<li>אין עדיין סריקות</li>"}</ul>
<div class="meta">הזמנה ${orderName} · מספר מעקב ${escapeHtml(status.cjMailNo || trackingNumber)} · <a href="${escapeHtml(status.trackUrl)}" rel="noopener" target="_blank">לצפייה באתר חברת המשלוחים</a><br>${items}</div>
</div>
<p class="help">משהו לא מסתדר? כתבי לנו ל-<a href="mailto:support@tigerbrandsglobal.com">support@tigerbrandsglobal.com</a> עם מספר ההזמנה ונטפל בזה.</p>`;
}

router.get("/track", requireShopifySession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const orderInput = String(req.query.order || "").trim();
  const email = String(req.query.email || "").trim().toLowerCase();
  const phone = String(req.query.phone || "").trim();
  if (!orderInput) return res.send(page(form({})));
  if (!email && digits(phone).length < 7) return res.send(page(form({ order: orderInput }, "צריך גם מייל או טלפון כדי לאמת שההזמנה שלך.")));
  try {
    const order = await shopify.orderForTracking(orderInput);
    if (!order || !contactMatches(order, email, phone)) {
      return res.send(page(form({ order: orderInput, email, phone }, "לא מצאנו הזמנה כזו עם המייל או הטלפון האלה. בדקי את מספר ההזמנה במייל האישור.")));
    }
    const trackingNumber = (order.fulfillments || []).flatMap((f: any) => f.trackingInfo || []).map((t: any) => String(t?.number || "").trim()).find(Boolean) || null;
    const status = trackingNumber ? await getShipmentStatus(trackingNumber) : null;
    return res.send(page(`<h1>מעקב אחר החבילה</h1>${statusCard(order, status, trackingNumber)}`));
  } catch (error: any) {
    console.error(JSON.stringify({ message: "track_page_lookup_failed", order: orderInput, error: error?.message || String(error) }));
    return res.status(200).send(page(form({ order: orderInput, email, phone }, "לא הצלחנו לבדוק כרגע. נסי שוב בעוד דקה.")));
  }
});

export default router;
