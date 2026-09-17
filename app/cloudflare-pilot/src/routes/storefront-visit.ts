import { Router } from "express";
import prisma from "../lib/db.js";
import { createEventOnce } from "../lib/event-store.js";
import { resolveBrowserVisitor } from "../services/element-attribution.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { looksLikeBot, requestLimited } from "../lib/request-limit.js";

/**
 * Records that a browser looked at the storefront.
 *
 * Conversion is measured as tracked visitors who ordered, divided by tracked
 * visitors — and "tracked" means the app recorded an event for them. Tagging
 * the cart was enough to link an order to a visitor, but that visitor had no
 * event, so it fell outside the denominator and the rate stayed unmeasurable
 * no matter how many orders linked.
 *
 * Reached through the Shopify app proxy, so the request is signature-verified
 * before it arrives here. It stores an anonymous key and a path; no customer
 * identity, no page contents.
 */
const router = Router();

function text(value: unknown, max: number): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "";
}

router.post("/visit", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const visitorKey = text(req.body?.visitorId, 200);
    if (visitorKey.length < 8) return res.status(400).json({ ok: false, error: "A valid anonymous visitor id is required." });
    // Conversion divides buyers by tracked visitors, so anything that can move
    // the denominator has to be bounded and free of robots.
    if (looksLikeBot(req.get("user-agent"))) return res.json({ ok: true, ignored: "automated_client" });
    if (requestLimited(req, "storefront_visit", 60, 60_000)) return res.status(429).json({ ok: false, error: "Too many requests." });

    const shopDomain = workerEnvValue("SHOP_DOMAIN").toLowerCase();
    const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
    if (!shop) return res.status(503).json({ ok: false, error: "Shop is not configured." });

    // The same resolver the order path uses, so a buyer is one visitor row and
    // not two that never intersect.
    const visitor = await resolveBrowserVisitor(shop.id, visitorKey);
    if (!visitor) return res.status(400).json({ ok: false, error: "The anonymous visitor id was rejected." });

    const path = text(req.body?.path, 160) || "/";
    // One view per visitor, per path, per minute: a re-assert or a fast
    // back-and-forth must not inflate the denominator.
    const minuteBucket = Math.floor(Date.now() / 60000);
    const eventKey = `storefront_view:${visitor.id}:${path}:${minuteBucket}`;
    const isInternal = req.body?.isInternal === true;

    const result = await createEventOnce(eventKey, {
      shopId: shop.id,
      eventKey,
      name: "page_view",
      source: "STOREFRONT",
      occurredAt: new Date(),
      visitorId: visitor.id,
      utmSource: text(req.body?.utmSource, 50) || "organic",
      utmMedium: text(req.body?.utmMedium, 50) || null,
      utmCampaign: text(req.body?.utmCampaign, 100) || null,
      payload: JSON.stringify({ path, referrerHost: text(req.body?.referrerHost, 100) || null }),
      isTest: isInternal,
    });

    return res.json({ ok: true, duplicate: result.duplicate });
  } catch (error: any) {
    console.error(JSON.stringify({ message: "storefront_visit_failed", error: String(error?.message || error).slice(0, 200) }));
    return res.status(500).json({ ok: false });
  }
});

export default router;
