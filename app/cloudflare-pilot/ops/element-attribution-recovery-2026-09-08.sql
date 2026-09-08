-- One-time, idempotent analytics-only recovery for Shopify orders #4417 and #4418.
-- Evidence chain: Shopify paid order checkout/cart tokens matched the same PostHog
-- visitor sessions that emitted the recorded D1 ElementAssignment IDs below.
-- This file does not call the webhook endpoint and cannot trigger fulfillment.

INSERT INTO "CartElementAttribution" (
  "id", "shopId", "cartToken", "visitorId", "assignmentId",
  "experimentId", "variantId", "slotId", "capturedAt"
) VALUES
  ('recover-cart-4417', '5f07ee02-a2e6-41b6-9dca-de801e54615f', 'hWNGZwzghba0PrMBxF0L3g3f', 'fee9d996-fbe2-420d-9f08-e6b4f14a407b', '6a3fd1af-d186-4669-a19f-812c777758b3', '257ac800-9f14-4215-9b06-a65017cdf30d', 'a71ce0e4-9743-462d-bfe6-fdde870112bc', '6a044fca-f825-4e08-85e3-30ad858cdfab', '2026-09-08T02:48:43.756Z'),
  ('recover-cart-4418', '5f07ee02-a2e6-41b6-9dca-de801e54615f', 'hWNGa6uRtc3k2QREIVMkeXel', 'd0bfdf13-088e-40fc-9f76-def9ac4082f3', '8c96ecc4-8627-4f72-8d65-392272b90d05', '257ac800-9f14-4215-9b06-a65017cdf30d', '8cff1654-65dd-423b-ad04-a270e60d37cf', '6a044fca-f825-4e08-85e3-30ad858cdfab', '2026-09-08T04:26:15.637Z')
ON CONFLICT("cartToken", "experimentId") DO UPDATE SET
  "visitorId" = excluded."visitorId",
  "assignmentId" = excluded."assignmentId",
  "variantId" = excluded."variantId",
  "slotId" = excluded."slotId";

INSERT INTO "CheckoutAttribution" (
  "id", "shopId", "checkoutToken", "visitorId", "startedAt", "completedAt", "confidence"
) VALUES
  ('recover-checkout-4417', '5f07ee02-a2e6-41b6-9dca-de801e54615f', '3c1480c0bccaf08e8c8ec7fb1d4442b8', 'fee9d996-fbe2-420d-9f08-e6b4f14a407b', '2026-09-08T02:48:43.756Z', '2026-09-08T03:00:03.000Z', 'HIGH'),
  ('recover-checkout-4418', '5f07ee02-a2e6-41b6-9dca-de801e54615f', '43229a1898259b0b4cf9eee3cd543e08', 'd0bfdf13-088e-40fc-9f76-def9ac4082f3', '2026-09-08T04:26:15.637Z', '2026-09-08T04:28:35.000Z', 'HIGH')
ON CONFLICT("checkoutToken") DO UPDATE SET
  "visitorId" = excluded."visitorId",
  "completedAt" = excluded."completedAt",
  "confidence" = 'HIGH';

INSERT INTO "CheckoutElementAttribution" (
  "id", "shopId", "checkoutToken", "visitorId", "assignmentId",
  "experimentId", "variantId", "slotId", "capturedAt"
) VALUES
  ('recover-checkout-element-4417', '5f07ee02-a2e6-41b6-9dca-de801e54615f', '3c1480c0bccaf08e8c8ec7fb1d4442b8', 'fee9d996-fbe2-420d-9f08-e6b4f14a407b', '6a3fd1af-d186-4669-a19f-812c777758b3', '257ac800-9f14-4215-9b06-a65017cdf30d', 'a71ce0e4-9743-462d-bfe6-fdde870112bc', '6a044fca-f825-4e08-85e3-30ad858cdfab', '2026-09-08T03:00:03.000Z'),
  ('recover-checkout-element-4418', '5f07ee02-a2e6-41b6-9dca-de801e54615f', '43229a1898259b0b4cf9eee3cd543e08', 'd0bfdf13-088e-40fc-9f76-def9ac4082f3', '8c96ecc4-8627-4f72-8d65-392272b90d05', '257ac800-9f14-4215-9b06-a65017cdf30d', '8cff1654-65dd-423b-ad04-a270e60d37cf', '6a044fca-f825-4e08-85e3-30ad858cdfab', '2026-09-08T04:28:35.000Z')
