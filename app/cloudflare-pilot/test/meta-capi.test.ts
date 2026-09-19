import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildPurchaseEvent, capiConfigFrom, hashed, matchQuality, normalisePhone, noteAttribute, orderEventId, sendMetaEvents } from "../src/lib/meta-capi.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const ORDER = {
  id: 6543210987,
  admin_graphql_api_id: "gid://shopify/Order/6543210987",
  created_at: "2026-09-19T17:37:00+03:00",
  currency: "ILS",
  current_total_price: "239.00",
  email: "  Shopper@Example.COM ",
  phone: "050-123-4567",
  browser_ip: "203.0.113.7",
  client_details: { user_agent: "Mozilla/5.0 (Linux; Android 13)" },
  customer: { id: 991, first_name: "Dana", last_name: "Levi" },
  billing_address: { city: "Tel Aviv", province_code: "TA", zip: "6120101", country_code: "IL" },
  note_attributes: [
    { name: "nova_fbp", value: "fb.1.1789000000.1234567890" },
    { name: "nova_fbc", value: "fb.1.1789000000.AbCdEf" },
    { name: "nova_visitor", value: "kmu8gndnrs0pq0yvw1c" },
  ],
  line_items: [{ variant_id: 51883475239207, quantity: 1, price: "239.00", title: "4 bottles" }],
  landing_site: "/pages/novahair-sales-staging?utm_source=facebook",
};

test("a purchase is built with every identifier hashed and none in the clear", () => {
  const event = buildPurchaseEvent(ORDER);
  assert.ok(!("error" in event));
  if ("error" in event) return;
  assert.equal(event.event_name, "Purchase");
  assert.equal(event.event_id, "6543210987");
  assert.equal(event.custom_data?.value, 239);
  assert.equal(event.custom_data?.currency, "ILS");
  // hashed, lowercased, trimmed
  assert.deepEqual(event.user_data.em, [sha("shopper@example.com")]);
  assert.deepEqual(event.user_data.fn, [sha("dana")]);
  assert.deepEqual(event.user_data.zp, [sha("6120101")]);
  // the click ids pass through as-is, which is what Meta wants
  assert.equal(event.user_data.fbc, "fb.1.1789000000.AbCdEf");
  assert.equal(event.user_data.fbp, "fb.1.1789000000.1234567890");
  // nothing identifying survives in the payload
  const wire = JSON.stringify(event).toLowerCase();
  for (const secret of ["shopper@example.com", "dana", "levi", "0501234567", "tel aviv"]) {
    assert.ok(!wire.includes(secret), `${secret} must not reach the wire in the clear`);
  }
});

test("Israeli phone numbers reach Meta as digits with a country code", () => {
  assert.equal(normalisePhone("050-123-4567"), "972501234567");
  assert.equal(normalisePhone("+972 50 123 4567"), "972501234567");
  assert.equal(normalisePhone("00972501234567"), "972501234567");
  assert.equal(normalisePhone("501234567"), "972501234567");
  assert.equal(normalisePhone(""), undefined);
  assert.equal(normalisePhone("12"), undefined);
});

test("the event id is the Shopify order id, so the browser pixel's purchase dedupes against it", () => {
  assert.equal(orderEventId(ORDER), "6543210987");
  assert.equal(orderEventId({ admin_graphql_api_id: "gid://shopify/Order/42" }), "42");
  assert.equal(orderEventId({}), undefined);
});

test("cart attributes carry the click ids and the visitor key off the page", () => {
  assert.equal(noteAttribute(ORDER, "nova_fbp"), "fb.1.1789000000.1234567890");
  assert.equal(noteAttribute(ORDER, "nope"), undefined);
  const event = buildPurchaseEvent(ORDER);
  if ("error" in event) return assert.fail(event.error);
  assert.deepEqual(event.user_data.external_id, [sha("kmu8gndnrs0pq0yvw1c")]);
});

test("an order with no total or no id is refused rather than sent", () => {
  assert.ok("error" in buildPurchaseEvent({ ...ORDER, current_total_price: "0", total_price: "0" }));
  assert.ok("error" in buildPurchaseEvent({ ...ORDER, id: undefined, admin_graphql_api_id: undefined }));
});

test("match quality counts the signals present, never their values", () => {
  const rich = buildPurchaseEvent(ORDER);
  const bare = buildPurchaseEvent({ id: 7, current_total_price: "100", currency: "ILS" });
  if ("error" in rich || "error" in bare) return assert.fail("both should build");
  assert.ok(matchQuality(rich).score > matchQuality(bare).score);
  assert.ok(matchQuality(rich).fields.includes("em"));
  assert.ok(!JSON.stringify(matchQuality(rich)).includes("shopper"));
});

test("sending is off unless it is switched on, and a refusal never throws", async () => {
  const event = buildPurchaseEvent(ORDER);
  if ("error" in event) return assert.fail(event.error);
  const off = capiConfigFrom(key => ({ META_PIXEL_ID: "1", META_ACCESS_TOKEN: "t" }[key] ?? ""));
  assert.equal(off.enabled, false);
  assert.deepEqual(await sendMetaEvents([event], off), { sent: false, skipped: "disabled" });

  const on = capiConfigFrom(key => ({ META_PIXEL_ID: "696602246601325", META_ACCESS_TOKEN: "t", META_CAPI_ENABLED: "true", META_CAPI_TEST_CODE: "TEST123" }[key] ?? ""));
  let seen: any = null;
  const ok = await sendMetaEvents([event], on, (async (_url: string, init: any) => {
    seen = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ events_received: 1 }) };
  }) as unknown as typeof fetch);
  assert.deepEqual(ok, { sent: true, received: 1 });
  assert.equal(seen.test_event_code, "TEST123");
  assert.equal(seen.data[0].event_id, "6543210987");

  const failed = await sendMetaEvents([event], on, (async () => { throw new Error("network down"); }) as unknown as typeof fetch);
  assert.equal(failed.sent, false);
  assert.match(String(failed.error), /network down/);
});
