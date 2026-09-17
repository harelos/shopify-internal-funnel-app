import { supportD1, supportId, supportNow } from "../lib/support-d1.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { getShipmentStatus } from "../lib/cj-tracking-store.js";
import { describeForCustomer, type ShipmentStatus } from "../lib/cj-tracking.js";
import { GIFT_PERCENT, arrivedIsraelText, delayText, firstName, giftText } from "../lib/shipment-outreach-text.js";

/**
 * Proactive delivery updates, written from the carrier's real events.
 *
 * Chargebacks on this store come from silence: a parcel that takes three
 * weeks to Israel with no word from the shop reads as a scam. Each milestone
 * below sends one personalised note, at most once per order, and the message
 * always states the carrier's latest verified event rather than a promise.
 * Anything that needs a human decision (a parcel CJ never shipped, a carrier
 * exception) is escalated to the support queue instead of emailed.
 */
const shopify = new ShopifyAdminClient();

type Milestone = "ARRIVED_ISRAEL" | "DELAY_14" | "DELAY_20_GIFT";

interface Candidate {
  orderName: string;
  shopifyOrderGid: string | null;
  providerOrderReference: string | null;
  cjStatus: string | null;
  trackingNumber: string | null;
  orderBusinessDays: number;
  delivered: number;
  shopifyFinancialStatus: string | null;
}

const MAX_PER_RUN = 12;

function israelHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false }).format(now));
}

async function alreadySent(db: D1Database, orderName: string, milestone: Milestone): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM "ShipmentOutreach" WHERE "orderName" = ? AND "milestone" = ? LIMIT 1').bind(orderName, milestone).first();
  return Boolean(row);
}

