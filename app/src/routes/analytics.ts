import { Router } from "express";
import prisma from "../lib/db.js";
import { analyticsDataContract, analyticsModeForRequest, isTestForMode } from "../lib/analytics-config.js";

const router = Router();

// GET /api/analytics/account — Store-wide account-level analytics with dynamic date-driven benchmarks
router.get("/analytics/account", async (req, res) => {
  try {
    const mode = analyticsModeForRequest(req.query as Record<string, unknown>);
    const { from, to } = req.query;
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from as string);
    if (to) dateFilter.lte = new Date(to as string);

    const eventWhere: any = { isTest: isTestForMode(mode) };
    if (from || to) eventWhere.occurredAt = dateFilter;

    const ordersWhere: any = { isTest: isTestForMode(mode) };
    if (from || to) ordersWhere.paidAt = dateFilter;
    const events = await prisma.event.findMany({ where: eventWhere });
    const orders = await prisma.orderAttribution.findMany({
      where: ordersWhere,
    });

    const activeFunnels = await prisma.funnel.findMany({
      where: { NOT: { status: "ARCHIVED" } },
      include: { steps: { include: { variants: true } } },
    });

    const uniqueVisitorIds = new Set(events.map(e => e.visitorId).filter(Boolean));
    const totalViews = events.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
    const totalCtas = events.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
    const totalRevenue = orders.reduce((sum, o) => sum + o.netRevenueAmount, 0);
    const totalOrders = orders.length;
    const aov = totalOrders > 0 ? Number((totalRevenue / totalOrders).toFixed(2)) : 0;
    const overallConvRate = uniqueVisitorIds.size > 0 ? Number(((totalOrders / uniqueVisitorIds.size) * 100).toFixed(1)) : 0;

    // Dynamic Date-Driven Account Benchmarks calculated from live date-filtered events
    const discoveryVisitorIds = new Set(events.filter(e => e.stepId && activeFunnels.some(f => f.steps.some(s => s.id === e.stepId && (s.kind === "ADVERTORIAL" || s.kind === "LANDING")))).map(e => e.visitorId).filter(Boolean));
    const salesVisitorIds = new Set(events.filter(e => e.stepId && activeFunnels.some(f => f.steps.some(s => s.id === e.stepId && (s.kind === "SALES" || s.kind === "OFFER")))).map(e => e.visitorId).filter(Boolean));
    const checkoutVisitorIds = new Set(events.filter(e => e.stepId && activeFunnels.some(f => f.steps.some(s => s.id === e.stepId && s.kind === "CHECKOUT"))).map(e => e.visitorId).filter(Boolean));
    const upsellVisitorIds = new Set(events.filter(e => e.stepId && activeFunnels.some(f => f.steps.some(s => s.id === e.stepId && (s.kind === "UPSELL" || s.kind === "DOWNSELL")))).map(e => e.visitorId).filter(Boolean));

    const avgDiscoveryToSales = discoveryVisitorIds.size > 0 ? Number(((salesVisitorIds.size / discoveryVisitorIds.size) * 100).toFixed(1)) : 0;
    const avgSalesToCheckout = salesVisitorIds.size > 0 ? Number(((checkoutVisitorIds.size / salesVisitorIds.size) * 100).toFixed(1)) : 0;
    const avgCheckoutConv = checkoutVisitorIds.size > 0 ? Number(((totalOrders / checkoutVisitorIds.size) * 100).toFixed(1)) : 0;
    const avgUpsellTake = upsellVisitorIds.size > 0
      ? Number(((orders.filter(o => o.variantId && activeFunnels.some(f => f.steps.some(s => (s.kind === "UPSELL" || s.kind === "DOWNSELL") && s.variants.some(v => v.id === o.variantId)))).length / upsellVisitorIds.size) * 100).toFixed(1))
      : 0;

    // Channel Attribution Matrix (Facebook Ads, Shopify Email, Google Ads, Organic)
    const channelMap = new Map<string, { visitors: Set<string>; orders: number; revenue: number }>();
    ["Facebook Ads", "Shopify Email", "Google Ads", "Organic / Direct"].forEach(c => channelMap.set(c, { visitors: new Set(), orders: 0, revenue: 0 }));

    events.forEach(e => {
      let channel = "Organic / Direct";
      try {
        const payload = JSON.parse(e.payload || "{}");
        const src = (payload.utm_source || "").toLowerCase();
        if (src.includes("facebook") || src.includes("fb")) channel = "Facebook Ads";
        else if (src.includes("email") || src.includes("shopify_email")) channel = "Shopify Email";
        else if (src.includes("google")) channel = "Google Ads";
      } catch {}

      if (!channelMap.has(channel)) channelMap.set(channel, { visitors: new Set(), orders: 0, revenue: 0 });
      if (e.visitorId) channelMap.get(channel)!.visitors.add(e.visitorId);
    });

    orders.forEach(o => {
      const matchingEvent = o.checkoutToken ? events.find(e => e.checkoutToken === o.checkoutToken) : undefined;
      let channel = "Organic / Direct";
      if (matchingEvent) {
        try {
          const payload = JSON.parse(matchingEvent.payload || "{}");
          const src = (payload.utm_source || "").toLowerCase();
          if (src.includes("facebook") || src.includes("fb")) channel = "Facebook Ads";
          else if (src.includes("email") || src.includes("shopify_email")) channel = "Shopify Email";
          else if (src.includes("google")) channel = "Google Ads";
        } catch {}
      }
      if (channelMap.has(channel)) {
        const entry = channelMap.get(channel)!;
        entry.orders += 1;
        entry.revenue += o.netRevenueAmount;
      }
    });

    const channelAttribution = Array.from(channelMap.entries()).map(([channel, data]) => ({
      channel,
      visitors: data.visitors.size,
      orders: data.orders,
      convRate: data.visitors.size > 0 ? Number(((data.orders / data.visitors.size) * 100).toFixed(1)) : 0,
      revenue: Number(data.revenue.toFixed(2)),
      aov: data.orders > 0 ? Number((data.revenue / data.orders).toFixed(2)) : 0,
    })).sort((a, b) => b.revenue - a.revenue);

    const funnelSummaries = activeFunnels.map(funnel => {
      const funnelEvents = events.filter(e => e.funnelId === funnel.id);
      const funnelOrders = orders.filter(o => o.funnelId === funnel.id);
      const funnelVisitors = new Set(funnelEvents.map(e => e.visitorId).filter(Boolean)).size;
      const funnelViews = funnelEvents.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
      const funnelCtas = funnelEvents.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
      const funnelRev = funnelOrders.reduce((sum, o) => sum + o.netRevenueAmount, 0);
      const funnelConvRate = funnelVisitors > 0 ? Number(((funnelOrders.length / funnelVisitors) * 100).toFixed(1)) : 0;

      return {
        funnelId: funnel.id,
        name: funnel.name,
        slug: funnel.slug,
        status: funnel.status,
        stepsCount: funnel.steps.length,
        visitors: funnelVisitors,
        views: funnelViews,
        ctas: funnelCtas,
        orders: funnelOrders.length,
        conversionRate: funnelConvRate,
        revenue: Number(funnelRev.toFixed(2)),
      };
    });

    res.json({
      accountMode: true,
      ...analyticsDataContract(mode),
      currencySymbol: "₪",
      totalFunnels: activeFunnels.length,
      totalVisitors: uniqueVisitorIds.size,
      totalViews,
      totalCtas,
      totalOrders,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      aov,
      overallConvRate,
      benchmarks: {
        avgDiscoveryToSales,
        avgSalesToCheckout,
        avgCheckoutConv,
        avgUpsellTake,
      },
      channelAttribution,
      funnels: funnelSummaries,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch account analytics" });
  }
});

// GET /api/analytics/:funnelId — Full funnel report with dynamic next-step metric labels
router.get("/analytics/:funnelId", async (req, res) => {
  try {
    const mode = analyticsModeForRequest(req.query as Record<string, unknown>);
    const { funnelId } = req.params;
    const { from, to } = req.query;

    if (funnelId === "account") {
      return res.redirect("/api/analytics/account");
    }

    const funnel = await prisma.funnel.findUnique({
      where: { id: funnelId },
      include: {
        steps: {
          orderBy: { position: "asc" },
          include: {
            variants: true,
          },
        },
      },
    });

    if (!funnel) return res.status(404).json({ error: "Funnel not found" });

    // Date filter
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from as string);
    if (to) dateFilter.lte = new Date(to as string);

    const eventWhere: any = { funnelId, isTest: isTestForMode(mode) };
    if (from || to) eventWhere.occurredAt = dateFilter;

    const events = await prisma.event.findMany({ where: eventWhere });
    const orderWhere: any = { funnelId, isTest: isTestForMode(mode) };
    if (from || to) orderWhere.paidAt = dateFilter;
    const orders = await prisma.orderAttribution.findMany({ where: orderWhere });

    const uniqueVisitorIds = new Set(events.map(e => e.visitorId).filter(Boolean));
    const totalViews = events.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
    const totalCtas = events.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
    const totalRevenue = orders.reduce((sum, o) => sum + o.netRevenueAmount, 0);
    const totalOrders = orders.length;
    const aov = totalOrders > 0 ? Number((totalRevenue / totalOrders).toFixed(2)) : 0;
    const overallConvRate = uniqueVisitorIds.size > 0 ? Number(((totalOrders / uniqueVisitorIds.size) * 100).toFixed(1)) : 0;

    // Visual Stepped Funnel Data Pipeline based on explicit step visitors
    const baseVisitors = uniqueVisitorIds.size || 1;
    const funnelFlow = funnel.steps.map((step, idx) => {
      const stepEvents = events.filter(e => e.stepId === step.id);
      const stepVisitorsCount = new Set(stepEvents.map(e => e.visitorId).filter(Boolean)).size;

      const nextStep = funnel.steps[idx + 1];
      const nextStepEvents = nextStep ? events.filter(e => e.stepId === nextStep.id) : [];
      const nextStepVisitorsCount = nextStep ? new Set(nextStepEvents.map(e => e.visitorId).filter(Boolean)).size : 0;

      const pct = Number(((stepVisitorsCount / baseVisitors) * 100).toFixed(1));
      const dropoffPct = stepVisitorsCount > 0 && nextStep ? Number(((1 - (nextStepVisitorsCount / stepVisitorsCount)) * 100).toFixed(1)) : 0;

      return {
        stage: `${step.position}. ${step.name} (${step.kind})`,
        count: stepVisitorsCount,
        percentage: pct,
        dropoff: dropoffPct,
      };
    });

    // Multi-Step Path Revenue Attribution Analysis
    const pathMap = new Map<string, { visitors: Set<string>; orders: number; revenue: number }>();

    events.forEach(e => {
      let pathFingerprint = "Direct Entry";
      try {
        const payload = JSON.parse(e.payload || "{}");
        if (payload.pathFingerprint) pathFingerprint = payload.pathFingerprint;
      } catch {}

      if (!pathMap.has(pathFingerprint)) {
        pathMap.set(pathFingerprint, { visitors: new Set(), orders: 0, revenue: 0 });
      }
      const entry = pathMap.get(pathFingerprint)!;
      if (e.visitorId) entry.visitors.add(e.visitorId);
    });

    orders.forEach(o => {
      const matchingEvent = o.checkoutToken ? events.find(e => e.checkoutToken === o.checkoutToken) : undefined;
      let pathFingerprint = "Direct / Unattributed Path";
      if (matchingEvent) {
        try {
          const payload = JSON.parse(matchingEvent.payload || "{}");
          if (payload.pathFingerprint) pathFingerprint = payload.pathFingerprint;
        } catch {}
      }

      if (!pathMap.has(pathFingerprint)) {
        pathMap.set(pathFingerprint, { visitors: new Set(), orders: 0, revenue: 0 });
      }
      const entry = pathMap.get(pathFingerprint)!;
      entry.orders += 1;
      entry.revenue += o.netRevenueAmount;
    });

    const pathAttribution = Array.from(pathMap.entries()).map(([path, data]) => ({
      path,
      visitors: data.visitors.size,
      orders: data.orders,
      revenue: Number(data.revenue.toFixed(2)),
      aov: data.orders > 0 ? Number((data.revenue / data.orders).toFixed(2)) : 0,
      convRate: data.visitors.size > 0 ? Number(((data.orders / data.visitors.size) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.revenue - a.revenue);

    // Channel Attribution Matrix for specific funnel
    const channelMap = new Map<string, { visitors: Set<string>; orders: number; revenue: number }>();
    ["Facebook Ads", "Shopify Email", "Google Ads", "Organic / Direct"].forEach(c => channelMap.set(c, { visitors: new Set(), orders: 0, revenue: 0 }));

    events.forEach(e => {
      let channel = "Organic / Direct";
      try {
        const payload = JSON.parse(e.payload || "{}");
        const src = (payload.utm_source || "").toLowerCase();
        if (src.includes("facebook") || src.includes("fb")) channel = "Facebook Ads";
        else if (src.includes("email") || src.includes("shopify_email")) channel = "Shopify Email";
        else if (src.includes("google")) channel = "Google Ads";
      } catch {}

      if (!channelMap.has(channel)) channelMap.set(channel, { visitors: new Set(), orders: 0, revenue: 0 });
      if (e.visitorId) channelMap.get(channel)!.visitors.add(e.visitorId);
    });

    orders.forEach(o => {
      const matchingEvent = o.checkoutToken ? events.find(e => e.checkoutToken === o.checkoutToken) : undefined;
      let channel = "Organic / Direct";
      if (matchingEvent) {
        try {
          const payload = JSON.parse(matchingEvent.payload || "{}");
          const src = (payload.utm_source || "").toLowerCase();
          if (src.includes("facebook") || src.includes("fb")) channel = "Facebook Ads";
          else if (src.includes("email") || src.includes("shopify_email")) channel = "Shopify Email";
          else if (src.includes("google")) channel = "Google Ads";
        } catch {}
      }
      if (channelMap.has(channel)) {
        const entry = channelMap.get(channel)!;
        entry.orders += 1;
        entry.revenue += o.netRevenueAmount;
      }
    });

    const channelAttribution = Array.from(channelMap.entries()).map(([channel, data]) => ({
      channel,
      visitors: data.visitors.size,
      orders: data.orders,
      convRate: data.visitors.size > 0 ? Number(((data.orders / data.visitors.size) * 100).toFixed(1)) : 0,
      revenue: Number(data.revenue.toFixed(2)),
      aov: data.orders > 0 ? Number((data.revenue / data.orders).toFixed(2)) : 0,
    })).sort((a, b) => b.revenue - a.revenue);

    // Build step & variant metrics breakdown with dynamic "Progression to [Next Step Name]"
    const stepMetrics = funnel.steps.map((step, idx) => {
      const stepEvents = events.filter(e => e.stepId === step.id);
      const stepEntries = new Set(stepEvents.map(e => e.visitorId).filter(Boolean)).size;
      const stepViews = stepEvents.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
      const stepCtas = stepEvents.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
      const stepOrders = orders.filter(o => o.variantId && step.variants.some(v => v.id === o.variantId));
      const stepRevenue = stepOrders.reduce((sum, o) => sum + o.netRevenueAmount, 0);

      const nextStep = funnel.steps[idx + 1];

      // Dynamic Stage Metric Label: "Progression to [Next Step Name]"
      let stageMetricLabel = nextStep ? `Progression to ${nextStep.name}` : "Progression Rate";
      let stageMetricValue = stepEntries > 0 ? Number(((stepCtas / stepEntries) * 100).toFixed(1)) : 0;

      if (step.kind === "SALES" || step.kind === "OFFER") {
        stageMetricLabel = nextStep ? `Progression to ${nextStep.name}` : "Checkout Progression Rate";
      } else if (step.kind === "CHECKOUT") {
        stageMetricLabel = "Checkout Conversion Rate";
        stageMetricValue = stepEntries > 0 ? Number(((stepOrders.length / stepEntries) * 100).toFixed(1)) : overallConvRate;
      } else if (step.kind === "UPSELL" || step.kind === "DOWNSELL") {
        stageMetricLabel = "Offer Accept Rate";
      }

      const variantMetrics = step.variants.map((variant, vIdx) => {
        let varEvents = stepEvents.filter(e => e.variantId === variant.id);
        const varEntries = new Set(varEvents.map(e => e.visitorId).filter(Boolean)).size;
        const varViews = varEvents.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
        const varCtas = varEvents.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;

        let varOrders = orders.filter(o => o.variantId === variant.id);
        const varRevenue = varOrders.reduce((sum, o) => sum + o.netRevenueAmount, 0);
        const varProgressionRate = varEntries > 0 ? Number(((varCtas / varEntries) * 100).toFixed(1)) : 0;

        return {
          variantId: variant.id,
          name: variant.name,
          entries: varEntries,
          views: varViews,
          ctas: varCtas,
          progressionRate: varProgressionRate,
          orders: varOrders.length,
          revenue: Number(varRevenue.toFixed(2)),
        };
      });

      return {
        stepId: step.id,
        name: step.name,
        kind: step.kind,
        position: step.position,
        entries: stepEntries,
        views: stepViews,
        ctas: stepCtas,
        stageMetricLabel,
        stageMetricValue,
        orders: stepOrders.length,
        revenue: Number(stepRevenue.toFixed(2)),
        variants: variantMetrics,
      };
    });

    res.json({
      ...analyticsDataContract(mode),
      funnelId: funnel.id,
      funnelName: funnel.name,
      currencySymbol: "₪",
      totalVisitors: uniqueVisitorIds.size,
      totalViews,
      totalCtas,
      totalOrders,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      aov,
      overallConvRate,
      funnelFlow,
      pathAttribution,
      channelAttribution,
      steps: stepMetrics,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to generate analytics report" });
  }
});

// GET /api/analytics/:funnelId/csv — Download CSV report
router.get("/analytics/:funnelId/csv", async (req, res) => {
  try {
    const mode = analyticsModeForRequest(req.query as Record<string, unknown>);
    const { funnelId } = req.params;
    const { from, to } = req.query;

    const funnel = await prisma.funnel.findUnique({
      where: { id: funnelId },
      include: { steps: { orderBy: { position: "asc" }, include: { variants: true } } },
    });
    if (!funnel) return res.status(404).send("Funnel not found");

    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from as string);
    if (to) dateFilter.lte = new Date(to as string);

    const eventWhere: any = { funnelId, isTest: isTestForMode(mode) };
    if (from || to) eventWhere.occurredAt = dateFilter;

    const events = await prisma.event.findMany({ where: eventWhere });
    const orderWhere: any = { funnelId, isTest: isTestForMode(mode) };
    if (from || to) orderWhere.paidAt = dateFilter;
    const orders = await prisma.orderAttribution.findMany({ where: orderWhere });

    let csv = `Data Mode,${mode}\nData Source,${analyticsDataContract(mode).dataSource}\nCaveat,"${analyticsDataContract(mode).sampleSizeCaveat}"\n\nStep,Variant,Unique Visitors,Page Views,CTA Clicks,Progression Rate (%),Orders,Revenue (ILS)\n`;

    for (const step of funnel.steps) {
      const stepEvents = events.filter(e => e.stepId === step.id);
      const stepEntries = new Set(stepEvents.map(e => e.visitorId).filter(Boolean)).size;
      const stepViews = stepEvents.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
      const stepCtas = stepEvents.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
      const stepOrders = orders.filter(o => o.variantId && step.variants.some(v => v.id === o.variantId));
      const stepRevenue = stepOrders.reduce((sum, o) => sum + o.netRevenueAmount, 0);
      const ctaRate = stepEntries > 0 ? ((stepCtas / stepEntries) * 100).toFixed(1) : "0.0";

      csv += `"${step.name}",[TOTAL],${stepEntries},${stepViews},${stepCtas},${ctaRate},${stepOrders.length},${stepRevenue.toFixed(2)}\n`;

      for (const variant of step.variants) {
        const varEvents = stepEvents.filter(e => e.variantId === variant.id);
        const varEntries = new Set(varEvents.map(e => e.visitorId).filter(Boolean)).size;
        const varViews = varEvents.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
        const varCtas = varEvents.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
        const varOrders = orders.filter(o => o.variantId === variant.id);
        const varRevenue = varOrders.reduce((sum, o) => sum + o.netRevenueAmount, 0);
        const varCtaRate = varEntries > 0 ? ((varCtas / varEntries) * 100).toFixed(1) : "0.0";

        csv += `"${step.name}","${variant.name}",${varEntries},${varViews},${varCtas},${varCtaRate},${varOrders.length},${varRevenue.toFixed(2)}\n`;
      }
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="funnel-analytics-${funnel.slug}.csv"`);
    res.send(csv);
  } catch (err: any) {
    res.status(500).send("CSV Generation Error: " + err.message);
  }
});

// POST /api/track — Idempotent Event tracking endpoint with UTM & Dwell Time
router.post("/track", async (req, res) => {
  try {
    const mode = analyticsModeForRequest(req.query as Record<string, unknown>);
    const { event, funnelId, stepId, variantId, visitorId, checkoutToken, payload, explicitEventKey, pathFingerprint, utm_source, utm_medium, utm_campaign } = req.body;
    const allowedEvents = new Set(["page_view", "cta_click", "checkout_started", "FUNNEL_PAGE_VIEWED", "FUNNEL_CTA_CLICKED", "CHECKOUT_STARTED"]);
    if (!event || !funnelId || !allowedEvents.has(event)) {
      return res.status(400).json({ error: "event name and funnelId are required" });
    }

    const shop = await prisma.shop.findFirst();
    if (!shop) return res.status(400).json({ error: "No shop record configured" });

    const funnel = await prisma.funnel.findUnique({ where: { id: funnelId }, include: { steps: { include: { variants: true } } } });
    if (!funnel) return res.status(404).json({ error: "Funnel not found" });
    const step = stepId ? funnel.steps.find(item => item.id === stepId) : undefined;
    if (stepId && !step) return res.status(400).json({ error: "Step does not belong to funnel" });
    if (variantId && (!step || !step.variants.some(item => item.id === variantId))) {
      return res.status(400).json({ error: "Variant does not belong to step" });
    }

    let visitor = null;
    if (visitorId) {
      visitor = await prisma.visitor.upsert({
        where: { shopId_anonymousKeyHash: { shopId: shop.id, anonymousKeyHash: visitorId } },
        update: {},
        create: { shopId: shop.id, anonymousKeyHash: visitorId },
      });
    }

    const minuteBucket = Math.floor(Date.now() / 60000);
    const eventKey = explicitEventKey || `${event}:${funnelId}:${stepId || 'none'}:${variantId || 'none'}:${visitorId || 'anon'}:${minuteBucket}`;

    const existingEvent = await prisma.event.findUnique({ where: { eventKey } });
    if (existingEvent) {
      return res.json({ success: true, eventId: existingEvent.id, duplicate: true });
    }

    const mergedPayload = {
      ...(payload || {}),
      pathFingerprint: pathFingerprint || "",
      utm_source: utm_source || "organic",
      utm_medium: utm_medium || "",
      utm_campaign: utm_campaign || "",
    };

    const createdEvent = await prisma.event.create({
      data: {
        shopId: shop.id,
        eventKey,
        name: event,
        source: "STOREFRONT",
        occurredAt: new Date(),
        visitorId: visitor?.id || null,
        funnelId,
        stepId: stepId || null,
        variantId: variantId || null,
        checkoutToken: checkoutToken || null,
        utmSource: utm_source || "organic",
        utmMedium: utm_medium || null,
        utmCampaign: utm_campaign || null,
        payload: JSON.stringify(mergedPayload),
        isTest: isTestForMode(mode),
      },
    });

    if (checkoutToken && (event === "checkout_started" || event === "CHECKOUT_STARTED")) {
      await prisma.checkoutAttribution.upsert({
        where: { checkoutToken },
        update: { visitorId: visitor?.id || null, funnelId, lastStepId: stepId || null, lastVariantId: variantId || null },
        create: {
          shopId: shop.id,
          checkoutToken,
          visitorId: visitor?.id || null,
          funnelId,
          lastStepId: stepId || null,
          lastVariantId: variantId || null,
          startedAt: new Date(),
          confidence: "MEDIUM",
        },
      });
    }

    res.status(201).json({ success: true, eventId: createdEvent.id, duplicate: false, dataMode: mode });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to record event" });
  }
});

export default router;
