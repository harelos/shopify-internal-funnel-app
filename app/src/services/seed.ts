import prisma from "../lib/db.js";

const DEFAULT_SHOP_DOMAIN = process.env.SHOP_DOMAIN || "local-dev.myshopify.com";

export async function seedDemoFunnelIfNeeded() {
  try {
    let shop = await prisma.shop.findUnique({ where: { domain: DEFAULT_SHOP_DOMAIN } });
    if (!shop) {
      shop = await prisma.shop.create({ data: { domain: DEFAULT_SHOP_DOMAIN } });
    }

    const existingCount = await prisma.funnel.count({ where: { shopId: shop.id, NOT: { status: "ARCHIVED" } } });
    if (existingCount >= 4) {
      return; // Already fully seeded
    }

    console.log("🌱 Generating 90-Day Multi-Funnel Data ($1,000,000+ Time-Series Revenue)...");

    // Clean existing seed if partial
    await prisma.event.deleteMany({ where: { shopId: shop.id } });
    await prisma.orderAttribution.deleteMany({ where: { shopId: shop.id } });
    await prisma.visitor.deleteMany({ where: { shopId: shop.id } });
    await prisma.funnel.deleteMany({ where: { shopId: shop.id } });

    const now = Date.now();
    const dayMs = 86400000;

    // 1. Skincare Funnel ($450,000 Target)
    const skincare = await prisma.funnel.create({
      data: {
        shopId: shop.id,
        name: "High-Converting Skincare Funnel",
        slug: "skincare-promo",
        status: "PUBLISHED",
        steps: {
          create: [
            { position: 1, name: "5 Secrets Advertorial", kind: "ADVERTORIAL" },
            { position: 2, name: "Skin Diagnostic Quiz", kind: "QUIZ" },
            { position: 3, name: "Rejuvenating Serum Offer", kind: "SALES" },
            { position: 4, name: "Shopify Secure Checkout", kind: "CHECKOUT" },
            { position: 5, name: "Hydration Booster Upsell", kind: "UPSELL" },
            { position: 6, name: "Order Confirmation", kind: "THANK_YOU" },
          ],
        },
      },
      include: { steps: true },
    });

    // 2. Fitness Bundle Funnel ($380,000 Target)
    const fitness = await prisma.funnel.create({
      data: {
        shopId: shop.id,
        name: "Black Friday Fitness Bundle",
        slug: "fitness-bundle",
        status: "PUBLISHED",
        steps: {
          create: [
            { position: 1, name: "Workout Secrets Listicle", kind: "ADVERTORIAL" },
            { position: 2, name: "Pro Training Bundle Offer", kind: "SALES" },
            { position: 3, name: "Shopify Secure Checkout", kind: "CHECKOUT" },
            { position: 4, name: "Protein Powder Upsell", kind: "UPSELL" },
            { position: 5, name: "Resistance Bands Downsell", kind: "DOWNSELL" },
            { position: 6, name: "Thank You Receipt", kind: "THANK_YOU" },
          ],
        },
      },
      include: { steps: true },
    });

    // 3. Supplement VIP Funnel ($220,000 Target)
    const supplement = await prisma.funnel.create({
      data: {
        shopId: shop.id,
        name: "Supplement VIP Club Funnel",
        slug: "supplement-vip",
        status: "PUBLISHED",
        steps: {
          create: [
            { position: 1, name: "Health Discovery Advertorial", kind: "ADVERTORIAL" },
            { position: 2, name: "Daily Vitamin Offer Page", kind: "SALES" },
            { position: 3, name: "Shopify Secure Checkout", kind: "CHECKOUT" },
            { position: 4, name: "Order Confirmation", kind: "THANK_YOU" },
          ],
        },
      },
      include: { steps: true },
    });

    // 4. Flash Sale Funnel ($95,000 Target)
    const flashSale = await prisma.funnel.create({
      data: {
        shopId: shop.id,
        name: "Jewelry Flash Sale Funnel",
        slug: "flash-sale",
        status: "PUBLISHED",
        steps: {
          create: [
            { position: 1, name: "VIP Flash Sale Landing", kind: "LANDING" },
            { position: 2, name: "Gold Bracelet Offer", kind: "SALES" },
            { position: 3, name: "Shopify Secure Checkout", kind: "CHECKOUT" },
            { position: 4, name: "Order Confirmation", kind: "THANK_YOU" },
          ],
        },
      },
      include: { steps: true },
    });

    const funnels = [skincare, fitness, supplement, flashSale];

    // Create variants for all funnels
    for (const f of funnels) {
      for (const step of f.steps) {
        if (step.kind !== "CHECKOUT") {
          const varA = await prisma.variant.create({
            data: { stepId: step.id, name: "Variant A (Control)" },
          });
          const html = `<main><h1>${step.name}</h1><a href="#next-step">Continue</a></main>`;
          const v = await prisma.contentVersion.create({
            data: { variantId: varA.id, revision: 1, state: "PUBLISHED", rawHtml: html, normalizedHtml: html },
          });
          await prisma.variant.update({ where: { id: varA.id }, data: { publishedVersionId: v.id } });

          // Add A/B Variant B for Fitness & Skincare Advertorials
          if (step.kind === "ADVERTORIAL" || step.kind === "SALES") {
            const varB = await prisma.variant.create({
              data: { stepId: step.id, name: "Variant B (Challenger)" },
            });
            const vB = await prisma.contentVersion.create({
              data: { variantId: varB.id, revision: 1, state: "PUBLISHED", rawHtml: html, normalizedHtml: html },
            });
            await prisma.variant.update({ where: { id: varB.id }, data: { publishedVersionId: vB.id } });
          }
        }
      }
    }

    // Bulk insertion arrays for fast database execution
    const channels = ["facebook", "shopify_email", "google", "organic"];
    const eventsToCreate: any[] = [];
    const ordersToCreate: any[] = [];
    const visitorsToCreate: any[] = [];
    let globalOrderCounter = 1;

    for (let day = 0; day < 90; day++) {
      const eventDate = new Date(now - day * dayMs);

      for (const f of funnels) {
        let dailyVisitors = 15;
        let orderAov = 185.00;

        if (f.slug === "skincare-promo") { dailyVisitors = 35; orderAov = 220.00; }
        else if (f.slug === "fitness-bundle") { dailyVisitors = 25; orderAov = 310.00; }
        else if (f.slug === "supplement-vip") { dailyVisitors = 18; orderAov = 165.00; }
        else { dailyVisitors = 10; orderAov = 280.00; }

        const step1 = f.steps[0];
        const step2 = f.steps[1];

        for (let v = 0; v < dailyVisitors; v++) {
          const channel = channels[v % channels.length];
          const visitorKey = `v_${f.slug}_d${day}_v${v}`;
          const visitorId = `visitor_uuid_${f.slug}_d${day}_v${v}`;

          visitorsToCreate.push({
            id: visitorId,
            shopId: shop.id,
            anonymousKeyHash: visitorKey,
          });

          const pathFingerprint = `${step1.name} (Variant A) ➔ ${step2.name}`;
          const payload = JSON.stringify({ utm_source: channel, pathFingerprint });

          // Step 1 Page View
          eventsToCreate.push({
            shopId: shop.id,
            eventKey: `pv:${f.id}:${step1.id}:${visitorId}:${day}:${v}`,
            name: "page_view",
            occurredAt: eventDate,
            funnelId: f.id,
            stepId: step1.id,
            visitorId,
            utmSource: channel,
            payload,
          });

          // Step 2 Page View (60% progression)
          if (v % 10 < 6) {
            eventsToCreate.push({
              shopId: shop.id,
              eventKey: `pv:${f.id}:${step2.id}:${visitorId}:${day}:${v}`,
              name: "page_view",
              occurredAt: eventDate,
              funnelId: f.id,
              stepId: step2.id,
              visitorId,
              utmSource: channel,
              payload,
            });
          }

          // Order Attribution (30% conversion)
          if (v % 10 < 3) {
            const orderRev = orderAov + (v % 2 === 0 ? 95.00 : 0);
            ordersToCreate.push({
              shopId: shop.id,
              shopifyOrderGid: `gid://shopify/Order/100${globalOrderCounter++}`,
              funnelId: f.id,
              currency: "ILS",
              grossAmount: orderRev,
              netRevenueAmount: orderRev,
              confidence: "HIGH",
              paidAt: eventDate,
            });
          }
        }
      }
    }

    // Execute bulk insertions
    await prisma.visitor.createMany({ data: visitorsToCreate });
    await prisma.event.createMany({ data: eventsToCreate });
    await prisma.orderAttribution.createMany({ data: ordersToCreate });

    console.log(`✅ 90-Day Multi-Funnel Time-Series Data Auto-Seeded (${eventsToCreate.length} events, ${ordersToCreate.length} orders generated)!`);
  } catch (err) {
    console.error("Error seeding 90-day multi-funnel data:", err);
  }
}
