/**
 * NovaHair behavioural popup engine - tuning config.
 *
 * This file is pure data. Every threshold the engine uses lives here so the
 * rules can be tuned from Clarity findings without touching engine logic.
 *
 * Load this BEFORE novahair-popup-engine.js.
 */
window.NovaHairPopupConfig = {
  version: 'novahair_popup_v2',

  /* ------------------------------------------------------------------ *
   * 1. Zones - which regions of the page we care about.
   *
   * Each zone is matched by `selector` first; if nothing matches we fall
   * back to `textMatch`, scanning headings for those Hebrew strings. That
   * keeps the engine working across sales-page variants whose class names
   * differ, without hardcoding one theme's DOM.
   * ------------------------------------------------------------------ */
  zones: {
    price:    { selector: '[data-zone="price"], .price, .product__price',        textMatch: ['מחיר', '₪'] },
    bundles:  { selector: '[data-zone="bundles"], .bundle-cards, .tc-builder',    textMatch: ['חבילות', 'מארזים', 'מארז'] },
    shades:   { selector: '[data-zone="shades"], .shade-picker, .color-swatches', textMatch: ['גוון', 'גוונים'] },
    reviews:  { selector: '[data-zone="reviews"], .reviews, .testimonials',       textMatch: ['ביקורות', 'המלצות'] },
    shipping: { selector: '[data-zone="shipping"], .shipping-info',               textMatch: ['משלוח'] },
    faq:      { selector: '[data-zone="faq"], .faq, details.faq-item',            textMatch: ['שאלות נפוצות', 'שאלות'] }
  },

  /* Fraction of a zone that must be visible before it counts as "seen". */
  zoneVisibilityRatio: 0.4,

  /* ------------------------------------------------------------------ *
   * 2. Engagement scoring - how genuinely interested she looks.
   * ------------------------------------------------------------------ */
  engagement: {
    engagedSeconds:  [ { gte: 30, points: 1 }, { gte: 60, points: 2 } ],
    scrollDepth:     [ { gte: 0.50, points: 2 }, { gte: 0.75, points: 1 } ],
    zoneSeen:        { bundles: 2, price: 2, shades: 2, reviews: 1, faq: 1, shipping: 1 },
    shadeSelected:   3,
    bundleClicked:   2,
    /* Dwelling in a zone without acting is interest, not satisfaction. */
    zoneDwellSeconds: { threshold: 8, zones: ['bundles', 'price'], points: 2 }
  },

  /* ------------------------------------------------------------------ *
   * 3. Abandonment risk - how much she looks like she is leaving.
   * ------------------------------------------------------------------ */
  abandon: {
    /* Fast upward scroll: px/sec travelled toward the top of the page.
     * settleMs lets the gesture finish before we decide, so the richer
     * return-to-top pattern can win instead of being preempted by this. */
    fastScrollUp:      { minVelocity: 900, points: 3, settleMs: 450 },
    /* Went deep, then bounced back to the top. Strong signal on mobile. */
    returnToTop:       { deepAt: 0.60, backTo: 0.15, points: 3 },
    /* Stopped interacting after having seen the price. */
    idleAfterPrice:    { idleSeconds: 12, points: 2 },
    /* General inactivity while the tab is still focused. */
    idle:              { idleSeconds: 20, points: 2 },
    /* Repeat visitor who still has not bought. */
    repeatVisitNoBuy:  { points: 1 },
    /* Desktop only - mouse leaves through the top of the viewport. */
    desktopExitIntent: { points: 4 },
    /* Tab hidden (app switch / about to close). */
    tabHidden:         { points: 2 }
  },

  /* ------------------------------------------------------------------ *
   * 4. Purchase intent - used ONLY to suppress. We never interrupt a
   *    shopper who is actively converting.
   * ------------------------------------------------------------------ */
  purchaseIntent: {
    addedToCart:       { points: 10, hardSuppress: true },
    inCheckout:        { points: 10, hardSuppress: true },
    cartHasItems:      { points: 6,  hardSuppress: true },
    buyButtonClicked:  { points: 4,  hardSuppress: false },
    shadeSelected:     { points: 2,  hardSuppress: false },
    /* Above this score we stay silent even if abandon risk is high. */
    suppressAtOrAbove: 6
  },

  /* ------------------------------------------------------------------ *
   * 5. Gates - ALL of these must pass before any trigger is considered.
   * ------------------------------------------------------------------ */
  gates: {
    minEngagedSeconds: 30,   // real interaction time, not tab-open time
    minTimeOnPage:     20,   // wall-clock floor regardless of engagement
    minScrollDepth:    0.35, // must have seen a meaningful part of the page
    minEngagementScore: 3,
    requireVisible:    true  // never fire while the tab is hidden
  },

  /* ------------------------------------------------------------------ *
   * 6. Triggers - ANY one of these fires, once the gates pass and
   *    nothing is suppressing.
   * ------------------------------------------------------------------ */
  triggers: [
    { id: 'return_to_top',     requires: ['returnToTop'],                minAbandonScore: 3 },
    { id: 'fast_scroll_up',    requires: ['fastScrollUp'],               minAbandonScore: 3 },
    { id: 'idle_after_price',  requires: ['idleAfterPrice'],             minAbandonScore: 2 },
    { id: 'desktop_exit',      requires: ['desktopExitIntent'],          minAbandonScore: 4 },
    { id: 'bundle_hesitation', requires: ['bundleDwell', 'noBundlePick'], minAbandonScore: 2 },
    /* Safety net: deeply engaged but drifting, with no sharper signal. */
    { id: 'engaged_drift',     requires: [],                             minAbandonScore: 5, minEngagementScore: 6 }
  ],

  /* ------------------------------------------------------------------ *
   * 7. Frequency and suppression.
   * ------------------------------------------------------------------ */
  frequency: {
    maxImpressionsPerSession: 1,
    maxImpressionsPerVisitor: 3,
    dismissCooldownDays:      7,   // after a dismiss
    convertedCooldownDays:    365, // after a successful lead
    /* Never show on these paths. */
    blockedPaths: ['/checkout', '/cart', '/account', '/challenge', '/thank_you', '/orders']
  },

  /* Be more aggressive on a repeat visit who still has not converted. */
  repeatVisitor: {
    fromVisitNumber:   2,
    engagedSecondsMultiplier: 0.7,
    minEngagementScore: 2
  },

  /* ------------------------------------------------------------------ *
   * 8. Reporting.
   * ------------------------------------------------------------------ */
  reporting: {
    endpoint: '/apps/funnels/api/track',
    /* Emit a decision snapshot even when we choose NOT to show. This is
     * what lets us learn which gates are actually blocking leads. */
    reportSuppressions: true,
    /* Sample rate for suppression events (1 = all). Impressions always send. */
    suppressionSampleRate: 0.25
  },

  /* Console tracing. Set true in the harness, false in production. */
  debug: false
};
