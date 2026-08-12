import { Router } from "express";
import prisma from "../lib/db.js";

const router = Router();

// GET /api/analytics/:funnelId — Full funnel report with step + variant breakdown
router.get("/analytics/:funnelId", async (req, res) => {
  try {
    const { funnelId } = req.params;
    const { from, to } = req.query;

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

    // Build step & variant metrics breakdown
    const stepMetrics = funnel.steps.map(step => {
      const stepEvents = events.filter(e => e.stepId === step.id);
      const stepEntries = new Set(stepEvents.map(e => e.visitorId).filter(Boolean)).size;
      const stepViews = stepEvents.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
      const stepCtas = stepEvents.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
      const stepOrders = orders.filter(o => o.variantId && step.variants.some(v => v.id === o.variantId));
      const stepRevenue = stepOrders.reduce((sum, o) => sum + o.netRevenueAmount, 0);
      const ctaRate = stepEntries > 0 ? Number(((stepCtas / stepEntries) * 100).toFixed(1)) : 0;

      const variantMetrics = step.variants.map(variant => {
        const varEvents = stepEvents.filter(e => e.variantId === variant.id);
        const varEntries = new Set(varEvents.map(e => e.visitorId).filter(Boolean)).size;
        const varViews = varEvents.filter(e => e.name === "page_view" || e.name === "FUNNEL_PAGE_VIEWED").length;
        const varCtas = varEvents.filter(e => e.name === "cta_click" || e.name === "FUNNEL_CTA_CLICKED").length;
        const varOrders = orders.filter(o => o.variantId === variant.id);
        const varRevenue = varOrders.reduce((sum, o) => sum + o.netRevenueAmount, 0);
        const varCtaRate = varEntries > 0 ? Number(((varCtas / varEntries) * 100).toFixed(1)) : 0;

        return {
          variantId: variant.id,
          name: variant.name,
          entries: varEntries,
          views: varViews,
          ctas: varCtas,
          ctaRate: varCtaRate,
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
        ctaRate,
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

    let csv = "Step,Variant,Entries,Views,CTA Clicks,CTA Rate (%),Orders,Revenue ($)\n";

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
    const { event, funnelId, stepId, variantId, visitorId, checkoutToken, payload, explicitEventKey } = req.body;
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
        payload: JSON.stringify(payload || {}),
      },
    });

    res.status(201).json({ success: true, eventId: createdEvent.id, duplicate: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to record event" });
  }
});

export default router;
