import { Router } from "express";
import prisma from "../lib/db.js";

const router = Router();

// GET /api/analytics/account — Store-wide account-level analytics across all funnels
router.get("/analytics/account", async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from as string);
    if (to) dateFilter.lte = new Date(to as string);

    const eventWhere: any = {};
    if (from || to) eventWhere.occurredAt = dateFilter;

    const events = await prisma.event.findMany({ where: eventWhere });
    const orders = await prisma.orderAttribution.findMany({
      where: from || to ? { paidAt: dateFilter } : {},
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
      totalFunnels: activeFunnels.length,
      totalVisitors: uniqueVisitorIds.size,
      totalViews,
      totalCtas,
      totalOrders,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      aov,
      overallConvRate,
      funnels: funnelSummaries,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch account analytics" });
  }
});

// GET /api/analytics/:funnelId — Full funnel report with stage-specific metrics & path attribution
router.get("/analytics/:funnelId", async (req, res) => {
  try {
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

    const eventWhere: any = { funnelId };
    if (from || to) eventWhere.occurredAt = dateFilter;

    const events = await prisma.event.findMany({ where: eventWhere });
    const orders = await prisma.orderAttribution.findMany({
      where: {
        funnelId,
        ...(from || to ? { paidAt: dateFilter } : {}),
      },
    });

    const uniqueVisitorIds = new Set(events.map(e => e.visitorId).filter(Boolean));
    const totalViews = events.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
    const totalCtas = events.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
    const totalRevenue = orders.reduce((sum, o) => sum + o.netRevenueAmount, 0);
    const totalOrders = orders.length;
    const aov = totalOrders > 0 ? Number((totalRevenue / totalOrders).toFixed(2)) : 0;
    const overallConvRate = uniqueVisitorIds.size > 0 ? Number(((totalOrders / uniqueVisitorIds.size) * 100).toFixed(1)) : 0;

    // Group steps by category stage
    const discoverySteps = funnel.steps.filter(s => s.kind === "ADVERTORIAL" || s.kind === "LANDING" || s.kind === "OTHER");
    const salesSteps = funnel.steps.filter(s => s.kind === "SALES" || s.kind === "OFFER");
    const checkoutSteps = funnel.steps.filter(s => s.kind === "CHECKOUT");
    const upsellSteps = funnel.steps.filter(s => s.kind === "UPSELL" || s.kind === "DOWNSELL");

    // Stage metrics calculations
    const discoveryVisitors = new Set(events.filter(e => discoverySteps.some(s => s.id === e.stepId)).map(e => e.visitorId).filter(Boolean)).size;
    const salesVisitors = new Set(events.filter(e => salesSteps.some(s => s.id === e.stepId)).map(e => e.visitorId).filter(Boolean)).size;
    const checkoutVisitors = new Set(events.filter(e => checkoutSteps.some(s => s.id === e.stepId)).map(e => e.visitorId).filter(Boolean)).size;
    const upsellVisitors = new Set(events.filter(e => upsellSteps.some(s => s.id === e.stepId)).map(e => e.visitorId).filter(Boolean)).size;

    const discoveryToSalesRate = discoveryVisitors > 0 ? Number(((salesVisitors / discoveryVisitors) * 100).toFixed(1)) : 0;
    const salesToCheckoutRate = salesVisitors > 0 ? Number(((checkoutVisitors / salesVisitors) * 100).toFixed(1)) : 0;
    const checkoutConversionRate = checkoutVisitors > 0 ? Number(((totalOrders / checkoutVisitors) * 100).toFixed(1)) : 0;
    const upsellAcceptRate = upsellVisitors > 0 ? Number(((orders.filter(o => o.variantId && upsellSteps.some(s => s.variants.some(v => v.id === o.variantId))).length / upsellVisitors) * 100).toFixed(1)) : 0;

    // Visual Stepped Funnel Data Pipeline
    const baseVisitors = uniqueVisitorIds.size || 1;
    const funnelFlow = [
      {
        stage: "Discovery (Advertorial / Listicle / Landing)",
        count: discoveryVisitors || uniqueVisitorIds.size,
        percentage: Number((((discoveryVisitors || uniqueVisitorIds.size) / baseVisitors) * 100).toFixed(1)),
        dropoff: discoveryVisitors > 0 ? Number(((1 - (salesVisitors / discoveryVisitors)) * 100).toFixed(1)) : 0,
      },
      {
        stage: "Sales / Offer Page",
        count: salesVisitors,
        percentage: Number(((salesVisitors / baseVisitors) * 100).toFixed(1)),
        dropoff: salesVisitors > 0 ? Number(((1 - (checkoutVisitors / salesVisitors)) * 100).toFixed(1)) : 0,
      },
      {
        stage: "Shopify Checkout",
        count: checkoutVisitors,
        percentage: Number(((checkoutVisitors / baseVisitors) * 100).toFixed(1)),
        dropoff: checkoutVisitors > 0 ? Number(((1 - (totalOrders / checkoutVisitors)) * 100).toFixed(1)) : 0,
      },
      {
        stage: "Paid Orders Confirmed",
        count: totalOrders,
        percentage: overallConvRate,
        dropoff: 0,
      },
    ];

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
      // Find matching checkout token / visitor path
      const matchingEvent = events.find(e => (o.checkoutToken && e.checkoutToken === o.checkoutToken) || (o.variantId && e.variantId === o.variantId));
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

    // Build step & variant metrics breakdown with Stage-Specific Labels
    const stepMetrics = funnel.steps.map(step => {
      const stepEvents = events.filter(e => e.stepId === step.id);
      const stepEntries = new Set(stepEvents.map(e => e.visitorId).filter(Boolean)).size;
      const stepViews = stepEvents.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
      const stepCtas = stepEvents.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
      const stepOrders = orders.filter(o => o.variantId && step.variants.some(v => v.id === o.variantId));
      const stepRevenue = stepOrders.reduce((sum, o) => sum + o.netRevenueAmount, 0);

      let stageMetricLabel = "Progression Rate";
      let stageMetricValue = stepEntries > 0 ? Number(((stepCtas / stepEntries) * 100).toFixed(1)) : 0;

      if (step.kind === "ADVERTORIAL" || step.kind === "LANDING") {
        stageMetricLabel = "Progression to Sales Page";
      } else if (step.kind === "SALES" || step.kind === "OFFER") {
        stageMetricLabel = "Checkout Progression Rate";
      } else if (step.kind === "CHECKOUT") {
        stageMetricLabel = "Checkout Conversion Rate";
        stageMetricValue = checkoutConversionRate;
      } else if (step.kind === "UPSELL" || step.kind === "DOWNSELL") {
        stageMetricLabel = "Offer Accept Rate";
      }

      const variantMetrics = step.variants.map(variant => {
        const varEvents = stepEvents.filter(e => e.variantId === variant.id);
        const varEntries = new Set(varEvents.map(e => e.visitorId).filter(Boolean)).size;
        const varViews = varEvents.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
        const varCtas = varEvents.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
        const varOrders = orders.filter(o => o.variantId === variant.id);
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
      funnelId: funnel.id,
      funnelName: funnel.name,
      totalVisitors: uniqueVisitorIds.size,
      totalViews,
      totalCtas,
      totalOrders,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      aov,
      overallConvRate,
      discoveryToSalesRate,
      salesToCheckoutRate,
      checkoutConversionRate,
      upsellAcceptRate,
      funnelFlow,
      pathAttribution,
      steps: stepMetrics,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to generate analytics report" });
  }
});

// GET /api/analytics/:funnelId/csv — Download CSV report
router.get("/analytics/:funnelId/csv", async (req, res) => {
  try {
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

    const eventWhere: any = { funnelId };
    if (from || to) eventWhere.occurredAt = dateFilter;

    const events = await prisma.event.findMany({ where: eventWhere });
    const orders = await prisma.orderAttribution.findMany({
      where: { funnelId, ...(from || to ? { paidAt: dateFilter } : {}) },
    });

    let csv = "Step,Variant,Entries,Views,CTA Clicks,Progression Rate (%),Orders,Revenue ($)\n";

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

// POST /api/track — Idempotent Event tracking endpoint
router.post("/track", async (req, res) => {
  try {
    const { event, funnelId, stepId, variantId, visitorId, checkoutToken, payload, explicitEventKey, pathFingerprint } = req.body;
    if (!event || !funnelId) {
      return res.status(400).json({ error: "event name and funnelId are required" });
    }

    const shop = await prisma.shop.findFirst();
    if (!shop) return res.status(400).json({ error: "No shop record configured" });

    // Get or create visitor
    let visitor = null;
    if (visitorId) {
      visitor = await prisma.visitor.upsert({
        where: { shopId_anonymousKeyHash: { shopId: shop.id, anonymousKeyHash: visitorId } },
        update: {},
        create: { shopId: shop.id, anonymousKeyHash: visitorId },
      });
    }

    // Deduplication window key (same event within same minute for same visitor/step/variant)
    const minuteBucket = Math.floor(Date.now() / 60000);
    const eventKey = explicitEventKey || `${event}:${funnelId}:${stepId || 'none'}:${variantId || 'none'}:${visitorId || 'anon'}:${minuteBucket}`;

    // Upsert event for deduplication
    const existingEvent = await prisma.event.findUnique({ where: { eventKey } });
    if (existingEvent) {
      return res.json({ success: true, eventId: existingEvent.id, duplicate: true });
    }

    const mergedPayload = { ...(payload || {}), pathFingerprint: pathFingerprint || "" };

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
        payload: JSON.stringify(mergedPayload),
      },
    });

    res.status(201).json({ success: true, eventId: createdEvent.id, duplicate: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to record event" });
  }
});

export default router;
