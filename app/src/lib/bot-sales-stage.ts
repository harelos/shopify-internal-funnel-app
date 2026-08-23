import type { BotRouteDecision, BotSalesStage, BotConversationSignals, DiscountDecision } from "./bot-sales-brain.js";

export function deriveSalesStage(
  route: BotRouteDecision,
  signals: BotConversationSignals,
  discount: DiscountDecision,
): BotSalesStage | null {
  if (!route.salesAllowed) return null;
  if (discount.action === "OFFER_DISCOUNT") return "OFFER";
  if (signals.priceObjection || signals.exitOrAbandonmentSignal) return "OBJECTION";
  if (signals.purchaseIntent === "HIGH") return "CLOSE";
  if (signals.productQuestion && signals.customerMessages >= 2) return "RECOMMEND";
  if (signals.customerMessages <= 1) return "DISCOVER";
  if (signals.customerMessages <= 2) return "QUALIFY";
  return "RECOMMEND";
}
