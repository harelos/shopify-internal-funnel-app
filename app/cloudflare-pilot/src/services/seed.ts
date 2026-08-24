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

    console.log("🌱 Generating Time-Varying 90-Day Multi-Funnel Benchmarks ($1,000,000+ Revenue)...");

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
    const stepVariantsMap = new Map<string, any[]>();

    // Create variants and HTML versions for non-checkout steps
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

          const stepVariants = [varA];

          // Add Variant B for Advertorial, Quiz, and Sales steps
          if (step.kind === "ADVERTORIAL" || step.kind === "QUIZ" || step.kind === "SALES" || step.kind === "UPSELL") {
            const varB = await prisma.variant.create({
              data: { stepId: step.id, name: "Variant B (Challenger)" },
            });
            const vB = await prisma.contentVersion.create({
              data: { variantId: varB.id, revision: 1, state: "PUBLISHED", rawHtml: html, normalizedHtml: html },
            });
            await prisma.variant.update({ where: { id: varB.id }, data: { publishedVersionId: vB.id } });
            stepVariants.push(varB);
          }

          stepVariantsMap.set(step.id, stepVariants);
        }
      }
    }

    const channels = ["facebook", "shopify_email", "google", "organic"];
    const eventsToCreate: any[] = [];
    const ordersToCreate: any[] = [];
    const visitorsToCreate: any[] = [];
    let globalOrderCounter = 1;

    for (let day = 0; day < 90; day++) {
      const eventDate = new Date(now - day * dayMs);

      // Varying performance ratios across time so 7d vs 30d vs 90d benchmark numbers change
      let step2Ratio = 0.85; // Day 0-7: 85% progression
      let step3Ratio = 0.65;
      let orderRatio = 0.40;

      if (day > 7 && day <= 30) {
        step2Ratio = 0.70; // Day 8-30: 70% progression
        step3Ratio = 0.50;
        orderRatio = 0.25;
      } else if (day > 30) {
        step2Ratio = 0.52; // Day 31-90: 52% progression
        step3Ratio = 0.35;
        orderRatio = 0.15;
      }

      for (const f of funnels) {
        let dailyVisitors = 15;
        let baseAov = 195.00;

        if (f.slug === "skincare-promo") { dailyVisitors = 25; baseAov = 240.00; }
        else if (f.slug === "fitness-bundle") { dailyVisitors = 20; baseAov = 320.00; }
        else if (f.slug === "supplement-vip") { dailyVisitors = 15; baseAov = 175.00; }
        else { dailyVisitors = 10; baseAov = 290.00; }

        for (let v = 0; v < dailyVisitors; v++) {
          const channel = channels[v % channels.length];
          const visitorKey = `v_${f.slug}_d${day}_v${v}`;
          const visitorId = `visitor_uuid_${f.slug}_d${day}_v${v}`;

          visitorsToCreate.push({
            id: visitorId,
            shopId: shop.id,
            anonymousKeyHash: visitorKey,
          });

          // Simulate visitor progression through all steps in funnel
          let currentPathStr = "";

          for (let stepIdx = 0; stepIdx < f.steps.length; stepIdx++) {
            const step = f.steps[stepIdx];
            const variants = stepVariantsMap.get(step.id) || [];
            const selectedVariant = variants.length > 0 ? variants[v % variants.length] : null;

            // Progression drop-off threshold per step using date-varying ratios
            let dropoffLimit = 1.0;
            if (stepIdx === 1) dropoffLimit = step2Ratio;
            else if (stepIdx === 2) dropoffLimit = step3Ratio;
            else if (stepIdx === 3) dropoffLimit = step3Ratio * 0.7;
            else if (stepIdx === 4) dropoffLimit = orderRatio * 1.2;
            else if (stepIdx === 5) dropoffLimit = orderRatio;

            if ((v / dailyVisitors) > dropoffLimit) {
              break; // Visitor dropped off before reaching this step
            }

            const stepLabel = `${step.name}${selectedVariant ? ` (${selectedVariant.name})` : ''}`;
            currentPathStr = currentPathStr ? `${currentPathStr} ➔ ${stepLabel}` : stepLabel;
            const payload = JSON.stringify({ utm_source: channel, pathFingerprint: currentPathStr });

            // Record Page View event with stepId and variantId
            eventsToCreate.push({
              shopId: shop.id,
              eventKey: `pv:${f.id}:${step.id}:${selectedVariant?.id || 'none'}:${visitorId}:${day}:${v}`,
              name: "page_view",
              occurredAt: eventDate,
              funnelId: f.id,
              stepId: step.id,
              variantId: selectedVariant?.id || null,
              visitorId,
              utmSource: channel,
              payload,
            });

            // Record CTA Click event for non-checkout steps
            if (step.kind !== "CHECKOUT" && step.kind !== "THANK_YOU") {
              eventsToCreate.push({
                shopId: shop.id,
                eventKey: `cta:${f.id}:${step.id}:${selectedVariant?.id || 'none'}:${visitorId}:${day}:${v}`,
                name: "cta_click",
                occurredAt: new Date(eventDate.getTime() + 5000),
                funnelId: f.id,
                stepId: step.id,
                variantId: selectedVariant?.id || null,
                visitorId,
                utmSource: channel,
                payload,
              });
            }

            // Create Order Attribution for visitors reaching Thank You page / Checkout conversion
            if (step.kind === "THANK_YOU") {
              const salesStep = f.steps.find(s => s.kind === "SALES") || f.steps[0];
              const salesVariants = stepVariantsMap.get(salesStep.id) || [];
              const winningVariant = salesVariants[v % salesVariants.length];

              const orderRev = baseAov + (v % 2 === 0 ? 85.00 : 0);
              ordersToCreate.push({
                shopId: shop.id,
                shopifyOrderGid: `gid://shopify/Order/100${globalOrderCounter++}`,
                funnelId: f.id,
                variantId: winningVariant?.id || null,
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
    }

    // Execute bulk insertions
    await prisma.visitor.createMany({ data: visitorsToCreate });
    await prisma.event.createMany({ data: eventsToCreate });
    await prisma.orderAttribution.createMany({ data: ordersToCreate });

    console.log(`✅ Complete Time-Varying Benchmark Telemetry Auto-Seeded (${eventsToCreate.length} events, ${ordersToCreate.length} orders)!`);
  } catch (err) {
    console.error("Error seeding multi-step telemetry:", err);
  }
}
