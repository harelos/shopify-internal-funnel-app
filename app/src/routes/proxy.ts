import { Router } from "express";
import prisma from "../lib/db.js";
import { renderSandboxDocument } from "../lib/portability.js";
import { selectVariant } from "../services/ab-engine.js";

const router = Router();

function edgeCountryCode(headers: Record<string, unknown>): string {
  const candidates = [headers["cf-ipcountry"], headers["x-vercel-ip-country"], headers["cloudfront-viewer-country"]];
  for (const candidate of candidates) {
    const value = Array.isArray(candidate) ? candidate[0] : candidate;
    if (typeof value === "string" && /^[A-Za-z]{2,3}$/.test(value.trim())) return value.trim().toUpperCase();
  }
  return "";
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
router.get("/f/:funnelSlug/:stepPosition", async (req, res) => {
  try {
    const { funnelSlug, stepPosition } = req.params;
    const pos = parseInt(stepPosition, 10);

    const funnel = await prisma.funnel.findFirst({
      where: { slug: funnelSlug.toLowerCase() },
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
    const nextStepUrl = nextStep ? `/f/${funnel.slug}/${nextStep.position}` : `/f/${funnel.slug}/${pos}`;

    // Downsell / decline step target (#down, #decline-upsell)
    const downsellStep = funnel.steps.find(s => s.position === pos + 2) || nextStep;
    const downsellUrl = downsellStep ? `/f/${funnel.slug}/${downsellStep.position}` : nextStepUrl;

    const variantLabel = `${step.name} (${variant?.name || 'Main'})`;
    const trackingEndpoint = JSON.stringify(`${process.env.SHOPIFY_APP_PROXY_PATH || ""}/api/track`.replace(/^\/\/api/, "/api"));
    const countryCode = edgeCountryCode(req.headers as Record<string, unknown>);

    // Tracking pixel + CTA handler injection with UTM and session-level commerce context.
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

          var now = Date.now();
          var commerceSessionKey = "_commerce_session";
          var commerceSession = null;
          try { commerceSession = JSON.parse(sessionStorage.getItem(commerceSessionKey) || "null"); } catch (_) {}
          if (!commerceSession || !commerceSession.id || !commerceSession.lastActivityAt || now - Number(commerceSession.lastActivityAt) > 30 * 60 * 1000) {
            var randomPart = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + now.toString(36);
            commerceSession = { id: randomPart, startedAt: now, lastActivityAt: now, landingPath: window.location.pathname || "/" };
          } else {
            commerceSession.lastActivityAt = now;
          }
          sessionStorage.setItem(commerceSessionKey, JSON.stringify(commerceSession));

          var urlParams = new URLSearchParams(window.location.search);
          var utm_source = urlParams.get("utm_source") || (document.referrer.indexOf("facebook") >= 0 ? "facebook" : document.referrer.indexOf("instagram") >= 0 ? "instagram" : "organic");
          var utm_medium = urlParams.get("utm_medium") || "";
          var utm_campaign = urlParams.get("utm_campaign") || "";
          var ua = navigator.userAgent || "";
          var metaEnvironment = /Instagram/i.test(ua) ? "INSTAGRAM_IN_APP" : /(FBAN|FBAV|FB_IAB)/i.test(ua) ? "FACEBOOK_IN_APP" : "OTHER";
          var browserFamily = /SamsungBrowser/i.test(ua) ? "SAMSUNG_INTERNET" : /CriOS/i.test(ua) ? "CHROME_IOS" : /Chrome\//i.test(ua) ? "CHROME" : /Safari\//i.test(ua) && !/Chrome|CriOS|Android/i.test(ua) ? "SAFARI" : "OTHER";
          var telemetryPayload = {
            sessionId: commerceSession.id,
            sessionStartedAt: new Date(Number(commerceSession.startedAt)).toISOString(),
            landingPath: commerceSession.landingPath,
            pagePath: window.location.pathname || "/",
            pageUrl: window.location.href,
            referrer: document.referrer || "",
            userAgent: ua,
            browserFamily: browserFamily,
            metaEnvironment: metaEnvironment,
            viewportWidth: window.innerWidth || null,
            language: navigator.language || "",
            countryCode: "${countryCode}",
            countrySource: "${countryCode ? "EDGE_HEADER" : "UNKNOWN"}"
          };

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
            utm_campaign: utm_campaign,
            payload: telemetryPayload
          };

          var vid = localStorage.getItem("_fv") || "${visitorId}";
          localStorage.setItem("_fv", vid);
          document.cookie = "_fv=" + encodeURIComponent(vid) + "; Path=/; SameSite=Lax";
          document.cookie = "_funnel_context=" + encodeURIComponent(JSON.stringify({
            shopDomain: "${(process.env.SHOP_DOMAIN || "").replace(/"/g, '\\"')}",
            visitorId: vid,
            funnelId: "${funnel.id}",
            stepId: "${step.id}",
            variantId: "${variantId}",
            sessionId: commerceSession.id
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
            telemetryPayload.pagePath = window.location.pathname || "/";
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
});

export default router;