async function customerHasOpenThread(db: D1Database, shopId: string, email: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS x FROM "SupportConversation" c JOIN "SupportCustomer" cu ON cu."id" = c."customerId"
    WHERE cu."shopId" = ? AND cu."email" = ? AND c."status" IN ('OPEN','ESCALATED','NEEDS_TRIAGE') LIMIT 1`).bind(shopId, email).first();
  return Boolean(row);
}

async function recentlyEmailed(db: D1Database, shopId: string, email: string, withinDays: number): Promise<boolean> {
  const since = new Date(Date.now() - withinDays * 86400000).toISOString();
  const row = await db.prepare(`SELECT 1 AS x FROM "SupportMessage" m JOIN "SupportConversation" c ON c."id" = m."conversationId" JOIN "SupportCustomer" cu ON cu."id" = c."customerId"
    WHERE cu."shopId" = ? AND cu."email" = ? AND m."direction" = 'OUTBOUND' AND m."sentAt" >= ? LIMIT 1`).bind(shopId, email, since).first();
  return Boolean(row);
}

/** Creates the customer/conversation and queues a deterministic draft for the Worker outbox. */
async function queueOutbound(db: D1Database, shopId: string, input: { email: string; name: string; subject: string; body: string; orderName: string; milestone: Milestone }): Promise<string> {
  const now = supportNow();
  const mailboxAddress = (workerEnvValue("SUPPORT_MAILBOX_ADDRESS") || workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_USER")).toLowerCase();
  const mailbox = await db.prepare('SELECT "id" FROM "SupportMailbox" WHERE "shopId" = ? AND "address" = ? LIMIT 1').bind(shopId, mailboxAddress).first<{ id: string }>();
  if (!mailbox) throw new Error("Support mailbox is not configured.");
  let customer = await db.prepare('SELECT "id" FROM "SupportCustomer" WHERE "shopId" = ? AND "email" = ? LIMIT 1').bind(shopId, input.email).first<{ id: string }>();
  if (!customer) {
    const id = supportId("customer");
    await db.prepare(`INSERT OR IGNORE INTO "SupportCustomer" ("id","shopId","email","displayName","riskLevel","riskReasonsJson","createdAt","updatedAt") VALUES (?,?,?,?,'LOW','[]',?,?)`)
      .bind(id, shopId, input.email, input.name || null, now, now).run();
    customer = { id };
  }
  const conversationId = supportId("conversation");
  const threadKey = `outreach:${input.orderName}:${input.milestone}`;
  await db.prepare(`INSERT INTO "SupportConversation"
    ("id","shopId","mailboxId","customerId","externalThreadKey","subject","status","priority","topic","audienceType","triageStatus","triageReason","language","riskLevel","escalationReason","nextActionAt","lastCustomerMessageAt","lastAgentMessageAt","createdAt","updatedAt")
    VALUES (?,?,?,?,?,?,'WAITING_CUSTOMER','NORMAL','ORDER_STATUS','VERIFIED_CUSTOMER','ACCEPTED','PROACTIVE_DELIVERY_UPDATE','HEBREW','LOW',NULL,NULL,NULL,NULL,?,?)`)
    .bind(conversationId, shopId, mailbox.id, customer.id, threadKey, input.subject, now, now).run();
  const draftId = supportId("draft");
  await db.prepare(`INSERT INTO "SupportDraft"
    ("id","conversationId","status","decision","replyText","model","confidence","reason","verifiedFactsJson","policyFlagsJson","sendAfter","claimedAt","attemptCount","lastDeliveryError","sentAt","createdAt","updatedAt")
    VALUES (?,?,'QUEUED_TO_SEND','REPLY',?,'shipment-outreach-v1',0.99,?,?,'[]',?,NULL,0,NULL,NULL,?,?)`)
    .bind(draftId, conversationId, input.body, `Proactive delivery update: ${input.milestone}`, JSON.stringify({ orderName: input.orderName, milestone: input.milestone }), now, now, now).run();
  return draftId;
}

async function escalateForHuman(db: D1Database, shopId: string, order: any, reason: string, detail: string): Promise<void> {
  const email = String(order?.email || order?.customer?.email || "").toLowerCase();
  if (!email) return;
  const key = `outreach-escalation:${order.name}:${reason}`;
  const exists = await db.prepare('SELECT 1 AS x FROM "SupportConversation" WHERE "shopId" = ? AND "externalThreadKey" = ? LIMIT 1').bind(shopId, key).first();
  if (exists) return;
  const now = supportNow();
  const mailboxAddress = (workerEnvValue("SUPPORT_MAILBOX_ADDRESS") || workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_USER")).toLowerCase();
  const mailbox = await db.prepare('SELECT "id" FROM "SupportMailbox" WHERE "shopId" = ? AND "address" = ? LIMIT 1').bind(shopId, mailboxAddress).first<{ id: string }>();
  if (!mailbox) return;
  let customer = await db.prepare('SELECT "id" FROM "SupportCustomer" WHERE "shopId" = ? AND "email" = ? LIMIT 1').bind(shopId, email).first<{ id: string }>();
  if (!customer) {
    const id = supportId("customer");
    await db.prepare(`INSERT OR IGNORE INTO "SupportCustomer" ("id","shopId","email","displayName","riskLevel","riskReasonsJson","createdAt","updatedAt") VALUES (?,?,?,?,'HIGH','[]',?,?)`)
      .bind(id, shopId, email, firstName(order) || null, now, now).run();
    customer = { id };
  }
  await db.prepare(`INSERT INTO "SupportConversation"
    ("id","shopId","mailboxId","customerId","externalThreadKey","subject","status","priority","topic","audienceType","triageStatus","triageReason","language","riskLevel","escalationReason","summary","nextActionAt","lastCustomerMessageAt","lastAgentMessageAt","createdAt","updatedAt")
    VALUES (?,?,?,?,?,?,'ESCALATED','URGENT','DELIVERY_DISPUTE','VERIFIED_CUSTOMER','ACCEPTED','SHIPMENT_MONITOR','HEBREW','HIGH',?,?,NULL,NULL,NULL,?,?)`)
    .bind(supportId("conversation"), shopId, mailbox.id, customer.id, key, `הזמנה ${order.name}: ${reason}`, reason, detail, now, now).run();
}

export async function processShipmentOutreach(): Promise<{ queued: number; escalated: number; skipped: string[]; disabled?: boolean }> {
  if (workerEnvValue("SHIPMENT_OUTREACH_ENABLED") !== "true") return { queued: 0, escalated: 0, skipped: [], disabled: true };
  const now = new Date();
  const hour = israelHour(now);
  // Customers are written to during the Israeli day only.
  if (hour < 9 || hour >= 20) return { queued: 0, escalated: 0, skipped: ["outside_hours"] };
  const db = supportD1();
  const shopDomain = workerEnvValue("SHOP_DOMAIN").toLowerCase();
  const shop = await db.prepare('SELECT "id" FROM "Shop" WHERE "domain" = ? LIMIT 1').bind(shopDomain).first<{ id: string }>();
  if (!shop) return { queued: 0, escalated: 0, skipped: ["no_shop"] };

  const rows = await db.prepare(`SELECT "orderName","shopifyOrderGid","providerOrderReference","cjStatus","trackingNumber","orderBusinessDays","delivered","shopifyFinancialStatus"
    FROM "ShipmentOrderState" WHERE "active" = 1 AND "delivered" = 0 ORDER BY "orderBusinessDays" DESC LIMIT 120`).all<Candidate>();
  const candidates = rows.results || [];
  let queued = 0;
  let escalated = 0;
  const skipped: string[] = [];

  for (const candidate of candidates) {
    if (queued >= MAX_PER_RUN) break;
    if (/REFUND|VOID/i.test(String(candidate.shopifyFinancialStatus || ""))) continue;
    const cjStatus = String(candidate.cjStatus || "").toUpperCase();
    let order: any = null;
    try { order = await shopify.orderForTracking(candidate.orderName); } catch { order = null; }
    if (!order || order.cancelledAt) continue;
    const email = String(order.email || order.customer?.email || "").toLowerCase();
    if (!email || /@(?:tigerbrandsglobal\.com|example\.com)$/i.test(email)) continue;

    // A parcel CJ closed or trashed without shipping needs a human remedy, not a reassurance.
    if (["CLOSED", "CANCELLED", "TRASH"].includes(cjStatus) && !candidate.trackingNumber && candidate.orderBusinessDays >= 3) {
      await escalateForHuman(db, shop.id, order, "CJ סגר את ההזמנה בלי משלוח", `CJ status ${cjStatus}, ${candidate.orderBusinessDays} business days, no tracking. Decide: re-order at CJ, replace, or refund.`);
      escalated += 1;
      continue;
    }

    const trackingNumber = candidate.trackingNumber
      || (order.fulfillments || []).flatMap((f: any) => f.trackingInfo || []).map((t: any) => String(t?.number || "").trim()).find(Boolean)
      || null;
    const status = trackingNumber ? await getShipmentStatus(trackingNumber) : null;
    if (status?.delivered) continue;

    if (status?.exception) {
      await escalateForHuman(db, shop.id, order, "חריגה אצל חברת המשלוחים", `${status.latestRemark || "exception"} at ${status.latestAt || "?"}. Decide the remedy before the customer writes in.`);
      escalated += 1;
      continue;
    }

    let milestone: Milestone | null = null;
    if (candidate.orderBusinessDays >= 20 && (!status || status.stage !== "IL_READY_FOR_PICKUP")) milestone = "DELAY_20_GIFT";
    else if (status?.inIsrael) milestone = "ARRIVED_ISRAEL";
    else if (candidate.orderBusinessDays >= 14) milestone = "DELAY_14";
    if (!milestone) continue;
    if (await alreadySent(db, candidate.orderName, milestone)) continue;
    // A human is already talking to this customer, or we wrote very recently.
    if (await customerHasOpenThread(db, shop.id, email)) { skipped.push(`${candidate.orderName}:open_thread`); continue; }
    if (await recentlyEmailed(db, shop.id, email, 2)) { skipped.push(`${candidate.orderName}:recent`); continue; }

    let code: string | null = null;
    if (milestone === "DELAY_20_GIFT") {
      code = `NOVA-SORRY-${String(candidate.orderName).replace(/^#/, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const endsAt = new Date(Date.now() + 60 * 86400000).toISOString();
      const created = await shopify.createSingleUseDiscount({ code, percentage: GIFT_PERCENT / 100, title: `Delivery apology ${candidate.orderName}`, endsAt }).catch(() => ({ ok: false }));
      if (!created.ok) code = null;
    }
    const subject = milestone === "ARRIVED_ISRAEL"
      ? `החבילה שלך כבר בישראל · הזמנה ${order.name}`
      : milestone === "DELAY_14" ? `עדכון על המשלוח שלך · הזמנה ${order.name}` : `מתנצלים על העיכוב · הזמנה ${order.name}`;
    const body = milestone === "ARRIVED_ISRAEL" && status
      ? arrivedIsraelText(order, status)
      : milestone === "DELAY_14" ? delayText(order, status, candidate.orderBusinessDays) : giftText(order, status, candidate.orderBusinessDays, code);
    const draftId = await queueOutbound(db, shop.id, { email, name: firstName(order), subject, body, orderName: candidate.orderName, milestone });
    await db.prepare(`INSERT OR IGNORE INTO "ShipmentOutreach" ("id","orderName","milestone","customerEmail","stage","draftId","discountCode","createdAt") VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(supportId("outreach"), candidate.orderName, milestone, email, status?.stage || null, draftId, code).run();
    queued += 1;
  }
  return { queued, escalated, skipped };
}
