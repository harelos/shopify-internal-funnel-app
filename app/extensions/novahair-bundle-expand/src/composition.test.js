import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBundleSku,
  buildExpandedItems,
  itemsTotalMinor,
  allocate,
  COMPONENT_VARIANTS,
  FREE_KIT_VARIANT,
} from "./composition.js";

test("parses the real order SKUs from the rescue batch", () => {
  assert.deepEqual(parseBundleSku("NOVASALE-2-0-1-1-0-0"), {
    bundleSize: 2,
    counts: { darkBrown: 1, lightBrown: 1 },
  });
  assert.deepEqual(parseBundleSku("NOVASALE-4-0-0-4-0-0"), {
    bundleSize: 4,
    counts: { lightBrown: 4 },
  });
  assert.deepEqual(parseBundleSku("NOVASALE-4-4-0-0-0-0"), {
    bundleSize: 4,
    counts: { black: 4 },
  });
});

test("fails closed on malformed or unbalanced SKUs", () => {
  // Shade counts must equal the bundle size, or we do not know what was bought.
  assert.equal(parseBundleSku("NOVASALE-4-0-0-3-0-0"), null);
  assert.equal(parseBundleSku("NOVASALE-4-1-1-1-1-1"), null);
  assert.equal(parseBundleSku("NOVASALE-3-0-0-3-0-0"), null, "3-pack is not offered");
  assert.equal(parseBundleSku("NOVASALE-4-0-0-4-0"), null, "too few groups");
  assert.equal(parseBundleSku("SOMETHINGELSE-4-0-0-4-0-0"), null);
  assert.equal(parseBundleSku(""), null);
  assert.equal(parseBundleSku(null), null);
  assert.equal(parseBundleSku(undefined), null);
});

test("every one of the 295 live combinations parses and reconciles exactly", () => {
  const shades = 5;
  let checked = 0;
  for (const size of [2, 4, 6]) {
    // enumerate combinations-with-repetition of `size` bottles across 5 shades
    const walk = (idx, left, acc) => {
      if (idx === shades - 1) {
        const counts = [...acc, left];
        const sku = `NOVASALE-${size}-${counts.join("-")}`;
        const parsed = parseBundleSku(sku);
        assert.ok(parsed, `should parse ${sku}`);

        const items = buildExpandedItems(sku, 239.0);
        assert.ok(items, `should expand ${sku}`);
        // Money must reconcile to the cent, every time.
        assert.equal(itemsTotalMinor(items), 23900, `total mismatch for ${sku}`);
        // Exactly one free kit. It carries only the sub-cent remainder, so it is
        // free or within a few agorot of free.
        const kits = items.filter((i) => i.merchandiseId === FREE_KIT_VARIANT);
        assert.equal(kits.length, 1);
        assert.equal(kits[0].quantity, 1);
        assert.ok(kits[0].priceMinor >= 0 && kits[0].priceMinor < size, `kit price out of range for ${sku}`);

        // No merchandiseId may appear twice: fixedPricePerUnit is uniform per
        // line, and duplicate ids in one expand are not a documented guarantee.
        const ids = items.map((i) => i.merchandiseId);
        assert.equal(new Set(ids).size, ids.length, `duplicate merchandiseId for ${sku}`);
        // Bottle count must equal the pack size.
        const bottles = items
          .filter((i) => i.merchandiseId !== FREE_KIT_VARIANT)
          .reduce((s, i) => s + i.quantity, 0);
        assert.equal(bottles, size, `bottle count mismatch for ${sku}`);
        checked += 1;
        return;
      }
      for (let q = 0; q <= left; q += 1) walk(idx + 1, left - q, [...acc, q]);
    };
    walk(0, size, []);
  }
  assert.equal(checked, 295, "should cover exactly the 295 live variants");
});

test("indivisible price: remainder lands on the kit, shades stay uniform", () => {
  // 23900 / 6 = 3983 remainder 2.
  const items = buildExpandedItems("NOVASALE-6-6-0-0-0-0", 239.0);
  assert.equal(itemsTotalMinor(items), 23900);

  const black = items.filter((i) => i.merchandiseId === COMPONENT_VARIANTS.black);
  assert.equal(black.length, 1, "one line per shade, never split");
  assert.equal(black[0].quantity, 6);
  assert.equal(black[0].priceMinor, 3983);

  const kit = items.find((i) => i.merchandiseId === FREE_KIT_VARIANT);
  assert.equal(kit.priceMinor, 2, "kit absorbs the 2 leftover agorot");
});

test("never emits the same merchandiseId twice", () => {
  for (const sku of [
    "NOVASALE-6-1-2-3-0-0",
    "NOVASALE-6-3-3-0-0-0",
    "NOVASALE-6-2-2-2-0-0",
    "NOVASALE-4-1-1-1-1-0",
    "NOVASALE-2-1-1-0-0-0",
  ]) {
    const ids = buildExpandedItems(sku, 239.0).map((i) => i.merchandiseId);
    assert.equal(new Set(ids).size, ids.length, `duplicate id for ${sku}`);
  }
});

test("the 3+3 split that has no uniform solution still reconciles", () => {
  // qty [3,3] with remainder 2: no integer per-line adjustment works, which is
  // exactly why the remainder goes to the kit instead.
  const items = buildExpandedItems("NOVASALE-6-3-3-0-0-0", 239.0);
  assert.equal(itemsTotalMinor(items), 23900);
  assert.equal(items.filter((i) => i.merchandiseId !== FREE_KIT_VARIANT).length, 2);
});

test("allocate distributes remainder one minor unit at a time", () => {
  assert.deepEqual(allocate(100, 4), [25, 25, 25, 25]);
  assert.deepEqual(allocate(23900, 6), [3984, 3984, 3983, 3983, 3983, 3983]);
  assert.equal(allocate(23900, 6).reduce((a, b) => a + b, 0), 23900);
  assert.deepEqual(allocate(10, 0), []);
});

test("mixed shades keep their exact per-shade quantities", () => {
  const items = buildExpandedItems("NOVASALE-6-1-2-3-0-0", 239.0);
  const qty = (v) =>
    items.filter((i) => i.merchandiseId === v).reduce((s, i) => s + i.quantity, 0);
  assert.equal(qty(COMPONENT_VARIANTS.black), 1);
  assert.equal(qty(COMPONENT_VARIANTS.darkBrown), 2);
  assert.equal(qty(COMPONENT_VARIANTS.lightBrown), 3);
  assert.equal(qty(COMPONENT_VARIANTS.purple), 0);
  assert.equal(qty(COMPONENT_VARIANTS.red), 0);
  assert.equal(itemsTotalMinor(items), 23900);
});

test("a zero-priced bundle still expands without negative money", () => {
  const items = buildExpandedItems("NOVASALE-2-2-0-0-0-0", 0);
  assert.equal(itemsTotalMinor(items), 0);
  assert.ok(items.every((i) => i.priceMinor >= 0));
});
