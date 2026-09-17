import { supportD1 } from "../lib/support-d1.js";
import { sendSupportReplyEmail } from "../lib/smtp-email.js";
import { workerEnvValue } from "../lib/shopify-config.js";

/**
 * One email a day with everything that needs the owner, and yesterday's money.
 *
 * Every check in this system writes its problem to a dashboard panel and stops
 * there. Twenty-two orders sat unsent to CJ for days because nothing pushed
 * that fact anywhere. A dashboard answers a question you thought to ask; a
 * digest tells you the things you did not know to look for.
 */
const DIGEST_HOUR_ISRAEL = 7;

interface DigestRow { [key: string]: unknown }

function israelParts(now: Date): { hour: number; date: string } {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false }).format(now));
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { hour, date };
}

function shiftDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function money(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "—";
}

function change(current: unknown, previous: unknown): string {
  const now = Number(current);
  const before = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return "";
  const pct = ((now - before) / Math.abs(before)) * 100;
  return ` (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs the day before)`;
}

export async function sendOwnerDigest(now: Date = new Date(), options: { force?: boolean } = {}): Promise<{
  sent: boolean; reason?: string; lines?: number;
}> {
  if (workerEnvValue("OWNER_DIGEST_ENABLED") !== "true") return { sent: false, reason: "disabled" };
  const db = supportD1();
  if (!db) return { sent: false, reason: "no_database" };
  const { hour, date: today } = israelParts(now);
  if (!options.force && hour !== DIGEST_HOUR_ISRAEL) return { sent: false, reason: "outside_send_hour" };

  const yesterday = shiftDate(today, -1);
  const dayBefore = shiftDate(today, -2);
  // Sent at most once a day, whatever the cron does.
  const marker = `owner-digest:${yesterday}`;
  const already = await db.prepare('SELECT 1 AS x FROM "FinancialLedgerCoverage" WHERE "source" = ? AND "rangeKey" = ? LIMIT 1')
    .bind("OWNER_DIGEST", marker).first().catch(() => null);
  if (already && !options.force) return { sent: false, reason: "already_sent_today" };

  const day = await db.prepare(`SELECT * FROM "DashboardDailyMetric" WHERE "localDate" = ?`).bind(yesterday).first<DigestRow>().catch(() => null);
  const prior = await db.prepare(`SELECT * FROM "DashboardDailyMetric" WHERE "localDate" = ?`).bind(dayBefore).first<DigestRow>().catch(() => null);

  const [addressHolds, cjFailures, mappingHolds, unsentToCj, supportFailed, escalated, criticalShipments, adComments, guardianState] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS c, GROUP_CONCAT("orderNum") AS orders FROM "NovaHairPendingOrder" WHERE "syncState" = 'NEEDS_ADDRESS_FIX'`).first<DigestRow>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS c FROM "NovaHairPendingOrder" WHERE "syncState" LIKE '%FAILED%'`).first<DigestRow>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS c, GROUP_CONCAT("orderNum") AS orders FROM "NovaHairPendingOrder" WHERE "syncState" = 'NEEDS_SUPPLIER_MAPPING'`).first<DigestRow>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS c FROM "FinancialLedgerEntry" WHERE "source" = 'CJ_ORDER_COSTS' AND "occurredDate" >= ? AND json_extract("metadata", '$.costBasis') = 'CJ_BUNDLE_PRICE'`).bind(shiftDate(today, -7)).first<DigestRow>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS c FROM "SupportDraft" WHERE "status" IN ('FAILED','BOUNCED')`).first<DigestRow>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS c FROM "SupportConversation" WHERE "status" = 'ESCALATED'`).first<DigestRow>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS c FROM "ShipmentOrderState" WHERE "active" = 1 AND "severity" = 'CRITICAL'`).first<DigestRow>().catch(() => null),
    // Comments on a live ad are read by everyone the ad reaches, so the ones a
    // machine is not allowed to answer belong in the morning list.
    db.prepare(`SELECT COUNT(*) AS c FROM "CommentGuardianComment"
      WHERE "executedAction" IS NULL AND "recommendedAction" LIKE '%ESCALATE%'
        AND "firstSeenAt" >= datetime('now', '-7 days')`).first<DigestRow>().catch(() => null),
    db.prepare(`SELECT "lastError", "liveReplies", "liveHides" FROM "CommentGuardianState"
      ORDER BY "updatedAt" DESC LIMIT 1`).first<DigestRow>().catch(() => null),
  ]);

  const num = (row: DigestRow | null) => Number(row?.c || 0);
  const actions: string[] = [];
  if (num(addressHolds)) {
    const orders = String(addressHolds?.orders || "").split(",").filter(Boolean).slice(0, 12).map(n => `#${n}`).join(", ");
    actions.push(`${num(addressHolds)} order(s) cannot reach CJ because the address has no postcode: ${orders}. Add it in Shopify and each one is sent automatically.`);
  }
  if (num(cjFailures)) actions.push(`${num(cjFailures)} order(s) failed to reach CJ for another reason. Open Operations for the message CJ returned.`);
  if (num(mappingHolds)) {
    const orders = String(mappingHolds?.orders || "").split(",").filter(Boolean).slice(0, 12).map(n => `#${n}`).join(", ");
    actions.push(`${num(mappingHolds)} paid order(s) contain a product CJ cannot supply (Golden Blonde, or an add-on with no CJ mapping): ${orders}. Nothing ships until you source it, refund it, or have the mapping added.`);
  }
  if (num(unsentToCj)) actions.push(`${num(unsentToCj)} sale(s) in the last 7 days are priced from an identical bundle because CJ holds no order for them.`);
  if (num(supportFailed)) actions.push(`${num(supportFailed)} support repl(y/ies) failed to send. Nothing is retried automatically.`);
  if (num(criticalShipments)) actions.push(`${num(criticalShipments)} shipment(s) are critical. Open Shipment Control.`);
  if (num(escalated)) actions.push(`${num(escalated)} support conversation(s) are waiting for you.`);
  if (num(adComments)) actions.push(`${num(adComments)} comment(s) on the live ads need a person. Health, ingredients, accusations, payment and price are never answered automatically.`);
  const guardianError = String(guardianState?.lastError || "").trim();
  if (guardianError) actions.push(`The ad-comment guardian could not act: ${guardianError.slice(0, 140)}`);

  // The cost ledger is checked against the sales and against CJ every morning;
  // a disagreement is a line here, not a number nobody can trace.
  let costAuditLine = "";
  try {
    const { auditCjSupplierCosts } = await import("./cj-cost-audit.js");
    const audit = await auditCjSupplierCosts({ days: 7, now });
    const names = (items: Array<{ order: string }>) => items.slice(0, 8).map(item => item.order).join(", ");
    if (audit.unpriced.length) actions.push(`${audit.unpriced.length} sale(s) in the last 7 days have no supplier cost yet: ${names(audit.unpriced)}.`);
    if (audit.misdated.length) actions.push(`${audit.misdated.length} cost row(s) are dated on a different day than their sale: ${audit.misdated.slice(0, 6).map(item => `${item.order} (sale ${item.saleDate}, cost ${item.ledgerDate})`).join(", ")}.`);
    if (audit.duplicatesAtCj.length) actions.push(`${audit.duplicatesAtCj.length} sale(s) have more than one CJ order — trash the extra one before paying CJ in bulk: ${audit.duplicatesAtCj.slice(0, 6).map(item => `${item.order} (${item.cjOrders.join(", ")})`).join("; ")}.`);
    if (audit.cjList.note) actions.push(`Cost audit: ${audit.cjList.note}`);
    costAuditLine = `Cost audit (7 days): ${audit.priced} of ${audit.sales} sale(s) priced, ${audit.exact} from CJ's own order, ${audit.bundlePriced} from the identical bundle.`;
  } catch (error) {
    actions.push(`The cost audit could not run: ${String((error as Error)?.message || error).slice(0, 120)}`);
  }

  const profit = day ? Number(day.netRevenue || 0) - Number(day.productCost || 0) - Number(day.paymentFees || 0) - Number(day.adSpend || 0) : null;
  const priorProfit = prior ? Number(prior.netRevenue || 0) - Number(prior.productCost || 0) - Number(prior.paymentFees || 0) - Number(prior.adSpend || 0) : null;

  const body = [
    `NovaHair — ${yesterday}`,
    "",
    day ? `Revenue ${money(day.netRevenue)}${change(day.netRevenue, prior?.netRevenue)} from ${Number(day.orders || 0)} order(s)` : "No settled figures for yesterday yet.",
    day ? `Ad spend ${money(day.adSpend)}   Product cost ${money(day.productCost)}   Payment fees ${money(day.paymentFees)}` : "",
    day ? `Profit ${money(profit)}${change(profit, priorProfit)}` : "",
    day && Number(day.orders) ? `Break-even CPA ${money((Number(day.netRevenue || 0) - Number(day.productCost || 0) - Number(day.paymentFees || 0)) / Number(day.orders))}` : "",
    day && day.costPricedOrders != null && Number(day.costPricedOrders) < Number(day.orders || 0)
      ? `Cost covers ${Number(day.costPricedOrders)} of ${Number(day.orders)} order(s); the rest have no CJ order yet.`
      : "",
    costAuditLine,
    "",
    actions.length ? "NEEDS YOU:" : "Nothing needs you this morning.",
    ...actions.map(line => `• ${line}`),
    "",
    "Dashboard: https://admin.shopify.com/store/jacobfelipe/apps/funnel-builder-4",
  ].filter(line => line !== "").join("\n");

  const mailbox = workerEnvValue("SUPPORT_MAILBOX_ADDRESS") || workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_USER");
  const to = workerEnvValue("OWNER_DIGEST_TO") || mailbox;
  const result = await sendSupportReplyEmail({
    to,
    subject: `NovaHair ${yesterday}: ${money(day?.netRevenue)} revenue, ${actions.length} thing(s) need you`,
    body,
    messageId: `<owner-digest-${yesterday}@tigerbrandsglobal.com>`,
  });
  if (!result.ok) return { sent: false, reason: result.error || "send_failed" };

  await db.prepare(`INSERT INTO "FinancialLedgerCoverage"
      ("id","source","category","rangeKey","localFrom","localTo","amount","currency","quality","rowCount","reconciledAt","metadata")
    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)
    ON CONFLICT("source","category","rangeKey") DO UPDATE SET "reconciledAt" = CURRENT_TIMESTAMP`)
    .bind(`digest_${yesterday}`, "OWNER_DIGEST", "DAILY_DIGEST", marker, yesterday, yesterday, 0, "USD", "ACTUAL", actions.length, JSON.stringify({ actions: actions.length }))
    .run().catch(() => undefined);

  return { sent: true, lines: actions.length };
}
