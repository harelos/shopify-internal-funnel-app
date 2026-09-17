// @ts-check
import { buildExpandedItems } from "./composition.js";

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/** @type {CartTransformRunResult} */
const NO_CHANGES = { operations: [] };

/** Shopify expects money as a decimal string. */
function toAmount(minor) {
  return (minor / 100).toFixed(2);
}

/**
 * Expands each NOVASALE bundle line into its physical shade variants plus one
 * free kit, so CJ receives six ordinary products it already knows instead of a
 * bundle SKU it cannot decode.
 *
 * Any line we do not fully understand is left untouched, so an unrecognised or
 * unbalanced SKU degrades to today's behaviour rather than shipping the wrong
 * goods. Registered with blockOnFailure = false, a thrown error also fails open.
 *
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const lines = input?.cart?.lines ?? [];
  const operations = [];

  for (const line of lines) {
    const merchandise = line?.merchandise;
    if (!merchandise || merchandise.__typename !== "ProductVariant") continue;

    const perUnitAmount = line?.cost?.amountPerQuantity?.amount;
    if (perUnitAmount == null) continue;

    const items = buildExpandedItems(merchandise.sku, perUnitAmount);
    if (!items) continue;

    operations.push({
      expand: {
        cartLineId: line.id,
        expandedCartItems: items.map((item) => ({
          merchandiseId: item.merchandiseId,
          quantity: item.quantity,
          price: {
            adjustment: {
              fixedPricePerUnit: { amount: toAmount(item.priceMinor) },
            },
          },
        })),
      },
    });
  }

  return operations.length ? { operations } : NO_CHANGES;
}
