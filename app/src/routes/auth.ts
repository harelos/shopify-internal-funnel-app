import { Router } from "express";

const router = Router();

/**
 * This legacy route is intentionally disabled. Embedded Shopify apps use
 * Shopify-managed installation, App Bridge session tokens, and token exchange.
 * Admin-created custom apps use a server-side access token and cannot be
 * embedded in Shopify Admin.
 */
router.get("/auth", (_req, res) => {
  res.status(410).json({
    error: "Legacy OAuth is disabled.",
    next: "Use a Dev Dashboard Custom Distribution app for embedded Admin, or configure SHOPIFY_ACCESS_TOKEN for an Admin-created app.",
  });
});

router.get("/auth/callback", (_req, res) => {
  res.status(410).json({
    error: "The legacy OAuth callback is disabled. No access token is written to disk.",
  });
});

export default router;

