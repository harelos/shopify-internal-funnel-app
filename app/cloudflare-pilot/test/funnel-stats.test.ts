import test from "node:test";
import assert from "node:assert/strict";
import { FUNNELS, composeDay, daysBetween, groupRows, israelDay, landingPath, orderBelongsToFunnel, rates, sumRows } from "../src/lib/funnel-stats.js";

test("a day stands on first-party visitors when the page counted them, otherwise on Shopify's sessions", () => {
  const firstParty = composeDay({ day: "2026-09-18", shopify: { sessions: 144, addedToCart: 30, reachedCheckout: 19, purchases: 7 }, firstParty: { visitors: 104, addedToCart: 16, reachedCheckout: 5 }, orders: { purchases: 7, revenue: 1673 } });
  assert.equal(firstParty.basis, "first_party");
  assert.equal(firstParty.visitors, 104);
  assert.equal(firstParty.shopifySessions, 144);
  assert.equal(firstParty.purchases, 7);
  assert.equal(firstParty.rates.conversion, 0.0673);

  const shopify = composeDay({ day: "2026-09-01", shopify: { sessions: 28, addedToCart: 9, reachedCheckout: 4, purchases: 3 } });
  assert.equal(shopify.basis, "shopify");
  assert.equal(shopify.visitors, 28);
  // no orders cached yet: Shopify's completed checkouts stand in, and the row says so
  assert.equal(shopify.purchases, 3);
  assert.equal(shopify.ordersKnown, false);
  assert.equal(shopify.revenue, 0);
});

test("rates are null when the denominator is zero, never Infinity", () => {
  const r = rates({ visitors: 0, addedToCart: 0, reachedCheckout: 0, purchases: 0, revenue: 0 });
  assert.equal(r.addToCart, null);
  assert.equal(r.conversion, null);
  assert.equal(r.revenuePerVisitor, null);
  const empty = composeDay({ day: "2026-08-01" });
  assert.equal(empty.basis, "none");
  assert.equal(empty.visitors, 0);
});

test("weeks start on Monday and months fold their days; sums and rates recompute per period", () => {
  const days = daysBetween("2026-09-12", "2026-09-15").map((day, i) => composeDay({ day, shopify: { sessions: 100, addedToCart: 20 + i, reachedCheckout: 10, purchases: 5 }, orders: { purchases: 5, revenue: 1000 } }));
  const weeks = groupRows(days, "week");
  assert.deepEqual(weeks.map(w => w.key), ["2026-09-07", "2026-09-14"]); // Sat 12, Sun 13 belong to the week of Mon 7 Sept
  assert.equal(weeks[0].days.length, 2);
  assert.equal(weeks[1].visitors, 200);
  assert.equal(weeks[1].rates.conversion, 0.05);
  assert.equal(weeks[1].label, "Week of 14 Sep");
  const months = groupRows(days, "month");
  assert.equal(months.length, 1);
  assert.equal(months[0].label, "September 2026");
  assert.equal(months[0].revenue, 4000);
  const total = sumRows(days);
  assert.equal(total.visitors, 400);
  assert.equal(total.basis, "shopify");
});

test("orders belong to a funnel by landing page first, then by product, and never to two page funnels at once", () => {
  const nova = FUNNELS[0];
  const oceauraA = FUNNELS[1];
  assert.equal(landingPath("https://tigerbrandsglobal.com/pages/novahair-sales-staging?utm_source=fb"), "/pages/novahair-sales-staging");
  assert.equal(orderBelongsToFunnel(nova, { landingPages: ["https://tigerbrandsglobal.com/pages/novahair-sales-staging?x=1"], productHandles: [] }), true);
  assert.equal(orderBelongsToFunnel(nova, { landingPages: [null], productHandles: ["novahair-funnel-internal"] }), true);
  // bought from the OceAura page: the OceAura page's sale, even with a NovaHair bottle in it
  assert.equal(orderBelongsToFunnel(nova, { landingPages: ["/pages/oceaura-sales-staging"], productHandles: ["novahair-funnel-internal"] }), false);
  assert.equal(orderBelongsToFunnel(oceauraA, { landingPages: ["/pages/oceaura-sales-staging"], productHandles: ["novahair-funnel-internal"] }), true);
  assert.equal(orderBelongsToFunnel(oceauraA, { landingPages: [null], productHandles: ["amla-shampoo"] }), false);
});

test("Israel calendar days are used for instants", () => {
  assert.equal(israelDay("2026-09-18T22:30:00Z"), "2026-09-19"); // 01:30 in Israel
  assert.equal(israelDay("2026-09-18T20:59:00Z"), "2026-09-18");
  assert.equal(daysBetween("2026-08-30", "2026-09-02").join(","), "2026-08-30,2026-08-31,2026-09-01,2026-09-02");
});