ON CONFLICT("checkoutToken", "experimentId") DO UPDATE SET
  "visitorId" = excluded."visitorId",
  "assignmentId" = excluded."assignmentId",
  "variantId" = excluded."variantId",
  "slotId" = excluded."slotId";

INSERT INTO "OrderAttribution" (
  "id", "shopId", "shopifyOrderGid", "checkoutToken", "currency",
  "grossAmount", "netRevenueAmount", "refundedAmount", "status", "confidence",
  "isTest", "discountCodes", "popupAttributed", "paidAt", "updatedAt"
) VALUES
  ('recover-order-4417', '5f07ee02-a2e6-41b6-9dca-de801e54615f', 'gid://shopify/Order/7468251087143', '3c1480c0bccaf08e8c8ec7fb1d4442b8', 'ILS', 319.68, 319.68, 0, 'PAID', 'HIGH', 0, '[]', 0, '2026-09-08T03:00:03.000Z', '2026-09-08T03:02:45.000Z'),
  ('recover-order-4418', '5f07ee02-a2e6-41b6-9dca-de801e54615f', 'gid://shopify/Order/7468342214951', '43229a1898259b0b4cf9eee3cd543e08', 'ILS', 239.00, 239.00, 0, 'PAID', 'HIGH', 0, '[]', 0, '2026-09-08T04:28:35.000Z', '2026-09-08T04:28:42.000Z')
ON CONFLICT("shopifyOrderGid") DO UPDATE SET
  "checkoutToken" = excluded."checkoutToken",
  "currency" = excluded."currency",
  "grossAmount" = excluded."grossAmount",
  "netRevenueAmount" = excluded."netRevenueAmount",
  "refundedAmount" = excluded."refundedAmount",
  "status" = excluded."status",
  "confidence" = 'HIGH',
  "isTest" = 0,
  "paidAt" = excluded."paidAt",
  "updatedAt" = excluded."updatedAt";

INSERT INTO "OrderElementAttribution" (
  "id", "shopId", "orderAttributionId", "checkoutAttributionId", "assignmentId",
  "experimentId", "variantId", "slotId", "attributedAt"
) SELECT
  'recover-order-element-4417',
  '5f07ee02-a2e6-41b6-9dca-de801e54615f',
  orders."id",
  checkouts."id",
  '6a3fd1af-d186-4669-a19f-812c777758b3',
  '257ac800-9f14-4215-9b06-a65017cdf30d',
  'a71ce0e4-9743-462d-bfe6-fdde870112bc',
  '6a044fca-f825-4e08-85e3-30ad858cdfab',
  '2026-09-08T03:00:03.000Z'
FROM "OrderAttribution" orders
JOIN "CheckoutElementAttribution" checkouts
  ON checkouts."checkoutToken" = '3c1480c0bccaf08e8c8ec7fb1d4442b8'
 AND checkouts."experimentId" = '257ac800-9f14-4215-9b06-a65017cdf30d'
WHERE orders."shopifyOrderGid" = 'gid://shopify/Order/7468251087143'
UNION ALL
SELECT
  'recover-order-element-4418',
  '5f07ee02-a2e6-41b6-9dca-de801e54615f',
  orders."id",
  checkouts."id",
  '8c96ecc4-8627-4f72-8d65-392272b90d05',
  '257ac800-9f14-4215-9b06-a65017cdf30d',
  '8cff1654-65dd-423b-ad04-a270e60d37cf',
  '6a044fca-f825-4e08-85e3-30ad858cdfab',
  '2026-09-08T04:28:35.000Z'
FROM "OrderAttribution" orders
JOIN "CheckoutElementAttribution" checkouts
  ON checkouts."checkoutToken" = '43229a1898259b0b4cf9eee3cd543e08'
 AND checkouts."experimentId" = '257ac800-9f14-4215-9b06-a65017cdf30d'
WHERE orders."shopifyOrderGid" = 'gid://shopify/Order/7468342214951'
ON CONFLICT("orderAttributionId", "experimentId") DO UPDATE SET
  "checkoutAttributionId" = excluded."checkoutAttributionId",
  "assignmentId" = excluded."assignmentId",
  "variantId" = excluded."variantId",
  "slotId" = excluded."slotId";
