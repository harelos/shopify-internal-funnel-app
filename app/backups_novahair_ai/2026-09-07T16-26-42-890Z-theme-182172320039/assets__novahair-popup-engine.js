/**
 * NovaHair behavioural popup engine v2.
 *
 * Replaces the "show after N seconds" trigger with a behaviour model:
 *   - collects 26 signals about how the visitor is actually using the page
 *   - reduces them to three scores: engagement, abandonment risk, purchase intent
 *   - shows the popup only when engagement is real, abandonment looks imminent,
 *     and purchase intent is NOT high (we never interrupt someone converting)
 *   - records WHY every decision was made, so triggers can be judged later
 *
 * Requires novahair-popup-engine.config.js to be loaded first.
 *
 * Public surface (used by the harness and by the popup UI):
 *   window.NovaHairPopupEngine.getState()      -> full signal + score snapshot
 *   window.NovaHairPopupEngine.evaluate()      -> decision object
 *   window.NovaHairPopupEngine.onDecision(fn)  -> subscribe to show decisions
 *   window.NovaHairPopupEngine.reset()         -> clear per-visitor storage
 */
(function () {
  'use strict';

  var CFG = window.NovaHairPopupConfig;
  if (!CFG) {
    console.warn('[nh-popup] config missing; engine inert');
    return;
  }

  var STORAGE = {
    visitor:     'novahair_popup_visitor',
    visits:      'novahair_popup_visits',
    impressions: 'novahair_popup_impressions',
    dismissed:   'novahair_popup_dismissed_v2',
    qualified:   'novahair_popup_qualified',
    session:     'novahair_popup_session'   // sessionStorage, rotates per tab
  };

  var DAY_MS = 24 * 60 * 60 * 1000;

  /* =================================================================== *
   * Storage helpers
   * =================================================================== */

  function readJSON(store, key, fallback) {
    try {
      var raw = store.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJSON(store, key, value) {
    try { store.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
  }

  function randomId(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
  }

  function getVisitorId() {
    var id = null;
    try { id = localStorage.getItem(STORAGE.visitor); } catch (_) { /* noop */ }
    if (!id) {
      id = randomId('nhv');
      try { localStorage.setItem(STORAGE.visitor, id); } catch (_) { /* noop */ }
    }
    return id;
  }

  /* Session ID lives in sessionStorage so it genuinely rotates per tab.
   * The v1 engine stored this in localStorage, so "sessions" never ended. */
  function getSessionId() {
    var id = null;
    try { id = sessionStorage.getItem(STORAGE.session); } catch (_) { /* noop */ }
    if (!id) {
      id = randomId('nhs');
      try { sessionStorage.setItem(STORAGE.session, id); } catch (_) { /* noop */ }
    }
    return id;
  }

  /* Visit number increments once per tab session, not per page view. */
  function getVisitNumber() {
    var isNewSession = false;
    try { isNewSession = !sessionStorage.getItem('novahair_popup_visit_counted'); } catch (_) { /* noop */ }
    var visits = readJSON(localStorage, STORAGE.visits, { count: 0 });
    if (isNewSession) {
      visits.count = (visits.count || 0) + 1;
      writeJSON(localStorage, STORAGE.visits, visits);
      try { sessionStorage.setItem('novahair_popup_visit_counted', '1'); } catch (_) { /* noop */ }
    }
    return visits.count || 1;
  }

  /* =================================================================== *
   * Signal state
   * =================================================================== */

  var startedAt = Date.now();

  var S = {
    /* time */
    timeOnPage: 0,
    engagedTime: 0,
    idleTime: 0,
    lastInputAt: Date.now(),

    /* scroll */
    scrollDepth: 0,
    maxScrollDepth: 0,
    scrollDirection: 'none',
    scrollVelocity: 0,
    reachedDeep: false,
    returnedToTop: false,

    /* zones: name -> { seen, seenAt, dwellMs, visible } */
    zones: {},

    /* interaction */
    bundleClicked: false,
    shadeSelected: false,
    buyButtonClicked: false,

    /* commerce */
    cartItemCount: 0,
    addedToCart: false,
    inCheckout: false,
    hasPurchased: false,
    isSubscribed: false,

    /* visit */
    visitNumber: 1,
    pagesViewed: 1,
    isReturning: false,

    /* traffic */
    utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '', utmTerm: '',
    referrer: '',
    pageVariant: '',

    /* popup history */
    impressionsThisSession: 0,
    impressionsAllTime: 0,
    dismissedAt: 0,

    /* environment */
    device: 'desktop',
    os: 'other',
    browser: 'other',
    isVisible: true,
    desktopExitIntent: false
  };

  /* =================================================================== *
   * Environment detection
   * =================================================================== */

  function detectEnvironment() {
    var ua = navigator.userAgent || '';
    var w = window.innerWidth;

    S.device = w < 768 ? 'mobile' : (w < 1024 ? 'tablet' : 'desktop');
    if (/iPhone|iPad|iPod/i.test(ua)) S.os = 'ios';
    else if (/Android/i.test(ua)) S.os = 'android';
    else if (/Windows/i.test(ua)) S.os = 'windows';
    else if (/Mac OS/i.test(ua)) S.os = 'macos';

    /* In-app browsers behave differently and are worth separating. */
    if (/FBAN|FBAV/i.test(ua)) S.browser = 'facebook_inapp';
    else if (/Instagram/i.test(ua)) S.browser = 'instagram_inapp';
    else if (/CriOS|Chrome/i.test(ua)) S.browser = 'chrome';
    else if (/Safari/i.test(ua)) S.browser = 'safari';

    var params = new URLSearchParams(window.location.search);
    S.utmSource   = params.get('utm_source') || (/facebook|instagram/i.test(document.referrer) ? 'facebook' : 'organic');
    S.utmMedium   = params.get('utm_medium') || '';
    S.utmCampaign = params.get('utm_campaign') || '';
    S.utmContent  = params.get('utm_content') || '';
    S.utmTerm     = params.get('utm_term') || '';
    S.referrer    = document.referrer || '';

    /* Page variant, for when several sales-page versions are in test. */
    var variantEl = document.querySelector('[data-page-variant]');
    S.pageVariant = variantEl ? variantEl.getAttribute('data-page-variant') : (window.__NH_PAGE_VARIANT || '');

    S.visitNumber = getVisitNumber();
    S.isReturning = S.visitNumber > 1;
    S.inCheckout  = /\/(checkout|thank_you|orders)/.test(window.location.pathname);

    var pages = readJSON(sessionStorage, 'novahair_popup_pages', { n: 0 });
    pages.n = (pages.n || 0) + 1;
    writeJSON(sessionStorage, 'novahair_popup_pages', pages);
    S.pagesViewed = pages.n;

    var impressions = readJSON(localStorage, STORAGE.impressions, { total: 0 });
    S.impressionsAllTime = impressions.total || 0;
    var sessionImpressions = readJSON(sessionStorage, STORAGE.impressions, { n: 0 });
    S.impressionsThisSession = sessionImpressions.n || 0;

    var dismissed = readJSON(localStorage, STORAGE.dismissed, {});
    S.dismissedAt = dismissed.at || 0;

    var qualified = readJSON(localStorage, STORAGE.qualified, null);
    S.isSubscribed = Boolean(qualified);
  }

  /* =================================================================== *
   * Time and idle tracking
   * =================================================================== */

  var INPUT_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll', 'mousemove'];

  function markInput() { S.lastInputAt = Date.now(); }

  function startClock() {
    INPUT_EVENTS.forEach(function (evt) {
      window.addEventListener(evt, markInput, { passive: true });
    });

    document.addEventListener('visibilitychange', function () {
      S.isVisible = document.visibilityState === 'visible';
      if (S.isVisible) markInput();
      else evaluateAndMaybeShow('tab_hidden');
    });

    setInterval(function () {
      S.timeOnPage = (Date.now() - startedAt) / 1000;
      var idleFor = (Date.now() - S.lastInputAt) / 1000;
      /* Engaged time only accrues while the tab is visible AND the visitor
       * has done something in the last 5s. A parked tab earns nothing. */
      if (S.isVisible && idleFor < 5) S.engagedTime += 0.5;
      else S.idleTime += 0.5;
      evaluateAndMaybeShow('tick');
    }, 500);
  }

  /* =================================================================== *
   * Scroll tracking
   * =================================================================== */

  var lastScrollY = 0;
  var lastScrollAt = Date.now();
  var scrollQueued = false;
  var scrollSettleTimer = null;

  function scrollableHeight() {
    return Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
  }

  function onScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(function () {
      scrollQueued = false;
      var y = window.scrollY || window.pageYOffset || 0;
      var now = Date.now();
      var dt = Math.max(now - lastScrollAt, 1) / 1000;
      var dy = y - lastScrollY;

      S.scrollVelocity = Math.abs(dy) / dt;
      S.scrollDirection = dy > 2 ? 'down' : (dy < -2 ? 'up' : 'none');
      S.scrollDepth = y / scrollableHeight();
      if (S.scrollDepth > S.maxScrollDepth) S.maxScrollDepth = S.scrollDepth;

      if (S.maxScrollDepth >= CFG.abandon.returnToTop.deepAt) S.reachedDeep = true;
      if (S.reachedDeep && S.scrollDepth <= CFG.abandon.returnToTop.backTo) S.returnedToTop = true;

      lastScrollY = y;
      lastScrollAt = now;

      /* A fast upward flick is the mobile equivalent of exit intent.
       * Debounced: firing on the first fast frame would preempt the richer
       * deep-then-return-to-top pattern, which only completes once the
       * gesture lands near the top. Waiting lets the better trigger win. */
      if (S.scrollDirection === 'up' && S.scrollVelocity >= CFG.abandon.fastScrollUp.minVelocity) {
        window.clearTimeout(scrollSettleTimer);
        scrollSettleTimer = window.setTimeout(function () {
          evaluateAndMaybeShow('fast_scroll_up');
        }, CFG.abandon.fastScrollUp.settleMs || 450);
      }
    });
  }

  /* =================================================================== *
   * Zone observation
   * =================================================================== */

  function findZoneElement(spec) {
    if (spec.selector) {
      var el = document.querySelector(spec.selector);
      if (el) return el;
    }
    /* Fallback: match a heading by Hebrew text, so the engine survives
     * class-name churn across sales-page variants. */
    if (spec.textMatch && spec.textMatch.length) {
      var headings = document.querySelectorAll('h1,h2,h3,h4,[role="heading"]');
      for (var i = 0; i < headings.length; i++) {
        var text = (headings[i].textContent || '').trim();
        for (var j = 0; j < spec.textMatch.length; j++) {
          if (text.indexOf(spec.textMatch[j]) !== -1) {
            return headings[i].closest('section, div') || headings[i];
          }
        }
      }
    }
    return null;
  }

  function initZones() {
    Object.keys(CFG.zones).forEach(function (name) {
      S.zones[name] = { seen: false, seenAt: 0, dwellMs: 0, visible: false, found: false };
    });

    if (!('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var name = entry.target.getAttribute('data-nh-zone');
        var zone = S.zones[name];
        if (!zone) return;
        var nowVisible = entry.isIntersecting && entry.intersectionRatio >= CFG.zoneVisibilityRatio;
        if (nowVisible && !zone.visible) {
          zone.visible = true;
          zone.enteredAt = Date.now();
          if (!zone.seen) { zone.seen = true; zone.seenAt = Date.now(); }
        } else if (!nowVisible && zone.visible) {
          zone.visible = false;
          if (zone.enteredAt) zone.dwellMs += Date.now() - zone.enteredAt;
        }
      });
    }, { threshold: [0, CFG.zoneVisibilityRatio, 1] });

    Object.keys(CFG.zones).forEach(function (name) {
      var el = findZoneElement(CFG.zones[name]);
      if (!el) return;
      el.setAttribute('data-nh-zone', name);
      S.zones[name].found = true;
      observer.observe(el);
    });
  }

  function zoneDwellSeconds(name) {
    var zone = S.zones[name];
    if (!zone) return 0;
    var live = zone.visible && zone.enteredAt ? Date.now() - zone.enteredAt : 0;
    return (zone.dwellMs + live) / 1000;
  }

  /* =================================================================== *
   * Commerce and interaction signals
   * =================================================================== */

  function refreshCart() {
    if (S.inCheckout) return;
    window.fetch('/cart.js', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cart) {
        if (!cart) return;
        var count = cart.item_count || 0;
        if (count > S.cartItemCount) S.addedToCart = true;
        S.cartItemCount = count;
      })
      .catch(function () { /* cart state is a nice-to-have, never fatal */ });
  }

  function initInteractions() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('a,button,[role="button"],label,input') : null;
      if (!t) return;
      var hay = ((t.getAttribute('data-nh-intent') || '') + ' ' + (t.className || '') + ' ' + (t.textContent || '')).toLowerCase();

      if (/bundle|מארז|חבילה|tc-builder/.test(hay)) { S.bundleClicked = true; }
      if (/shade|גוון|swatch|color/.test(hay))       { S.shadeSelected = true; }
      if (/add.?to.?cart|הוספה לסל|לעגלה|buy|לרכישה|checkout|לתשלום/.test(hay)) {
        S.buyButtonClicked = true;
        setTimeout(refreshCart, 800);
      }
    }, { passive: true, capture: true });

    /* Shopify theme cart events, when the theme dispatches them. */
    ['cart:updated', 'cart:refresh', 'cart:added'].forEach(function (evt) {
      document.addEventListener(evt, function () { S.addedToCart = true; refreshCart(); });
    });

    /* Desktop exit intent. */
    var onExit = function (e) {
      if (S.device === 'desktop' && e.relatedTarget === null && e.clientY <= 12) {
        S.desktopExitIntent = true;
        evaluateAndMaybeShow('desktop_exit');
      }
    };
    document.addEventListener('mouseout', onExit);
    document.addEventListener('mouseleave', onExit);
  }

  /* =================================================================== *
   * Scoring
   * =================================================================== */

  function scoreEngagement() {
    var pts = 0;
    var why = [];
    var cfg = CFG.engagement;

    cfg.engagedSeconds.forEach(function (rule) {
      if (S.engagedTime >= rule.gte) { pts += rule.points; why.push('engaged' + rule.gte + 's'); }
    });
    cfg.scrollDepth.forEach(function (rule) {
      if (S.maxScrollDepth >= rule.gte) { pts += rule.points; why.push('depth' + Math.round(rule.gte * 100)); }
    });
    Object.keys(cfg.zoneSeen).forEach(function (name) {
      if (S.zones[name] && S.zones[name].seen) { pts += cfg.zoneSeen[name]; why.push('saw:' + name); }
    });
    if (S.shadeSelected) { pts += cfg.shadeSelected; why.push('shadePicked'); }
    if (S.bundleClicked) { pts += cfg.bundleClicked; why.push('bundleClicked'); }

    cfg.zoneDwellSeconds.zones.forEach(function (name) {
      if (zoneDwellSeconds(name) >= cfg.zoneDwellSeconds.threshold) {
        pts += cfg.zoneDwellSeconds.points;
        why.push('dwell:' + name);
      }
    });

    return { score: pts, reasons: why };
  }

  function scoreAbandon() {
    var pts = 0;
    var why = [];
    var cfg = CFG.abandon;
    var idleFor = (Date.now() - S.lastInputAt) / 1000;

    if (S.scrollDirection === 'up' && S.scrollVelocity >= cfg.fastScrollUp.minVelocity) {
      pts += cfg.fastScrollUp.points; why.push('fastScrollUp');
    }
    if (S.returnedToTop) { pts += cfg.returnToTop.points; why.push('returnToTop'); }
    if (S.zones.price && S.zones.price.seen && idleFor >= cfg.idleAfterPrice.idleSeconds) {
      pts += cfg.idleAfterPrice.points; why.push('idleAfterPrice');
    }
    if (idleFor >= cfg.idle.idleSeconds) { pts += cfg.idle.points; why.push('idle' + Math.round(idleFor) + 's'); }
    if (S.isReturning && !S.hasPurchased) { pts += cfg.repeatVisitNoBuy.points; why.push('repeatNoBuy'); }
    if (S.desktopExitIntent) { pts += cfg.desktopExitIntent.points; why.push('desktopExit'); }
    if (!S.isVisible) { pts += cfg.tabHidden.points; why.push('tabHidden'); }

    return { score: pts, reasons: why };
  }

  function scoreIntent() {
    var pts = 0;
    var why = [];
    var hard = false;
    var cfg = CFG.purchaseIntent;

    function apply(name, active) {
      var rule = cfg[name];
      if (!rule || !active) return;
      pts += rule.points;
      why.push(name);
      if (rule.hardSuppress) hard = true;
    }

    apply('addedToCart', S.addedToCart);
    apply('inCheckout', S.inCheckout);
    apply('cartHasItems', S.cartItemCount > 0);
    apply('buyButtonClicked', S.buyButtonClicked);
    apply('shadeSelected', S.shadeSelected);

    return { score: pts, reasons: why, hardSuppress: hard };
  }

  /* =================================================================== *
   * Decision
   * =================================================================== */

  function hardBlocks() {
    var blocks = [];
    var f = CFG.frequency;

    if (CFG.enabled !== true) blocks.push('disabled');
    if (S.isSubscribed) blocks.push('alreadySubscribed');
    if (S.hasPurchased) blocks.push('alreadyPurchased');
    if (f.blockedPaths.some(function (p) { return window.location.pathname.indexOf(p) === 0; })) blocks.push('blockedPath');
    if (S.impressionsThisSession >= f.maxImpressionsPerSession) blocks.push('sessionCap');
    if (S.impressionsAllTime >= f.maxImpressionsPerVisitor) blocks.push('visitorCap');

    if (S.dismissedAt) {
      var cooldown = (S.isSubscribed ? f.convertedCooldownDays : f.dismissCooldownDays) * DAY_MS;
      if (Date.now() - S.dismissedAt < cooldown) blocks.push('dismissCooldown');
    }
    if (CFG.gates.requireVisible && !S.isVisible) blocks.push('tabHidden');

    return blocks;
  }

  function activeGates() {
    var g = CFG.gates;
    var minEngaged = g.minEngagedSeconds;
    var minScore = g.minEngagementScore;

    /* Repeat visitors who have not bought get a lower bar. */
    if (S.visitNumber >= CFG.repeatVisitor.fromVisitNumber && !S.hasPurchased) {
      minEngaged = minEngaged * CFG.repeatVisitor.engagedSecondsMultiplier;
      minScore = CFG.repeatVisitor.minEngagementScore;
    }
    return { minEngaged: minEngaged, minScore: minScore };
  }

  function conditionMet(name) {
    switch (name) {
      case 'returnToTop':       return S.returnedToTop;
      case 'fastScrollUp':      return S.scrollDirection === 'up' && S.scrollVelocity >= CFG.abandon.fastScrollUp.minVelocity;
      case 'idleAfterPrice':    return Boolean(S.zones.price && S.zones.price.seen) &&
                                       (Date.now() - S.lastInputAt) / 1000 >= CFG.abandon.idleAfterPrice.idleSeconds;
      case 'desktopExitIntent': return S.desktopExitIntent;
      case 'bundleDwell':       return zoneDwellSeconds('bundles') >= CFG.engagement.zoneDwellSeconds.threshold;
      case 'noBundlePick':      return !S.bundleClicked && !S.shadeSelected;
      default:                  return false;
    }
  }

  function evaluate() {
    var eng = scoreEngagement();
    var aba = scoreAbandon();
    var intent = scoreIntent();
    var blocks = hardBlocks();
    var gates = activeGates();

    var decision = {
      show: false,
      trigger: null,
      reason: '',
      blockedBy: blocks,
      failedGates: [],
      engagementScore: eng.score,
      abandonScore: aba.score,
      intentScore: intent.score,
      engagementReasons: eng.reasons,
      abandonReasons: aba.reasons,
      intentReasons: intent.reasons,
      snapshot: {
        engagedTime: Math.round(S.engagedTime),
        timeOnPage: Math.round(S.timeOnPage),
        maxDepth: Math.round(S.maxScrollDepth * 100),
        depth: Math.round(S.scrollDepth * 100),
        direction: S.scrollDirection,
        velocity: Math.round(S.scrollVelocity),
        device: S.device,
        visit: S.visitNumber
      }
    };

    if (blocks.length) return decision;

    if (intent.hardSuppress || intent.score >= CFG.purchaseIntent.suppressAtOrAbove) {
      decision.blockedBy = ['purchaseIntent:' + intent.reasons.join('+')];
      return decision;
    }

    if (S.engagedTime < gates.minEngaged) decision.failedGates.push('engagedTime');
    if (S.timeOnPage < CFG.gates.minTimeOnPage) decision.failedGates.push('timeOnPage');
    if (S.maxScrollDepth < CFG.gates.minScrollDepth) decision.failedGates.push('scrollDepth');
    if (eng.score < gates.minScore) decision.failedGates.push('engagementScore');
    if (decision.failedGates.length) return decision;

    for (var i = 0; i < CFG.triggers.length; i++) {
      var t = CFG.triggers[i];
      if (t.enabled === false) continue;
      if (t.minAbandonScore && aba.score < t.minAbandonScore) continue;
      if (t.minEngagementScore && eng.score < t.minEngagementScore) continue;
      var allMet = t.requires.every(conditionMet);
      if (!allMet) continue;

      decision.show = true;
      decision.trigger = t.id;
      decision.reason = buildReason(t.id, eng, aba, decision.snapshot);
      break;
    }

    return decision;
  }

  /* Human-readable reason, e.g. "depth67+returnToTop+52s".
   * This is the field that makes the whole thing auditable later. */
  function buildReason(triggerId, eng, aba, snap) {
    var parts = [triggerId];
    parts.push('depth' + snap.maxDepth);
    aba.reasons.forEach(function (r) { if (parts.indexOf(r) === -1) parts.push(r); });
    parts.push(snap.engagedTime + 's');
    parts.push('e' + eng.score + '/a' + aba.score);
    return parts.join('+');
  }

  /* =================================================================== *
   * Reporting
   * =================================================================== */

  function track(eventName, payload) {
    var endpoint = CFG.reporting.endpoint;
    if (!endpoint) return;

    var sessionId = getSessionId();
    var visitorId = getVisitorId();
    /* Server requires eventKey to start with `${event}:${popupVersion}:`.
     * The v1 engine used popupId here, which failed validation every time. */
    var eventKey = eventName + ':' + CFG.version + ':' + sessionId + ':' + Date.now();

    var body = {
      event: eventName,
      visitorId: visitorId,
      explicitEventKey: eventKey,
      occurredAt: new Date().toISOString(),
      utm_source: S.utmSource,
      utm_medium: S.utmMedium,
      utm_campaign: S.utmCampaign,
      payload: Object.assign({
        popupVersion: CFG.version,
        sessionId: sessionId,
        path: window.location.pathname,
        device: S.device
      }, payload || {})
    };

    try {
      var json = JSON.stringify(body);
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([json], { type: 'application/json' }))) return;
      window.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
        credentials: 'same-origin'
      }).catch(function () { /* analytics must never block the page */ });
    } catch (_) { /* noop */ }
  }

  /* =================================================================== *
   * Orchestration
   * =================================================================== */

  var decided = false;
  var listeners = [];
  var suppressionReported = false;

  function evaluateAndMaybeShow(source) {
    if (decided) return;
    var decision = evaluate();

    if (CFG.debug) {
      console.log('[nh-popup]', source, decision.show ? 'SHOW' : 'hold',
        'e=' + decision.engagementScore, 'a=' + decision.abandonScore, 'i=' + decision.intentScore,
        decision.blockedBy.length ? 'blocked:' + decision.blockedBy.join(',') : '',
        decision.failedGates.length ? 'gates:' + decision.failedGates.join(',') : '');
    }

    if (!decision.show) {
      maybeReportSuppression(decision);
      return;
    }

    decided = true;
    recordImpression();

    track('popup_view', {
      trigger: decision.trigger,
      reason: decision.reason,
      engagementScore: decision.engagementScore,
      abandonScore: decision.abandonScore,
      intentScore: decision.intentScore,
      scrollDepth: decision.snapshot.maxDepth,
      engagedSeconds: decision.snapshot.engagedTime,
      visitNumber: S.visitNumber,
      pageVariant: S.pageVariant
    });

    listeners.forEach(function (fn) {
      try { fn(decision); } catch (e) { console.error('[nh-popup] listener failed', e); }
    });
  }

  /* One sampled snapshot per session of a NON-show, so we can see which
   * gates are silently blocking leads instead of guessing. */
  function maybeReportSuppression(decision) {
    if (!CFG.reporting.reportSuppressions || suppressionReported) return;
    if (S.timeOnPage < 45) return;
    if (Math.random() > CFG.reporting.suppressionSampleRate) return;
    suppressionReported = true;

    track('popup_eligible', {
      trigger: 'suppressed',
      reason: (decision.blockedBy.concat(decision.failedGates).join('+') || 'no_trigger_matched'),
      engagementScore: decision.engagementScore,
      abandonScore: decision.abandonScore,
      intentScore: decision.intentScore,
      scrollDepth: decision.snapshot.maxDepth,
      engagedSeconds: decision.snapshot.engagedTime,
      visitNumber: S.visitNumber
    });
  }

  function recordImpression() {
    var all = readJSON(localStorage, STORAGE.impressions, { total: 0 });
    all.total = (all.total || 0) + 1;
    writeJSON(localStorage, STORAGE.impressions, all);

    var sess = readJSON(sessionStorage, STORAGE.impressions, { n: 0 });
    sess.n = (sess.n || 0) + 1;
    writeJSON(sessionStorage, STORAGE.impressions, sess);

    S.impressionsAllTime = all.total;
    S.impressionsThisSession = sess.n;
  }

  /* =================================================================== *
   * Public API
   * =================================================================== */

  window.NovaHairPopupEngine = {
    getState: function () {
      return JSON.parse(JSON.stringify({
        signals: S,
        zoneDwell: Object.keys(S.zones).reduce(function (acc, n) { acc[n] = zoneDwellSeconds(n); return acc; }, {})
      }));
    },
    evaluate: evaluate,
    onDecision: function (fn) { listeners.push(fn); },
    markSubscribed: function () {
      writeJSON(localStorage, STORAGE.qualified, { at: Date.now() });
      S.isSubscribed = true;
    },
    markDismissed: function (method) {
      writeJSON(localStorage, STORAGE.dismissed, { at: Date.now() });
      S.dismissedAt = Date.now();
      track('popup_closed', { closeMethod: method || 'other' });
    },
    reset: function () {
      [STORAGE.visitor, STORAGE.visits, STORAGE.impressions, STORAGE.dismissed, STORAGE.qualified]
        .forEach(function (k) { try { localStorage.removeItem(k); } catch (_) {} });
      [STORAGE.session, STORAGE.impressions, 'novahair_popup_visit_counted', 'novahair_popup_pages']
        .forEach(function (k) { try { sessionStorage.removeItem(k); } catch (_) {} });
    },
    /* Test seam: let the harness drive signals directly. */
    __setSignal: function (key, value) { S[key] = value; }
  };

  /* =================================================================== *
   * Boot
   * =================================================================== */

  var booted = false;

  function boot() {
    if (booted) return;
    booted = true;
    if (CFG.enabled !== true) {
      if (CFG.debug) console.log('[nh-popup] disabled by runtime config');
      return;
    }
    detectEnvironment();
    initZones();
    initInteractions();
    startClock();
    window.addEventListener('scroll', onScroll, { passive: true });
    refreshCart();
    if (CFG.debug) console.log('[nh-popup] engine ready', S);
  }

  function bootWhenDocumentReady() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }

  var configReady = window.NovaHairPopupConfigReady;
  if (configReady && typeof configReady.then === 'function') {
    configReady.then(bootWhenDocumentReady, bootWhenDocumentReady);
  } else {
    bootWhenDocumentReady();
  }
})();
