import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import prisma from "../lib/db.js";
import { renderSandboxDocument } from "../lib/portability.js";
import { selectVariant } from "../services/ab-engine.js";

const router = Router();

function routeBasePath(req: Request): string {
  const configuredProxyPath = String(req.query.path_prefix ?? process.env.SHOPIFY_APP_PROXY_PATH ?? "").replace(/\/+$/, "");
  if (configuredProxyPath) return configuredProxyPath.startsWith("/") ? configuredProxyPath : `/${configuredProxyPath}`;
  if (req.path.startsWith("/apps/funnels")) return "/apps/funnels";
  if (req.path.startsWith("/funnels")) return "/funnels";
  return "/f";
}

async function serveFunnelIndex(req: Request, res: Response, next: NextFunction) {
  if (!req.query.path_prefix && !req.query.signature && req.path === "/") return next();

  const funnel = await prisma.funnel.findFirst({
    where: { status: "PUBLISHED" },
    include: { steps: { orderBy: { position: "asc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });
  const firstStep = funnel?.steps[0];
  if (!funnel || !firstStep) return res.status(404).send("No published funnel found");
  return res.redirect(`${routeBasePath(req)}/${funnel.slug}/${firstStep.position}`);
}

// GET /preview/:versionId — Sandboxed HTML preview for variant content editor
router.get("/preview/:versionId", async (req, res) => {
  try {
    const version = await prisma.contentVersion.findUnique({
      where: { id: req.params.versionId },
    });

    if (!version) {
      return res.status(404).send("Version not found");
    }

    const html = renderSandboxDocument(version.normalizedHtml);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-same-origin; default-src 'self' 'unsafe-inline' data:;");
    res.send(html);
  } catch (err: any) {
    res.status(500).send("Preview Error: " + err.message);
  }
});

// GET /f/:funnelSlug/:stepPosition — Live Funnel Page Serving with A/B Traffic Splitter & Path Attribution Telemetry
async function serveFunnelPage(req: Request, res: Response) {
  try {
    const funnelSlug = String(req.params.funnelSlug ?? "");
    const stepPosition = String(req.params.stepPosition ?? "");
    const pos = parseInt(stepPosition, 10);

    const funnel = await prisma.funnel.findFirst({
      where: { slug: funnelSlug.toLowerCase(), status: "PUBLISHED" },
      include: {
        steps: {
          orderBy: { position: "asc" },
        },
      },
    });

    if (!funnel) {
      return res.status(404).send("Funnel not found");
    }

    const step = funnel.steps.find(s => s.position === pos);
    if (!step) {
      return res.status(404).send("Step not found");
    }

    // Checkout step redirect to Shopify checkout
    if (step.kind === "CHECKOUT") {
      const shopDomain = process.env.SHOP_DOMAIN || "local-dev.myshopify.com";
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Redirecting to Checkout...</title></head>
        <body style="font-family:sans-serif; text-align:center; padding:100px; background:#f5f1e8; color:#17231e;">
          <h2>Proceeding to Secure Shopify Checkout</h2>
          <p>You are being redirected to payment...</p>
          <a href="https://${shopDomain}/checkout" class="btn" style="display:inline-block; padding:12px 24px; background:#197b5b; color:white; text-decoration:none; border-radius:6px; font-weight:bold;">Continue to Checkout</a>
        </body>
        </html>
      `);
    }

    // Generate/retrieve pseudonymous visitor ID
    const visitorId = (req.headers["x-visitor-id"] as string) || req.query.vid as string || "v_" + Math.random().toString(36).substring(2, 10);

    // Run A/B variant selection algorithm
    const variantId = await selectVariant(step.id, visitorId);
    if (!variantId) {
      return res.status(404).send("No active variant found for this step");
    }

    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      include: {
        versions: {
          orderBy: { revision: "desc" },
          take: 1,
        },
      },
    });

    const contentVersion = variant?.versions[0];
    let pageHtml = contentVersion?.normalizedHtml || contentVersion?.rawHtml || `<main><h1>${step.name}</h1><p>No page content published yet.</p></main>`;

    // Next step navigation target
    const nextStep = funnel.steps.find(s => s.position === pos + 1);
    const basePath = routeBasePath(req);
    const nextStepUrl = nextStep ? `${basePath}/${funnel.slug}/${nextStep.position}` : `${basePath}/${funnel.slug}/${pos}`;

    // Downsell / decline step target (#down, #decline-upsell)
    const downsellStep = funnel.steps.find(s => s.position === pos + 2) || nextStep;
    const downsellUrl = downsellStep ? `${basePath}/${funnel.slug}/${downsellStep.position}` : nextStepUrl;

    const variantLabel = `${step.name} (${variant?.name || 'Main'})`;
    const trackingEndpoint = JSON.stringify(`${process.env.SHOPIFY_APP_PROXY_PATH || ""}/api/track`.replace(/^\/\/api/, "/api"));

    // Tracking pixel + CTA handler injection with UTM, Dwell Time, and #down link resolution
    const trackingPixelScript = `
      <script>
        (function() {
          var stepNodeName = "${variantLabel.replace(/"/g, '\\"')}";
          var pathKey = "_fpath_" + "${funnel.id}";
          var pathHistory = JSON.parse(sessionStorage.getItem(pathKey) || "[]");
          if (pathHistory.length === 0 || pathHistory[pathHistory.length - 1] !== stepNodeName) {
            pathHistory.push(stepNodeName);
            sessionStorage.setItem(pathKey, JSON.stringify(pathHistory));
          }

          var urlParams = new URLSearchParams(window.location.search);
          var utm_source = urlParams.get("utm_source") || (document.referrer.indexOf("facebook") >= 0 ? "facebook" : "organic");
          var utm_medium = urlParams.get("utm_medium") || "";
          var utm_campaign = urlParams.get("utm_campaign") || "";

          var t = {
            funnelId: "${funnel.id}",
            stepId: "${step.id}",
            variantId: "${variantId}",
            stepKind: "${step.kind}",
            nextStepUrl: "${nextStepUrl}",
            downsellUrl: "${downsellUrl}",
            pathFingerprint: pathHistory.join(" ➔ "),
            utm_source: utm_source,
            utm_medium: utm_medium,
            utm_campaign: utm_campaign
          };

          var vid = localStorage.getItem("_fv") || "${visitorId}";
          localStorage.setItem("_fv", vid);
          document.cookie = "_fv=" + encodeURIComponent(vid) + "; Path=/; SameSite=Lax";
          document.cookie = "_funnel_context=" + encodeURIComponent(JSON.stringify({
            shopDomain: "${(process.env.SHOP_DOMAIN || "").replace(/"/g, '\\"')}",
            visitorId: vid,
            funnelId: "${funnel.id}",
            stepId: "${step.id}",
            variantId: "${variantId}"
          })) + "; Path=/; SameSite=Lax";
          t.visitorId = vid;

          // Track page view event automatically
          fetch(${trackingEndpoint}, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "page_view", ...t })
          });

          // Expose CTA tracking helper
          window.__trackCta = function(ctaName, targetUrl) {
            fetch(${trackingEndpoint}, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event: "cta_click", ctaName: ctaName || "primary", ...t })
            }).then(function() {
              window.location.href = targetUrl || t.nextStepUrl;
            });
          };

          // Attach tracking & dynamic navigation to links and buttons
          document.addEventListener("DOMContentLoaded", function() {
            var links = document.querySelectorAll("a, button");
            links.forEach(function(el) {
              var href = el.getAttribute("href") || "";
              var action = el.getAttribute("data-action") || "";

              if (href === "#next-step" || action === "next-step" || href === "#" || !href) {
                el.addEventListener("click", function(e) {
                  e.preventDefault();
                  window.__trackCta(el.innerText || "next-step", t.nextStepUrl);
                });
              } else if (href === "#accept-upsell" || action === "accept-upsell") {
                el.addEventListener("click", function(e) {
                  e.preventDefault();
                  window.__trackCta("accept-upsell", t.nextStepUrl);
                });
              } else if (href === "#decline-upsell" || href === "#down" || action === "decline-upsell" || action === "down") {
                el.addEventListener("click", function(e) {
                  e.preventDefault();
                  window.__trackCta("decline-upsell", t.downsellUrl);
                });
              } else if (href === t.nextStepUrl || href === window.location.origin + t.nextStepUrl) {
                el.addEventListener("click", function(e) {
                  e.preventDefault();
                  window.__trackCta(el.innerText || "next-step", href);
                });
              } else if (/^\\/?products\\//i.test(href) || /^https?:\\/\\/tigerbrandsglobal\\.com\\/products\\//i.test(href)) {
                el.addEventListener("click", function() {
                  window.__trackCta(el.innerText || "product-selection", href);
                });
              }
            });
          });
        })();
      </script>
    `;

    if (pageHtml.includes("</body>")) {
      pageHtml = pageHtml.replace("</body>", `${trackingPixelScript}</body>`);
    } else {
      pageHtml += trackingPixelScript;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(pageHtml);
  } catch (err: any) {
    res.status(500).send("Proxy Error: " + err.message);
  }
}

router.get("/", serveFunnelIndex);
router.get("/funnels", serveFunnelIndex);
router.get("/apps/funnels", serveFunnelIndex);
router.get("/f/:funnelSlug/:stepPosition", serveFunnelPage);
router.get("/funnels/:funnelSlug/:stepPosition", serveFunnelPage);
router.get("/apps/funnels/:funnelSlug/:stepPosition", serveFunnelPage);

export default router;
