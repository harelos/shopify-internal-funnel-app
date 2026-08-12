import { Router } from "express";
import prisma from "../lib/db.js";
import { renderSandboxDocument } from "../lib/portability.js";
import { selectVariant } from "../services/ab-engine.js";

const router = Router();

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

// GET /f/:funnelSlug/:stepPosition — Live Funnel Page Serving with A/B Traffic Splitter & Pixel Injection
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
        <body style="font-family:sans-serif; text-align:center; padding:100px;">
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

    // Fetch published version, or fallback to latest draft version for local preview
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

    // Tracking pixel + CTA handler injection
    const trackingPixelScript = `
      <script>
        (function() {
          var t = {
            funnelId: "${funnel.id}",
            stepId: "${step.id}",
            variantId: "${variantId}",
            nextStepUrl: "${nextStepUrl}"
          };
          var vid = localStorage.getItem("_fv") || "${visitorId}";
          localStorage.setItem("_fv", vid);
          t.visitorId = vid;

          // Track page view event automatically
          fetch("/api/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "page_view", ...t })
          });

          // Expose CTA tracking helper
          window.__trackCta = function(ctaName) {
            fetch("/api/track", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event: "cta_click", ctaName: ctaName || "primary", ...t })
            }).then(function() {
              window.location.href = t.nextStepUrl;
            });
          };

          // Attach tracking to buttons/links automatically
          document.addEventListener("DOMContentLoaded", function() {
            var btns = document.querySelectorAll("button, a.cta-btn, .btn");
            btns.forEach(function(btn) {
              btn.addEventListener("click", function(e) {
                if (btn.getAttribute("href") === "#" || !btn.getAttribute("href")) {
                  e.preventDefault();
                  window.__trackCta(btn.innerText || "cta");
                }
              });
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
