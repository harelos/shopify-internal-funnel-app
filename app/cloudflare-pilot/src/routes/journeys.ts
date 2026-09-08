import { Router } from "express";
import prisma from "../lib/db.js";
import { friendlyChannel, humanizeJourneyEvent, journeyDurationMinutes, type JourneyTimelineEntry } from "../lib/journey-view.js";

const router = Router();
const DAY_MS = 86_400_000;

function boundedRange(query: Record<string, unknown>) {
  const to = query.to ? new Date(String(query.to)) : new Date();
  const from = query.from ? new Date(String(query.from)) : new Date(to.getTime() - 7 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("A valid reporting range is required.");
  if (from >= to) throw new Error("The reporting start must be before the end.");
  if (to.getTime() - from.getTime() > 90 * DAY_MS) throw new Error("Journey reports are limited to 90 days.");
  return { from, to };
}

function orderNumber(shopifyOrderGid: string): string {
  return `#${shopifyOrderGid.split("/").pop() || "Order"}`;
}

function sameVisitorWindow(eventAt: Date, paidAt: Date, start: Date): boolean {
  return eventAt >= start && eventAt <= new Date(paidAt.getTime() + 5 * 60_000);
}

router.get("/journeys", async (req, res) => {
  try {
    const { from, to } = boundedRange(req.query as Record<string, unknown>);
    const orders = await prisma.orderAttribution.findMany({
      where: {
        isTest: false,
        paidAt: { gte: from, lte: to },
        netRevenueAmount: { gt: 0 },
        status: { not: "REFUNDED_OR_CANCELLED" },
      },
      include: {
        checkout: true,
        elementAttributions: {
          include: {
            variant: { select: { name: true, isControl: true } },
            slot: { select: { name: true } },
          },
        },
      },
      orderBy: { paidAt: "desc" },
      take: 100,
    });

    const visitorIds = [...new Set(orders.map(order => order.checkout?.visitorId).filter((value): value is string => Boolean(value)))];
    const eventStart = new Date(from.getTime() - 30 * DAY_MS);
    const [events, exposures] = visitorIds.length ? await Promise.all([
      prisma.event.findMany({
        where: { isTest: false, visitorId: { in: visitorIds }, occurredAt: { gte: eventStart, lte: to } },
        orderBy: { occurredAt: "asc" },
        take: 4_000,
      }),
      prisma.elementExposure.findMany({
        where: { isInternal: false, visitorId: { in: visitorIds }, occurredAt: { gte: eventStart, lte: to } },
        include: { variant: { select: { name: true, isControl: true } }, slot: { select: { name: true } } },
        orderBy: { occurredAt: "asc" },
        take: 2_000,
      }),
    ]) : [[], []];

    const journeys = orders.map(order => {
      const visitorId = order.checkout?.visitorId || null;
      const timelineStart = order.checkout?.startedAt
        ? new Date(Math.min(order.checkout.startedAt.getTime(), order.paidAt.getTime()) - 30 * DAY_MS)
        : eventStart;
      const matchingEvents = visitorId
        ? events.filter(event => event.visitorId === visitorId && sameVisitorWindow(event.occurredAt, order.paidAt, timelineStart))
        : [];
      const visibleEvents = matchingEvents.flatMap(event => {
        const entry = humanizeJourneyEvent(event);
        return entry ? [entry] : [];
      });
      const exposureEntries: JourneyTimelineEntry[] = visitorId
        ? exposures
          .filter(exposure => exposure.visitorId === visitorId && sameVisitorWindow(exposure.occurredAt, order.paidAt, timelineStart))
          .map(exposure => ({
            at: exposure.occurredAt.toISOString(),
            category: "experiment",
            label: "Saw an experiment variant",
            detail: `${exposure.slot.name}: ${exposure.variant.name}${exposure.variant.isControl ? " (control)" : ""}`,
            page: null,
          }))
        : [];
      const checkoutEntry: JourneyTimelineEntry[] = order.checkout ? [{
        at: order.checkout.startedAt.toISOString(),
        category: "checkout",
        label: "Started Shopify checkout",
        detail: null,
        page: null,
      }] : [];
      const purchaseEntry: JourneyTimelineEntry = {
        at: order.paidAt.toISOString(),
        category: "purchase",
        label: "Completed purchase",
        detail: `${order.currency} ${order.netRevenueAmount.toFixed(2)}`,
        page: null,
      };
      const timeline = [...visibleEvents, ...exposureEntries, ...checkoutEntry, purchaseEntry]
        .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
        .filter((entry, index, all) => index === 0 || !(entry.label === all[index - 1].label && entry.at === all[index - 1].at && entry.detail === all[index - 1].detail));
      const firstTrackedEvent = matchingEvents[0];
      const lastTrackedEvent = matchingEvents[matchingEvents.length - 1];
      const status = !visitorId ? "UNATTRIBUTED" : visibleEvents.length ? "VERIFIED" : "PARTIAL";

      return {
        id: order.id,
        orderNumber: orderNumber(order.shopifyOrderGid),
        paidAt: order.paidAt,
        currency: order.currency,
        revenue: order.netRevenueAmount,
        status,
        confidence: order.confidence,
        channel: friendlyChannel(firstTrackedEvent?.utmSource || order.popupUtmSource, firstTrackedEvent?.utmMedium || order.popupUtmMedium),
        lastTouchChannel: friendlyChannel(lastTrackedEvent?.utmSource || order.popupUtmSource, lastTrackedEvent?.utmMedium || order.popupUtmMedium),
        device: firstTrackedEvent?.deviceClass || order.popupDevice || "Unknown device",
        durationMinutes: journeyDurationMinutes(timeline, order.paidAt),
        touchpoints: timeline.length,
        experimentAssignments: order.elementAttributions.map(attribution => ({
          slot: attribution.slot.name,
          variant: attribution.variant.name,
          isControl: attribution.variant.isControl,
        })),
        usedConcierge: order.popupAttributed && String(order.popupVersion || "").startsWith("novahair_ai"),
        timeline,
      };
    });

    const verified = journeys.filter(journey => journey.status === "VERIFIED").length;
    const unattributed = journeys.filter(journey => journey.status === "UNATTRIBUTED").length;
    const totalRevenue = Number(journeys.reduce((sum, journey) => sum + journey.revenue, 0).toFixed(2));
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      timezone: "Asia/Jerusalem",
      sourceOfTruth: "Shopify paid orders joined to first-party visitor, experiment, and experience events",
      summary: {
        orders: journeys.length,
        verified,
        partial: journeys.length - verified - unattributed,
        unattributed,
        totalRevenue,
        currency: journeys.length && journeys.every(journey => journey.currency === journeys[0].currency) ? journeys[0].currency : null,
      },
      journeys,
    });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to build customer journeys." });
  }
});

export default router;
