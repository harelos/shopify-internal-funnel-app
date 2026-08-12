import prisma from "../lib/db.js";

const DEFAULT_SHOP_DOMAIN = process.env.SHOP_DOMAIN || "local-dev.myshopify.com";

export async function seedDemoFunnelIfNeeded() {
  try {
    let shop = await prisma.shop.findUnique({ where: { domain: DEFAULT_SHOP_DOMAIN } });
    if (!shop) {
      shop = await prisma.shop.create({ data: { domain: DEFAULT_SHOP_DOMAIN } });
    }

    const existingDemo = await prisma.funnel.findFirst({
      where: { shopId: shop.id, slug: "skincare-promo" },
    });
    if (existingDemo) {
      return; // Already seeded, skip
    }

    console.log("🌱 Seeding Demo Skincare Funnel & Sample Conversion Data...");

    // Create 6-step e-commerce funnel
    const funnel = await prisma.funnel.create({
      data: {
        shopId: shop.id,
        name: "High-Converting Skincare Funnel",
        slug: "skincare-promo",
        status: "PUBLISHED",
        steps: {
          create: [
            { position: 1, name: "5 Secrets Advertorial", kind: "ADVERTORIAL" },
            { position: 2, name: "Skin Type Diagnostic Quiz", kind: "QUIZ" },
            { position: 3, name: "Rejuvenating Serum Offer Page", kind: "SALES" },
            { position: 4, name: "Secure Checkout", kind: "CHECKOUT" },
            { position: 5, name: "Hydration Booster Upsell", kind: "UPSELL" },
            { position: 6, name: "Order Confirmation", kind: "THANK_YOU" },
          ],
        },
      },
      include: { steps: true },
    });

    // Create variants and draft HTML content for non-checkout steps
    for (const step of funnel.steps) {
      if (step.kind !== "CHECKOUT") {
        const variantA = await prisma.variant.create({
          data: {
            stepId: step.id,
            name: "Main Variant",
          },
        });

        let sampleHtml = `<main>\n  <h1>${step.name}</h1>\n  <p>High converting content for ${step.kind}</p>\n  <a href="#next-step" class="btn">Continue to Next Stage</a>\n</main>`;
        if (step.kind === "ADVERTORIAL") {
          sampleHtml = `<article class="advertorial">\n  <h1>5 Daily Secrets Dermatologists Don't Tell You About Aging Skin</h1>\n  <p>Discover how thousands of women transformed their skin texture in 14 days...</p>\n  <a href="#next-step" class="cta-btn">Take 60-Second Skin Quiz</a>\n</article>`;
        } else if (step.kind === "QUIZ") {
          sampleHtml = `<div class="quiz-container">\n  <h2>Question 1: What is your primary skin concern?</h2>\n  <button data-action="next-step" class="quiz-opt">A) Fine lines & wrinkles</button>\n  <button data-action="next-step" class="quiz-opt">B) Dryness & dullness</button>\n</div>`;
        } else if (step.kind === "SALES") {
          sampleHtml = `<section class="sales-page">\n  <h1>Special Offer: Rejuvenating Glow Serum (50% OFF)</h1>\n  <p>Clinical trials show 94% improved hydration within 48 hours.</p>\n  <a href="#next-step" class="cta-btn">Claim 50% Off & Checkout</a>\n</section>`;
        } else if (step.kind === "UPSELL") {
          sampleHtml = `<section class="upsell-modal">\n  <h2>WAIT! Add Hydration Booster Add-on for 40% OFF?</h2>\n  <a href="#accept-upsell" class="btn">Yes, Add to My Order ($19)</a>\n  <a href="#decline-upsell" class="btn-ghost">No thanks, finish order</a>\n</section>`;
        }

        const version = await prisma.contentVersion.create({
          data: {
            variantId: variantA.id,
            revision: 1,
            state: "PUBLISHED",
            rawHtml: sampleHtml,
            normalizedHtml: sampleHtml,
            publishedAt: new Date(),
          },
        });

        await prisma.variant.update({
          where: { id: variantA.id },
          data: { publishedVersionId: version.id },
        });
      }
    }

    // Seed sample telemetry events and attributed orders
    const now = Date.now();
    const visitorsCount = 120;
    const salesCount = 75;
    const ordersCount = 28;

    const advStep = funnel.steps.find(s => s.kind === "ADVERTORIAL")!;
    const salesStep = funnel.steps.find(s => s.kind === "SALES")!;

    // Create 120 sample visitors and events
    for (let i = 0; i < visitorsCount; i++) {
      const visitorKey = `v_demo_${Date.now()}_${i}`;
      const visitor = await prisma.visitor.upsert({
        where: { shopId_anonymousKeyHash: { shopId: shop.id, anonymousKeyHash: visitorKey } },
        update: {},
        create: { shopId: shop.id, anonymousKeyHash: visitorKey },
      });

      const pathFingerprint = i < salesCount ? "5 Secrets Advertorial ➔ Skin Type Quiz ➔ Sales Page" : "5 Secrets Advertorial";

      await prisma.event.create({
        data: {
          shopId: shop.id,
          eventKey: `page_view:${funnel.id}:${advStep.id}:${visitor.id}:${now + i}`,
          name: "page_view",
          occurredAt: new Date(now - (i % 7) * 86400000),
          funnelId: funnel.id,
          stepId: advStep.id,
          visitorId: visitor.id,
          payload: JSON.stringify({ pathFingerprint }),
        },
      });

      if (i < salesCount) {
        await prisma.event.create({
          data: {
            shopId: shop.id,
            eventKey: `page_view:${funnel.id}:${salesStep.id}:${visitor.id}:${now + i + 10}`,
            name: "page_view",
            occurredAt: new Date(now - (i % 7) * 86400000),
            funnelId: funnel.id,
            stepId: salesStep.id,
            visitorId: visitor.id,
            payload: JSON.stringify({ pathFingerprint }),
          },
        });
      }
    }

    // Create 28 sample attributed orders
    for (let o = 0; o < ordersCount; o++) {
      await prisma.orderAttribution.create({
        data: {
          shopId: shop.id,
          shopifyOrderGid: `gid://shopify/Order/demo_${Date.now()}_${o}`,
          funnelId: funnel.id,
          currency: "USD",
          grossAmount: 49.00 + (o % 2 === 0 ? 19.00 : 0),
          netRevenueAmount: 49.00 + (o % 2 === 0 ? 19.00 : 0),
          confidence: "HIGH",
          paidAt: new Date(now - (o % 7) * 86400000),
        },
      });
    }

    console.log("✅ Demo Skincare Funnel Auto-Seeded Successfully!");
  } catch (err) {
    console.error("Error auto-seeding demo funnel:", err);
  }
}
