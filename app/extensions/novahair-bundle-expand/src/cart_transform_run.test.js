import test from "node:test";
import assert from "node:assert/strict";
import { cartTransformRun } from "./cart_transform_run.js";
import { FREE_KIT_VARIANT, COMPONENT_VARIANTS } from "./composition.js";

const bundleLine = (sku, amount = "239.00", id = "gid://shopify/CartLine/0") => ({
  id,
  quantity: 1,
  cost: { amountPerQuantity: { amount } },
  merchandise: { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/1", sku },
});

const totalMinor = (op) =>
  op.expand.expandedCartItems.reduce(
    (s, i) => s + Math.round(Number(i.price.adjustment.fixedPricePerUnit.amount) * 100) * i.quantity,
    0,
  );

test("uses the 2026-07 'expand' operation, not the deprecated 'lineExpand'", () => {
  const out = cartTransformRun({ cart: { lines: [bundleLine("NOVASALE-4-0-0-4-0-0")] } });
  assert.equal(out.operations.length, 1);
  assert.ok(out.operations[0].expand, "operation key must be `expand`");
  assert.equal(out.operations[0].lineExpand, undefined);
  assert.equal(out.operations[0].expand.cartLineId, "gid://shopify/CartLine/0");
});

test("expands a real 4-pack and charges exactly the bundle price", () => {
  const op = cartTransformRun({ cart: { lines: [bundleLine("NOVASALE-4-0-0-4-0-0")] } }).operations[0];
  assert.equal(totalMinor(op), 23900);
  const items = op.expand.expandedCartItems;
  assert.equal(items.find((i) => i.merchandiseId === COMPONENT_VARIANTS.lightBrown).quantity, 4);
  const kit = items.find((i) => i.merchandiseId === FREE_KIT_VARIANT);
  assert.equal(kit.quantity, 1);
  assert.equal(kit.price.adjustment.fixedPricePerUnit.amount, "0.00");
});

test("indivisible 6-pack reconciles, remainder on the kit", () => {
  const op = cartTransformRun({ cart: { lines: [bundleLine("NOVASALE-6-1-2-3-0-0")] } }).operations[0];
  assert.equal(totalMinor(op), 23900);
  const items = op.expand.expandedCartItems;
  assert.equal(items.find((i) => i.merchandiseId === FREE_KIT_VARIANT).price.adjustment.fixedPricePerUnit.amount, "0.02");
  const ids = items.map((i) => i.merchandiseId);
  assert.equal(new Set(ids).size, ids.length, "no duplicate merchandiseId");
});

test("leaves non-bundle and malformed lines untouched", () => {
  const other = {
    id: "gid://shopify/CartLine/9",
    quantity: 1,
    cost: { amountPerQuantity: { amount: "10.00" } },
    merchandise: { __typename: "ProductVariant", id: "x", sku: "REGULAR-SKU" },
  };
  assert.deepEqual(cartTransformRun({ cart: { lines: [other] } }), { operations: [] });
  // Shade counts do not add up to the pack size.
  assert.deepEqual(
    cartTransformRun({ cart: { lines: [bundleLine("NOVASALE-4-0-0-3-0-0")] } }),
    { operations: [] },
  );
});

test("expands only the bundle in a mixed cart", () => {
  const out = cartTransformRun({
    cart: {
      lines: [
        bundleLine("NOVASALE-2-0-1-1-0-0", "159.00", "gid://shopify/CartLine/a"),
        {
          id: "gid://shopify/CartLine/b",
          quantity: 2,
          cost: { amountPerQuantity: { amount: "20.00" } },
          merchandise: { __typename: "ProductVariant", id: "x", sku: "OTHER" },
        },
      ],
    },
  });
  assert.equal(out.operations.length, 1);
  assert.equal(out.operations[0].expand.cartLineId, "gid://shopify/CartLine/a");
  assert.equal(totalMinor(out.operations[0]), 15900);
});

test("survives malformed or missing input without throwing", () => {
  assert.deepEqual(cartTransformRun({}), { operations: [] });
  assert.deepEqual(cartTransformRun({ cart: {} }), { operations: [] });
  assert.deepEqual(cartTransformRun({ cart: { lines: [{ id: "1" }] } }), { operations: [] });
  assert.deepEqual(
    cartTransformRun({ cart: { lines: [{ id: "1", merchandise: { __typename: "CustomProduct" } }] } }),
    { operations: [] },
  );
  // Missing price must not produce a NaN amount.
  assert.deepEqual(
    cartTransformRun({
      cart: { lines: [{ id: "1", merchandise: { __typename: "ProductVariant", sku: "NOVASALE-4-4-0-0-0-0" } }] },
    }),
    { operations: [] },
  );
});
