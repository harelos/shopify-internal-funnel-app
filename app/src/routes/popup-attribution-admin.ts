import { Router } from "express";
import prisma from "../lib/db.js";
import { summarizePopupAttribution } from "../lib/popup-attribution.js";

const router = Router();

function shopDomain(): string {
  return String(process.env.SHOP_DOMAIN || "local-dev.myshopify.com").trim().toLowerCase();
}

router.get("/popups/attribution", async (req, res) => {
  try {
    const campaignKey = typeof req.query.campaignKey === "string" ? req.query.campaignKey.trim().slice(0, 120) : "";
    const where = {
      shopDomain: shopDomain(),
      ...(campaignKey ? { campaignKey } : {}),
    };
    const assignments = await prisma.popupExperimentAssignment.findMany({
      where,
      orderBy: { assignedAt: "desc" },
      take: 5000,
    });
    const assignmentIds = assignments.map(assignment => assignment.id);
    const conversions = assignmentIds.length
      ? await prisma.popupCheckoutConversion.findMany({
          where: { popupAssignmentId: { in: assignmentIds } },
          orderBy: { checkoutStartedAt: "desc" },
          take: 10000,
        })
      : [];

    const summary = summarizePopupAttribution(
      assignments.map(assignment => ({
        id: assignment.id,
        group: assignment.group === "HOLDOUT" ? "HOLDOUT" : "POPUP",
        variantKey: assignment.variantKey,
      })),
      conversions.map(conversion => ({
        popupAssignmentId: conversion.popupAssignmentId,
        checkoutToken: conversion.checkoutToken,
        checkoutStartedAt: conversion.checkoutStartedAt,
        checkoutCompletedAt: conversion.checkoutCompletedAt,
        shopifyOrderGid: conversion.shopifyOrderGid,
        netRevenueAmount: conversion.netRevenueAmount,
        currency: conversion.currency,
        orderStatus: conversion.orderStatus,
      })),
    );

    const campaigns = await prisma.popupCampaign.findMany({
      where: { shopDomain: shopDomain() },
      select: { key: true, name: true, experimentVersion: true, status: true },
      orderBy: { updatedAt: "desc" },
    });

    return res.json({
      shopDomain: shopDomain(),
      campaignKey: campaignKey || null,
      summary,
      campaigns,
      recentConversions: conversions.slice(0, 50).map(conversion => ({
        id: conversion.id,
        popupAssignmentId: conversion.popupAssignmentId,
        checkoutStartedAt: conversion.checkoutStartedAt,
        checkoutCompletedAt: conversion.checkoutCompletedAt,
        shopifyOrderGid: conversion.shopifyOrderGid,
        currency: conversion.currency,
        netRevenueAmount: conversion.netRevenueAmount,
        orderStatus: conversion.orderStatus,
        verifiedAt: conversion.verifiedAt,
        source: conversion.source,
        isTest: conversion.isTest,
      })),
      verification: {
        checkoutLink: "SIGNED_POPUP_SESSION + SHOPIFY_PIXEL",
        purchaseTruth: "SHOPIFY_WEBHOOK_VERIFIED",
        profitTruth: "NOT_CONNECTED_YET",
        productionPopupRendering: false,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Popup attribution analytics failed" });
  }
});

export default router;
