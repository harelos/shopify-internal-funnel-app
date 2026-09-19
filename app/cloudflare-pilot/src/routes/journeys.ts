import { Router } from "express";
import { reportingMoneyFor } from "../lib/reporting-currency.js";
import prisma from "../lib/db.js";
import { compactJourneyTimeline, friendlyChannel, humanizeJourneyEvent, journeyDurationMinutes, type JourneyTimelineEntry } from "../lib/journey-view.js";
import { supportD1 } from "../lib/support-d1.js";

type LiveRow = { visitorHash: string; occurredAt: string; kind: string; label: string | null; page: string | null; source: string | null; detail: string | null };

/**
 * What the sales page saw this person do, from the live feed. The feed keeps
 * a month and stores the visitor's key hashed the way the Visitor row does, so
 * the join never handles a raw key.
 */
async function liveRowsForVisitors(hashes: string[], from: Date, to: Date): Promise<LiveRow[]> {
  const unique = [...new Set(hashes.filter(Boolean))];
  if (!unique.length) return [];
  const out: LiveRow[] = [];
  const db = supportD1();
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const rows = await db.prepare(`SELECT "visitorHash","occurredAt","kind","label","page","source","detail" FROM "LiveActivity"
      WHERE "visitorHash" IN (${chunk.map(() => "?").join(",")}) AND "occurredAt" >= ? AND "occurredAt" <= ? AND "isInternal" = 0
      ORDER BY "occurredAt" ASC LIMIT 4000`).bind(...chunk, from.toISOString(), to.toISOString()).all<LiveRow>().catch(() => ({ results: [] as LiveRow[] }));
    out.push(...(rows.results || []));
  }
  return out;
}

const LIVE_SKIP = new Set(["leave", "cart_open", "cart_close", "click", "signal"]);
function liveEntry(row: LiveRow): JourneyTimelineEntry | null {
  if (LIVE_SKIP.has(row.kind)) return null;
  const label = row.label || row.kind;
  const page = row.page || null;
  switch (row.kind) {
    case "view": return { at: row.occurredAt, category: "visit", label: "Landed on the sales page", detail: row.source ? `from ${row.source}` : null, page };
    case "section": return /buy box/.test(label) ? { at: row.occurredAt, category: "engagement", label: "Reached the buy box", detail: null, page } : null;
    case "bundle": case "shade": case "compare": case "mix":
      return { at: row.occurredAt, category: "intent", label: label.charAt(0).toUpperCase() + label.slice(1), detail: null, page };
    case "cart_add": return { at: row.occurredAt, category: "intent", label: "Added to cart", detail: label.replace(/^added /, ""), page };
    case "cart_change": return { at: row.occurredAt, category: "intent", label: label.charAt(0).toUpperCase() + label.slice(1), detail: null, page };
    case "checkout_click": return { at: row.occurredAt, category: "checkout", label: "Went to checkout", detail: null, page };
    case "popup": case "concierge": return { at: row.occurredAt, category: "experience", label: label.charAt(0).toUpperCase() + label.slice(1), detail: null, page };
    case "module": case "module_action": return { at: row.occurredAt, category: "experiment", label: label.charAt(0).toUpperCase() + label.slice(1), detail: null, page };
    case "faq": case "gallery": case "reviews": return { at: row.occurredAt, category: "engagement", label: label.charAt(0).toUpperCase() + label.slice(1), detail: null, page };
    default: return null;
  }
}

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
    const visitorRows = visitorIds.length
      ? await prisma.visitor.findMany({ where: { id: { in: visitorIds } }, select: { id: true, anonymousKeyHash: true } })
      : [];
    const hashByVisitor = new Map(visitorRows.map(row => [row.id, row.anonymousKeyHash]));
    const liveRows = await liveRowsForVisitors([...hashByVisitor.values()], eventStart, new Date(to.getTime() + 5 * 60_000));

    const journeys = orders.map(order => {
      const visitorId = order.checkout?.visitorId || null;
      const visitorHash = visitorId ? hashByVisitor.get(visitorId) || null : null;
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
      const liveEntries: JourneyTimelineEntry[] = visitorHash
        ? liveRows
          .filter(row => row.visitorHash === visitorHash && sameVisitorWindow(new Date(row.occurredAt), order.paidAt, timelineStart))
          .map(liveEntry)
          .filter((entry): entry is JourneyTimelineEntry => Boolean(entry))
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
      const timeline = compactJourneyTimeline([...visibleEvents, ...liveEntries, ...exposureEntries, ...checkoutEntry, purchaseEntry]);
      const firstLive = liveRows.find(row => row.visitorHash === visitorHash && sameVisitorWindow(new Date(row.occurredAt), order.paidAt, timelineStart));
      const firstTrackedEvent = matchingEvents[0];
      const lastTrackedEvent = matchingEvents[matchingEvents.length - 1];
      const status = !visitorId ? "UNATTRIBUTED" : (visibleEvents.length || liveEntries.length || exposureEntries.length) ? "VERIFIED" : "PARTIAL";

      return {
        id: order.id,
        orderNumber: orderNumber(order.shopifyOrderGid),
        paidAt: order.paidAt,
        currency: order.currency,
        revenue: order.netRevenueAmount,
        status,
        confidence: order.confidence,
        channel: friendlyChannel(firstTrackedEvent?.utmSource || order.popupUtmSource || (firstLive?.source || "").split(" / ")[0] || null, firstTrackedEvent?.utmMedium || order.popupUtmMedium || (firstLive?.source || "").split(" / ")[1] || null),
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
    // Orders are charged in the store currency; the list is read in the
    // reporting currency, converted per order at the published daily rate so
    // the total is the sum of exactly what each line shows.
    const money = await reportingMoneyFor(journeys.map(journey => journey.currency));
    const reported = journeys.map(journey => {
      const converted = money.convert(journey.revenue, journey.currency);
      if (converted == null) return journey;
      const quote = money.rates.find(rate => rate.base.toUpperCase() === String(journey.currency).toUpperCase());
      return {
        ...journey,
        revenue: converted,
        currency: money.currency as string,
        storeRevenue: journey.revenue,
        storeCurrency: journey.currency,
        // The reader has to be able to see what this was converted from.
        conversion: quote
          ? {
              originalAmount: journey.revenue,
              originalCurrency: journey.currency,
              quoteCurrency: money.currency as string,
              rate: quote.rate,
              rateDate: quote.rateDate,
              rateSource: quote.source,
              rateQuality: quote.quality,
            }
          : null,
      };
    });
    const reportedCurrencies = [...new Set(reported.map(journey => journey.currency))];
    const totalRevenue = Number(reported.reduce((sum, journey) => sum + journey.revenue, 0).toFixed(2));
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
        currency: reportedCurrencies.length === 1 ? reportedCurrencies[0] : null,
        currencyQuality: money.quality,
        fx: money.rates,
      },
      journeys: reported,
    });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to build customer journeys." });
  }
});

export default router;
