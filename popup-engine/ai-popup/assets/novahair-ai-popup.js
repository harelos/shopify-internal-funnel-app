/**
 * NovaHair AI concierge popup - runtime.
 *
 * Renders the conversation defined in novahair-ai-flows.js, driven by the
 * behavioural engine's exit decision.
 *
 * Analytics contract: EVERY step is logged with a stable stepId, what was
 * shown, what she chose or typed, and how long she took. That is what makes
 * each step independently analysable and improvable later.
 *
 * The browser compresses the selected photo before a short-lived ZDR vision
 * request. A conservative local matcher remains available if that request is
 * unavailable; neither path writes the photo to application storage.
 */
(function () {
  'use strict';

  var F = window.NovaHairAIFlows;
  if (!F) { console.warn('[nhai] flows missing'); return; }
  var FACTS = window.NovaHairFacts;
  if (!FACTS) { console.warn('[nhai] facts missing; refusing to render unverified numbers'); return; }

  var OPTS = window.NovaHairAIOptions || {};
  var ENDPOINT = OPTS.endpoint || '/apps/funnels/api/track';
  var AI_ENDPOINT = OPTS.aiEndpoint || '/apps/funnels/api/ai-chat';
  var SHADE_ENDPOINT = OPTS.shadeEndpoint || '/apps/funnels/api/ai-shade';
  var TYPING_MS = OPTS.typingMs != null ? OPTS.typingMs : 900;

  var root = null, logEl = null, footEl = null;
  var convId = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  var stepIndex = 0;
  var stepStartedAt = 0;
  var currentNode = null;
  var context = {
    shadeKey: null, shadeLabel: null, tags: [], angle: 'default',
    name: '', isReturning: false, daysSinceLastOrder: null,
    intent: 'prospect', mainConcern: '', customerToken: '', emailCaptured: false,
    summaryEmailRequested: false, resultEmailSent: false, resultEmailSending: false,
    previousBundle: 'את המארז שלך', previousShade: 'הגוון שבחרת'
  };
  var transcript = [];
  var hookTimer = null;
  var closed = false;
  var previouslyFocused = null;
  var previousBodyOverflow = '';
  var viewportFrame = 0;
  var viewportListening = false;
  var analyticsSequence = 0;

  /* =================================================================== *
   * Analytics
   * =================================================================== */

  function popupVersion() {
    return OPTS.version || 'novahair_ai_v1';
  }

  function sessionId() {
    try {
      var s = sessionStorage.getItem('novahair_popup_session');
      if (s) return s;
    } catch (_) { /* noop */ }
    return convId;
  }

  function visitorId() {
    try { return localStorage.getItem('novahair_popup_visitor') || convId; } catch (_) { return convId; }
  }

  function analyticsBody(event, payload) {
    analyticsSequence += 1;
    var nonce = '';
    try { nonce = window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : ''; } catch (_) {}
    if (!nonce) nonce = Date.now().toString(36) + ':' + analyticsSequence + ':' + Math.random().toString(36).slice(2);
    var key = event + ':' + popupVersion() + ':' + sessionId() + ':' + nonce;
    var attribution = window.NovaHairAttribution ? window.NovaHairAttribution.get() : {};
    return {
      event: event,
      visitorId: visitorId(),
      explicitEventKey: key,
      occurredAt: new Date().toISOString(),
      utm_source: attribution.utm_source || '',
      utm_medium: attribution.utm_medium || '',
      utm_campaign: attribution.utm_campaign || '',
      payload: Object.assign({
        popupVersion: popupVersion(),
        sessionId: sessionId(),
        conversationId: convId,
        path: location.pathname
      },
      /* Full marketing context on every event, so any step can be sliced by
       * campaign, ad content, or click id. */
      (window.NovaHairAttribution ? window.NovaHairAttribution.eventFields() : {}),
      payload || {})
    };
  }

  /* D1 remains the operational source of truth for the Concierge dashboard.
   * This privacy-safe mirror lets PostHog analyse the same journey beside the
   * store funnel. PostHog supplies its existing distinct/session identity; we
   * never identify again here, and the shared event id prevents duplicates. */
  function mirrorToPostHog(body) {
    try {
      if (!window.posthog || typeof window.posthog.capture !== 'function') return;
      var safeKeys = [
        'popupVersion', 'conversationId', 'path', 'device', 'trigger', 'reason',
        'engagementScore', 'abandonScore', 'intentScore', 'scrollDepth',
        'currentScrollDepth', 'scrollVelocity', 'engagedSeconds', 'timeOnPage',
        'visitNumber', 'pageVariant', 'qualified', 'failedGates', 'blockedBy',
        'experimentId', 'experimentVariant', 'experimentBucket', 'holdoutPercent',
        'stepId', 'stepIndex',
        'stepType', 'action', 'choiceId', 'dwellMs', 'angle', 'tags', 'shadeKey',
        'shadeMethod', 'shadeConfidence',
        'tone', 'agent', 'placement', 'consent', 'attemptId', 'attemptNumber',
        'closeMethod', 'failureCategory', 'couponConfigured', 'emailKind'
      ];
      var properties = {
        source: 'novahair_ai_concierge',
        event_schema_version: 1,
        event_id: body.explicitEventKey,
        '$insert_id': body.explicitEventKey,
        utm_source: body.utm_source || '',
        utm_medium: body.utm_medium || '',
        utm_campaign: body.utm_campaign || ''
      };
      safeKeys.forEach(function (key) {
        var value = body.payload && body.payload[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') properties[key] = value;
      });
      /* Shopper free text, email, customer keys and ad click ids are
       * intentionally excluded from the PostHog copy. */
      window.posthog.capture(body.event, properties);
    } catch (_) { /* analytics never blocks the conversation */ }
  }

  function emit(event, payload) {
    var body = analyticsBody(event, payload);
    mirrorToPostHog(body);
    try {
      var json = JSON.stringify(body);
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'application/json' }))) return;
      fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: json, keepalive: true, credentials: 'same-origin'
      }).catch(function () {});
    } catch (_) { /* analytics never blocks the conversation */ }
  }

  /* One row per step. This is the table the backend analysis reads. */
  function logStep(node, action, detail) {
    var dwell = stepStartedAt ? Date.now() - stepStartedAt : 0;
    var record = {
      stepId: node ? node.id : 'unknown',
      stepIndex: stepIndex,
      stepType: node ? node.type : 'unknown',
      action: action,                                  // shown | choice | free_text | photo | skip | submit | exit
      choiceId: detail && detail.choiceId ? detail.choiceId : '',
      choiceLabel: detail && detail.choiceLabel ? String(detail.choiceLabel).slice(0, 120) : '',
      freeText: detail && detail.freeText ? String(detail.freeText).slice(0, 400) : '',
      shadeKey: context.shadeKey || '',
      shadeMethod: detail && detail.shadeMethod ? detail.shadeMethod : '',
      shadeConfidence: detail && Number.isFinite(Number(detail.shadeConfidence))
        ? Math.round(Number(detail.shadeConfidence)) : 0,
      dwellMs: dwell,
      angle: context.angle,
      tags: context.tags.join(','),
      tone: window.NovaHairAITone ? window.NovaHairAITone.key() : '',
      agent: context.agent || 'sales'
    };
    transcript.push(record);
    emit('popup_ai_step', record);
  }

  /* =================================================================== *
   * Rendering
   * =================================================================== */

  /* Shopify flattens theme assets, so an img/ path cannot survive as-is.
   * The Liquid snippet passes an assetMap; the harness uses assetBase. */
  function asset(path) {
    if (OPTS.assetMap && OPTS.assetMap[path]) return OPTS.assetMap[path];
    return (OPTS.assetBase || '') + path;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function scrollDown() {
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  /* Meta's iOS and Android WebViews resize the visual viewport independently
   * from the layout viewport when browser chrome or the keyboard appears. Keep
   * the dialog inside the pixels the shopper can actually see. */
  function applyVisualViewport() {
    viewportFrame = 0;
    if (!root) return;
    var viewport = window.visualViewport;
    var height = viewport && viewport.height ? viewport.height : window.innerHeight;
    var top = viewport && viewport.offsetTop ? viewport.offsetTop : 0;
    if (height) root.style.setProperty('--nhai-viewport-height', Math.round(height) + 'px');
    root.style.setProperty('--nhai-viewport-top', Math.max(0, Math.round(top)) + 'px');
    if (root.getAttribute('data-open') === 'true') scrollDown();
  }

  function syncVisualViewport() {
    if (viewportFrame) cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(applyVisualViewport);
  }

  function startViewportSync() {
    if (viewportListening) return;
    viewportListening = true;
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncVisualViewport);
      window.visualViewport.addEventListener('scroll', syncVisualViewport);
    }
    window.addEventListener('resize', syncVisualViewport);
    window.addEventListener('orientationchange', syncVisualViewport);
    syncVisualViewport();
  }

  function stopViewportSync() {
    if (!viewportListening) return;
    viewportListening = false;
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', syncVisualViewport);
      window.visualViewport.removeEventListener('scroll', syncVisualViewport);
    }
    window.removeEventListener('resize', syncVisualViewport);
    window.removeEventListener('orientationchange', syncVisualViewport);
    if (viewportFrame) cancelAnimationFrame(viewportFrame);
    viewportFrame = 0;
  }

  function build() {
    root = el('div', 'nhai');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'יועצת NovaHair');
    root.tabIndex = -1;

    var sheet = el('div', 'nhai__sheet');
    var head = el('div', 'nhai__head');
    var adv = (F.advisor || {});
    var orb = el('div', 'nhai__orb');
    if (adv.avatar) {
      orb.style.backgroundImage = 'url(' + asset(adv.avatar) + ')';
      orb.style.backgroundSize = 'cover';
      orb.style.backgroundPosition = 'center top';
    }
    head.appendChild(orb);
    var who = el('div', 'nhai__who');
    who.appendChild(el('div', 'nhai__name', adv.name || 'היועצת של NovaHair'));
    who.appendChild(el('div', 'nhai__sub', adv.role || 'צוות NovaHair'));
    head.appendChild(who);
    var x = el('button', 'nhai__x', '×');
    x.setAttribute('aria-label', 'סגירה');
    x.addEventListener('click', function () { finish('dismissed'); });
    head.appendChild(x);

    logEl = el('div', 'nhai__log');
    footEl = el('div', 'nhai__foot');

    sheet.appendChild(head);
    sheet.appendChild(logEl);
    sheet.appendChild(footEl);
    root.appendChild(sheet);
    document.body.appendChild(root);

    document.addEventListener('keydown', function (e) {
      if (root.getAttribute('data-open') !== 'true') return;
      if (e.key === 'Escape') { finish('escape'); return; }
      if (e.key !== 'Tab') return;
      var focusable = root.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) { e.preventDefault(); root.focus(); return; }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function typing() {
    var t = el('div', 'nhai__msg nhai__msg--ai nhai__typing');
    t.appendChild(el('i')); t.appendChild(el('i')); t.appendChild(el('i'));
    logEl.appendChild(t);
    scrollDown();
    return t;
  }

  /* Types one bubble, then resolves. Sequential so it reads like a person. */
  function say(text) {
    return new Promise(function (resolve) {
      var t = typing();
      var delay = Math.min(TYPING_MS + text.length * 12, 2200);
      setTimeout(function () {
        t.remove();
        logEl.appendChild(el('div', 'nhai__msg nhai__msg--ai', text));
        scrollDown();
        resolve();
      }, delay);
    });
  }

  function sayUser(text) {
    logEl.appendChild(el('div', 'nhai__msg nhai__msg--user', text));
    scrollDown();
  }

  /* Her name is used sparingly. Sprinkling it into every line is the
   * single most AI-sounding tic there is, so {{greet}} fires once early
   * and {{greetName}} only at the offer and the thank-you. */
  function interpolate(text) {
    var bundle = FACTS.bundles.filter(function (item) {
      return item.key === FACTS.recommendedBundle;
    })[0];
    var bundleSavingAmount = bundle ? bundle.was - bundle.price : '';
    return text
      .replace('{{shade}}', context.shadeLabel || 'הגוון המתאים')
      .replace('{{shadeKey}}', context.shadeKey || '')
      .replace('{{greet}}', context.name ? 'נעים מאוד, ' + context.name + '. ' : '')
      .replace('{{greetName}}', context.name ? context.name + ', ' : '')
      .replace('{{bundlePrice}}', bundle ? bundle.price : '')
      .replace('{{bundleWas}}', bundle ? bundle.was : '')
      .replace('{{bundleSavingAmount}}', bundleSavingAmount)
      .replace('{{bundleSavingPercent}}', bundle ? bundle.saving : '')
      .replace('{{freeKitValue}}', FACTS.offer.freeKitValue)
      .replace('{{costPerTreatment}}', FACTS.costPerTreatment())
      .replace('{{previousBundle}}', context.previousBundle || 'את המארז שלך')
      .replace('{{previousShade}}', context.previousShade || 'הגוון שבחרת');
  }

  /* ---- safety routing ------------------------------------------------
   * Checked BEFORE anything is sent to a model. An existing customer with
   * a delivery problem must never be handed a sales conversation, and a
   * medical question must never be improvised. */
  function safetyRoute(text) {
    var t = String(text || '');
    var hit = function (list) {
      for (var i = 0; i < list.length; i++) if (t.indexOf(list[i]) !== -1) return true;
      return false;
    };
    if (hit(F.refusalTriggers || [])) return 'refuse_medical';
    if (hit(F.escalationTriggers || [])) return 'escalate';
    return null;
  }

  /* ---- cards ---- */

  function renderCard(spec) {
    var card = el('div', 'nhai__card');
    if (spec.kind === 'shades') {
      card.appendChild(el('h4', null, 'הגוונים שלנו'));
      var wrap = el('div', 'nhai__swatches');
      F.shades.forEach(function (s) {
        var sw = el('div', 'nhai__sw');
        if (s.key === context.shadeKey) sw.setAttribute('data-on', 'true');
        var chip = el('span');
        /* Use the same calibrated colours as the live buy box. Photographic
         * swatches changed dramatically with lighting and made dark brown
         * appear darker than black on some mobile displays. */
        chip.style.background = s.hex;
        sw.appendChild(chip);
        sw.appendChild(el('b', null, s.label));
        wrap.appendChild(sw);
      });
      card.appendChild(wrap);
    } else if (spec.kind === 'cost') {
      /* Real numbers off the sales page, not vibes. 4 bottles x 30 uses
       * = 120 root treatments for the 4-pack price. */
      var b4 = FACTS.bundles.filter(function (x) { return x.key === 'b4'; })[0];
      card.appendChild(el('h4', null, 'איך זה נראה במספרים'));
      var rows = el('div', 'nhai__rows');
      [['מארז 4 בקבוקים', '₪' + b4.price],
       ['לבקבוק', '₪' + b4.perBottle],
       ['שימושים בבקבוק', 'עד ' + FACTS.usesPerBottle],
       ['לטיפול שורשים', '₪' + FACTS.costPerTreatment()]].forEach(function (r, i) {
        var row = el('div', 'nhai__row' + (i === 3 ? ' nhai__row--total' : ''));
        row.appendChild(el('span', null, r[0]));
        row.appendChild(el('b', null, r[1]));
        rows.appendChild(row);
      });
      card.appendChild(rows);
    } else if (spec.kind === 'bundle') {
      var b = FACTS.bundles.filter(function (x) { return x.key === FACTS.recommendedBundle; })[0];
      card.appendChild(el('h4', null, 'מארז ' + b.bottles + ' בקבוקים · ₪' + b.price));
      var br = el('div', 'nhai__rows');
      [['במקום', '₪' + b.was],
       ['חיסכון', '₪' + (b.was - b.price) + ' · ' + b.saving],
       ['ערכת צביעה מלאה', 'מתנה · שווי ₪' + FACTS.offer.freeKitValue],
       ['אחריות', FACTS.offer.guaranteeDays + ' יום']].forEach(function (r) {
        var row = el('div', 'nhai__row');
        row.appendChild(el('span', null, r[0]));
        row.appendChild(el('b', null, r[1]));
        br.appendChild(row);
      });
      card.appendChild(br);
    } else if (spec.kind === 'how') {
      card.appendChild(el('h4', null, 'שלושה שלבים'));
      var steps = el('div', 'nhai__rows');
      FACTS.howToUse.forEach(function (s, i) {
        var row = el('div', 'nhai__row');
        row.appendChild(el('span', null, (i + 1) + '. ' + s));
        steps.appendChild(row);
      });
      card.appendChild(steps);
    }
    logEl.appendChild(card);
    scrollDown();
  }

  /* =================================================================== *
   * Photo shade matching (fully client-side)
   * =================================================================== */

  function colourDistance(rgb, target) {
    var rMean = (rgb[0] + target[0]) / 2;
    var dr = rgb[0] - target[0], dg = rgb[1] - target[1], db = rgb[2] - target[2];
    return Math.sqrt(
      (2 + rMean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rMean) / 256) * db * db
    );
  }

  function saturation(rgb) {
    var maximum = Math.max(rgb[0], rgb[1], rgb[2]);
    var minimum = Math.min(rgb[0], rgb[1], rgb[2]);
    return (maximum - minimum) / Math.max(1, maximum);
  }

  /* RGB distance alone treats a very dark purple as black. Preserve relative
   * chroma as a second signal so eggplant and wine-red shadows keep their hue. */
  function shadeDistance(rgb, target) {
    return colourDistance(rgb, target) +
      Math.abs(saturation(rgb) - saturation(target)) * 80;
  }

  function averageHairColor(img) {
    var c = document.createElement('canvas');
    var size = 80;
    c.width = size; c.height = size;
    var ctx = c.getContext('2d');
    /* The upper centre of a selfie is much more likely to contain roots than
     * clothing or furniture. Cropping first makes the simple local matcher
     * less sensitive to a dark shirt or background. */
    var sourceX = img.naturalWidth * 0.12;
    var sourceY = img.naturalHeight * 0.02;
    var sourceW = img.naturalWidth * 0.76;
    var sourceH = img.naturalHeight * 0.58;
    ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, size, size);
    var data = ctx.getImageData(0, 0, size, size).data;

    /* A portrait can contain more wall and skin than hair. Averaging a fixed
     * percentage of dark pixels made a charcoal background lift genuinely
     * dark hair into the light-brown bucket. Split the crop into colour
     * clusters and use the darkest cluster that occupies a meaningful part
     * of the image. Tiny clusters (eyes, jewellery and isolated shadows) are
     * deliberately ignored. */
    var pixels = [];
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      if (data[i + 3] < 200) continue;
      var brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      if (brightness < 8 || brightness > 235) continue;
      pixels.push([r, g, b, brightness]);
    }
    if (pixels.length < 120) return null;

    var ordered = pixels.slice().sort(function (a, b) { return a[3] - b[3]; });
    var seedPoints = [0.04, 0.14, 0.28, 0.46, 0.68, 0.88];
    var centres = seedPoints.map(function (point) {
      var p = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * point))];
      return [p[0], p[1], p[2]];
    });
    var groups = [];

    for (var pass = 0; pass < 8; pass++) {
      groups = centres.map(function () { return { rgb: [0, 0, 0], count: 0 }; });
      pixels.forEach(function (p) {
        var bestIndex = 0, bestDistance = Infinity;
        centres.forEach(function (centre, index) {
          var distance = colourDistance(p, centre);
          if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
        });
        var group = groups[bestIndex];
        group.rgb[0] += p[0]; group.rgb[1] += p[1]; group.rgb[2] += p[2];
        group.count += 1;
      });
      centres = groups.map(function (group, index) {
        if (!group.count) return centres[index];
        return [
          group.rgb[0] / group.count,
          group.rgb[1] / group.count,
          group.rgb[2] / group.count
        ];
      });
    }

    var clusters = groups.map(function (group, index) {
      var rgb = centres[index];
      return {
        rgb: rgb,
        count: group.count,
        share: group.count / pixels.length,
        brightness: 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
      };
    }).filter(function (cluster) { return cluster.count > 0; })
      .sort(function (a, b) { return a.brightness - b.brightness; });

    var selected = null;
    for (var j = 0; j < clusters.length; j++) {
      if (clusters[j].share >= 0.08) { selected = clusters[j]; break; }
    }
    if (!selected) return null;
    selected.darkPixelShare = pixels.filter(function (p) { return p[3] <= 72; }).length / pixels.length;
    return selected;
  }

  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function nearestShade(sample) {
    if (!sample || !sample.rgb) return null;
    var rgb = sample.rgb;
    var scored = [];
    F.shades.forEach(function (s) {
      var t = s.matchRgb || hexToRgb(s.hex);
      scored.push({
        shade: s,
        d: shadeDistance(rgb, t)
      });
    });
    scored.sort(function (a, b) { return a.d - b.d; });
    var best = scored[0];

    /* A near tie in pixel distance is usually caused by highlights, not by a
     * shopper consciously choosing between two boxes. Never apply the sales
     * page's manual "go lighter" rule to machine uncertainty. */
    if (best.shade.key === 'light_brown' && sample.darkPixelShare >= 0.18) {
      for (var darkIndex = 0; darkIndex < scored.length; darkIndex++) {
        if (scored[darkIndex].shade.key === 'dark_brown') {
          best = scored[darkIndex];
          break;
        }
      }
    }
    return {
      shade: best.shade,
      reliable: sample.share >= 0.08 && best.d <= 80 &&
        (!scored[1] || (scored[1].d - best.d) >= 10),
      distance: best.d,
      gap: scored[1] ? scored[1].d - best.d : Infinity,
      clusterShare: sample.share
    };
  }

  function shadeByKey(key) {
    for (var i = 0; i < F.shades.length; i++) if (F.shades[i].key === key) return F.shades[i];
    return null;
  }

  function compressedPhoto(img) {
    var maxSide = 640;
    var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  function requestVisionShade(img, localMatch) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 9000) : null;
    return fetch(SHADE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        image: compressedPhoto(img),
        conversationId: convId,
        localSuggestion: localMatch && localMatch.shade ? localMatch.shade.key : ''
      }),
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error('shade vision unavailable');
      return response.json();
    }).then(function (result) {
      var shade = result && result.shade ? shadeByKey(result.shade) : null;
      return {
        shade: shade,
        uncertain: !shade || result.shade === 'uncertain',
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
        method: result.method || 'vision_zdr'
      };
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function renderPhotoStep(node) {
    footEl.innerHTML = '';
    var wrap = el('div', 'nhai__photo');

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'user';
    input.style.display = 'none';

    var drop = el('button', 'nhai__drop', 'צלמי את השורשים או בחרי תמונה');
    drop.type = 'button';
    drop.addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var preview = el('div', 'nhai__preview');
        var thumb = document.createElement('img');
        thumb.src = url;
        preview.appendChild(thumb);
        preview.appendChild(el('div', 'nhai__analysing', 'בודקת כיוון ראשוני לגוון'));
        footEl.innerHTML = '';
        footEl.appendChild(preview);

        setTimeout(function () {
          var sample = averageHairColor(img);
          var localMatch = nearestShade(sample);
          var complete = function (result) {
            URL.revokeObjectURL(url);
            sayUser('שלחתי תמונה');
            if (!result || result.uncertain || !result.shade) {
              logStep(node, 'photo_uncertain', {
                choiceId: 'manual_check',
                shadeMethod: result ? result.method : 'local_fallback',
                shadeConfidence: result ? result.confidence * 100 : 0
              });
              say('לא הצלחתי לזהות את אזור השורשים בוודאות מהתמונה הזאת. בואי נבחר יחד.').then(function () {
                go(node.skipNext);
              });
              return;
            }
            context.shadeKey = result.shade.key;
            context.shadeLabel = result.shade.label;
            logStep(node, 'photo', {
              choiceId: result.shade.key,
              choiceLabel: result.shade.label,
              shadeMethod: result.method,
              shadeConfidence: result.confidence * 100
            });
            go(node.next);
          };

          requestVisionShade(img, localMatch).then(complete).catch(function () {
            if (!localMatch || !localMatch.reliable) return complete(null);
            complete({
              shade: localMatch.shade,
              uncertain: false,
              confidence: Math.max(0.5, Math.min(0.86, 1 - localMatch.distance / 100)),
              method: 'local_fallback'
            });
          });
        }, 250);
      };
      img.onerror = function () {
        footEl.appendChild(el('div', 'nhai__err', 'לא הצלחתי לקרוא את התמונה. נסי אחרת או בחרי ידנית.'));
      };
      img.src = url;
    });

    wrap.appendChild(drop);
    wrap.appendChild(input);

    var skip = el('button', 'nhai__opt nhai__opt--ghost', node.skipLabel);
    skip.addEventListener('click', function () {
      logStep(node, 'skip', { choiceId: 'skip_photo' });
      sayUser(node.skipLabel);
      go(node.skipNext);
    });
    wrap.appendChild(skip);
    footEl.appendChild(wrap);
    footEl.appendChild(el('div', 'nhai__note', 'התמונה נשלחת לניתוח AI מאובטח ואינה נשמרת אצל NovaHair. התוצאה היא כיוון ראשוני בלבד.'));
  }

  /* =================================================================== *
   * Controls
   * =================================================================== */

  /* Maps a manual answer ('dark_brown', 'cool', 'warm', ...) onto a real
   * shade from the catalogue. Unknown tags are ignored. */
  function applyShadeTag(tag) {
    if (!tag || !F.shadeMap || !F.shadeMap[tag]) return;
    var key = F.shadeMap[tag];
    for (var i = 0; i < F.shades.length; i++) {
      if (F.shades[i].key === key) {
        context.shadeKey = F.shades[i].key;
        context.shadeLabel = F.shades[i].label;
        return;
      }
    }
  }

  function renderOptions(node) {
    footEl.innerHTML = '';
    var box = el('div', 'nhai__opts');
    (node.options || []).forEach(function (opt, i) {
      var b = el('button', 'nhai__opt' + (i === 0 && node.type !== 'ask' ? ' nhai__opt--primary' : ''), opt.label);
      b.addEventListener('click', function () {
        if (opt.tag) context.tags.push(opt.tag);
        if (node.id === 'audience_choice') context.intent = opt.id === 'returning' ? 'repeat' : 'prospect';
        if (node.id === 'problem') context.mainConcern = opt.tag || opt.id;
        /* Shade answers must set the recommendation, not just tag it.
         * Without this the skip-the-photo path reaches shade_result with no
         * shade at all, so the swatch card highlights nothing. */
        applyShadeTag(opt.tag);
        if (context.customerToken && (context.shadeKey || /bundle_cta|repeat_same/.test(opt.tag || ''))) {
          syncCustomerContext();
        }
        if (/shade_cta|bundle_cta|buy_cta/.test(opt.tag || '')) sendResultEmail('summary');
        logStep(node, 'choice', { choiceId: opt.id, choiceLabel: opt.label });
        sayUser(opt.label);
        go(opt.next);
      });
      box.appendChild(b);
    });
    footEl.appendChild(box);

    if (node.allowFree) {
      var f = el('div', 'nhai__free');
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = node.freePlaceholder || 'כתבי לי';
      var send = el('button', null, 'שלחי');
      var submit = function () {
        var text = inp.value.trim();
        if (!text) return;
        if (text.length > 400) text = text.slice(0, 400);
        inp.value = '';
        logStep(node, 'free_text', { freeText: text });
        sayUser(text);

        if (window.NovaHairAITone) {
          window.NovaHairAITone.observe(text);
        }

        var route = safetyRoute(text);
        if (route) { logStep(node, 'choice', { choiceId: 'safety_' + route }); go(route); return; }

        handleFreeText(text, node);
      };
      send.addEventListener('click', submit);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      f.appendChild(inp); f.appendChild(send);
      footEl.appendChild(f);
    }
  }

  function renderCapture(node) {
    footEl.innerHTML = '';
    var form = document.createElement('form');

    var f = el('div', 'nhai__free');
    var inp = document.createElement('input');
    inp.type = 'email'; inp.required = true; inp.placeholder = node.emailLabel || 'אימייל'; inp.autocomplete = 'email';
    inp.addEventListener('focus', function () {
      if (inp.dataset.started) return;
      inp.dataset.started = 'true';
      emit('popup_email_started', { trigger: 'ai_concierge', stepId: node.id });
    });
    var send = el('button', null, node.submitLabel || 'שלחי');
    send.type = 'submit';
    f.appendChild(inp); f.appendChild(send);
    form.appendChild(f);

    var consentWrap = el('label', 'nhai__consent');
    var consent = document.createElement('input');
    consent.type = 'checkbox';
    consentWrap.appendChild(consent);
    consentWrap.appendChild(document.createTextNode(' אני רוצה לקבל גם טיפים, עדכונים והטבות מ־NovaHair במייל.'));
    form.appendChild(consentWrap);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity() || form.dataset.submitting === 'true') return;
      var email = inp.value.trim();
      logStep(node, 'submit', {
        choiceId: 'captured',
        choiceLabel: consent.checked ? 'email+marketing' : 'email'
      });
      emit('popup_submit_attempt', { attemptNumber: 1, consent: consent.checked, trigger: 'ai_concierge' });
      form.dataset.submitting = 'true';
      send.disabled = true;
      var originalLabel = send.textContent;
      send.textContent = 'שומרת...';

      var capture = typeof OPTS.onCapture === 'function'
        ? Promise.resolve(OPTS.onCapture(email, consent.checked, context))
        : submitLead(email, consent.checked, node);

      capture.then(function (result) {
        context.customerToken = result && result.customerToken ? result.customerToken : context.customerToken;
        context.emailCaptured = true;
        context.summaryEmailRequested = true;
        if (window.NovaHairPopupEngine && typeof window.NovaHairPopupEngine.markSubscribed === 'function') {
          window.NovaHairPopupEngine.markSubscribed();
        }
        if (node.id === 'capture' || node.id === 'capture_coupon') {
          sendResultEmail(node.id === 'capture_coupon' ? 'coupon' : 'guide');
        }
        sayUser(email);
        go(node.next);
      }).catch(function () {
        emit('popup_submit_failed', { failureCategory: 'shopify_confirmation_failed', trigger: 'ai_concierge' });
        var error = form.querySelector('.nhai__err');
        if (!error) {
          error = el('div', 'nhai__err');
          error.setAttribute('role', 'alert');
          form.appendChild(error);
        }
        error.textContent = 'לא הצלחנו לאשר את השמירה כרגע. נסי שוב.';
        form.dataset.submitting = 'false';
        send.disabled = false;
        send.textContent = originalLabel;
      });
    });
    footEl.appendChild(form);

    if (node.skipLabel) {
      var skip = el('button', 'nhai__opt nhai__opt--ghost', node.skipLabel);
      skip.addEventListener('click', function () {
        logStep(node, 'skip', { choiceId: 'skipped_capture' });
        go(node.skipNext || 'close');
      });
      footEl.appendChild(skip);
    }
  }

  function renderIdentify(node) {
    footEl.innerHTML = '';
    if (context.isReturning && OPTS.shopper && OPTS.shopper.loggedIn) {
      var checking = el('div', 'nhai__note', 'מוצאת את ההזמנה האחרונה שלך...');
      footEl.appendChild(checking);
      postJson(OPTS.identifySessionEndpoint || '/apps/funnels/api/popup/customer/identify/session', {}).then(function (result) {
        context.customerToken = result.customerToken || '';
        context.emailCaptured = Boolean(result.customerToken);
        context.previousBundle = result.bundle || context.previousBundle;
        context.previousShade = result.shadeSummary || context.previousShade;
        go(node.next);
      }).catch(function () {
        context.isReturning = false;
        renderIdentify(node);
      });
      return;
    }
    var form = document.createElement('form');
    var f = el('div', 'nhai__free');
    var inp = document.createElement('input');
    inp.type = 'email'; inp.required = true; inp.placeholder = node.emailLabel; inp.autocomplete = 'email';
    var send = el('button', null, node.submitLabel); send.type = 'submit';
    f.appendChild(inp); f.appendChild(send); form.appendChild(f);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!form.checkValidity() || form.dataset.submitting === 'true') return;
      form.dataset.submitting = 'true'; send.disabled = true; send.textContent = 'שולחת קוד...';
      postJson(OPTS.identifyStartEndpoint || '/apps/funnels/api/popup/customer/identify/start', {
        email: inp.value.trim(), intent: 'repeat'
      }).then(function (result) {
        renderOtp(node, result.challengeToken || '');
      }).catch(function () {
        showFormError(form, 'לא הצלחנו לשלוח קוד כרגע. נסי שוב.');
        form.dataset.submitting = 'false'; send.disabled = false; send.textContent = node.submitLabel;
      });
    });
    footEl.appendChild(form);
    var skip = el('button', 'nhai__opt nhai__opt--ghost', node.skipLabel);
    skip.addEventListener('click', function () { go(node.skipNext); });
    footEl.appendChild(skip);
  }

  function renderOtp(node, challengeToken) {
    footEl.innerHTML = '';
    var form = document.createElement('form');
    var label = el('div', 'nhai__note', 'שלחתי קוד בן 6 ספרות למייל. הזיני אותו כאן כדי לזהות את ההזמנה.');
    var f = el('div', 'nhai__free');
    var inp = document.createElement('input');
    inp.type = 'text'; inp.required = true; inp.inputMode = 'numeric'; inp.autocomplete = 'one-time-code'; inp.maxLength = 6; inp.placeholder = 'קוד אימות';
    var send = el('button', null, 'אמתִי'); send.type = 'submit';
    f.appendChild(inp); f.appendChild(send); form.appendChild(label); form.appendChild(f);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!/^\d{6}$/.test(inp.value.trim()) || form.dataset.submitting === 'true') return;
      form.dataset.submitting = 'true'; send.disabled = true; send.textContent = 'בודקת...';
      postJson(OPTS.identifyVerifyEndpoint || '/apps/funnels/api/popup/customer/identify/verify', {
        challengeToken: challengeToken, code: inp.value.trim()
      }).then(function (result) {
        context.customerToken = result.customerToken || '';
        context.emailCaptured = Boolean(result.customerToken);
        context.intent = 'repeat';
        context.previousBundle = result.bundle || context.previousBundle;
        context.previousShade = result.shadeSummary || context.previousShade;
        go(node.next);
      }).catch(function () {
        showFormError(form, 'הקוד לא תקין או שפג תוקפו. נסי שוב.');
        form.dataset.submitting = 'false'; send.disabled = false; send.textContent = 'אמתִי';
      });
    });
    footEl.appendChild(form);
    var skip = el('button', 'nhai__opt nhai__opt--ghost', node.skipLabel);
    skip.addEventListener('click', function () { go(node.skipNext); });
    footEl.appendChild(skip);
  }

  function showFormError(form, message) {
    var error = form.querySelector('.nhai__err');
    if (!error) { error = el('div', 'nhai__err'); error.setAttribute('role', 'alert'); form.appendChild(error); }
    error.textContent = message;
  }

  /* Reveal the coupon code and an apply button. Reached only after a price
   * objection, so the discount is spent where it changes the decision. */
  function renderCoupon(node) {
    footEl.innerHTML = '';
    var coupon = F.coupon || { code: '', applyPath: '/pages/novahair-sales-staging' };
    var card = el('div', 'nhai__card');
    card.appendChild(el('h4', null, 'הקוד שלך'));
    var code = el('div', 'nhai__coupon-code', coupon.code);
    card.appendChild(code);
    logEl.appendChild(card);
    scrollDown();

    var apply = el('button', 'nhai__opt nhai__opt--primary', 'להזמנה עם הקוד');
    apply.addEventListener('click', function () {
      emit('popup_coupon_revealed', { couponConfigured: true, trigger: 'ai_concierge' });
      emit('popup_continue_clicked', { trigger: 'ai_concierge', reason: 'coupon' });
      navigate(coupon.applyPath || '/pages/novahair-sales-staging', 'coupon');
    });
    footEl.appendChild(apply);
  }

  function postJson(endpoint, payload, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 10000);
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.failureCategory || data.error || 'request_failed');
        return data;
      });
    }).finally(function () { clearTimeout(timer); });
  }

  function submitLead(email, marketingConsent, node) {
    var body = analyticsBody('popup_submit_success', {
      trigger: 'ai_concierge', consent: marketingConsent
    });
    body.email = email;
    body.intent = node.intent || context.intent || 'prospect';
    body.mainConcern = node.concern || context.mainConcern || '';
    body.marketingConsent = Boolean(marketingConsent);
    return postJson(OPTS.customerCaptureEndpoint || '/apps/funnels/api/popup/customer/capture', body).then(function (result) {
      /* Only mirror the success after Shopify confirms the customer write. */
      mirrorToPostHog(body);
      if (window.NovaHairAttribution) {
        return window.NovaHairAttribution.writeCartAttributes({
          conversationId: convId, visitorId: visitorId(), sessionId: sessionId(),
          version: popupVersion(), agent: context.agent, lead: true
        }).then(function () {
          window.NovaHairAttribution.ga('lead', { agent: context.agent, marketingConsent: Boolean(marketingConsent) });
          return result;
        });
      }
      return result;
    });
  }

  function syncCustomerContext() {
    if (!context.customerToken) return Promise.resolve();
    return postJson(OPTS.customerContextEndpoint || '/apps/funnels/api/popup/customer/context', {
      customerToken: context.customerToken,
      intent: context.intent,
      mainConcern: context.mainConcern,
      recommendedShade: context.shadeLabel || '',
      recommendedBundle: recommendedBundle(),
      latestSummary: [context.mainConcern, context.shadeLabel].filter(Boolean).join(' · ')
    }).catch(function () {});
  }

  function recommendedBundle() {
    var nodeRecommendsFourPack = currentNode && (currentNode.id === 'price_bundle' || currentNode.id === 'price_bundle_confirmed');
    return nodeRecommendsFourPack || context.tags.indexOf('bundle_cta') !== -1 ? 'מארז 4 בקבוקים' : '';
  }

  function sendResultEmail(kind) {
    if (!context.summaryEmailRequested || !context.customerToken || context.resultEmailSent || context.resultEmailSending) return Promise.resolve();
    context.resultEmailSending = true;
    var body = analyticsBody('popup_result_email_sent', {
      agent: context.agent || 'sales',
      device: window.innerWidth <= 767 ? 'mobile' : 'desktop'
    });
    body.customerToken = context.customerToken;
    body.conversationId = convId;
    body.popupVersion = popupVersion();
    body.sessionId = sessionId();
    body.path = location.pathname;
    body.agent = context.agent || 'sales';
    body.kind = kind || 'summary';
    body.intent = context.intent;
    body.mainConcern = context.mainConcern;
    body.recommendedShade = context.shadeLabel || '';
    body.recommendedBundle = recommendedBundle();
    return postJson(OPTS.resultEmailEndpoint || '/apps/funnels/api/popup/customer/result-email', body, 14000)
      .then(function (result) {
        context.resultEmailSent = Boolean(result && (result.sent || result.duplicate));
        if (result && result.sent && !result.duplicate) mirrorToPostHog(body);
      })
      .catch(function () { context.resultEmailSent = false; })
      .finally(function () { context.resultEmailSending = false; });
  }

  /* =================================================================== *
   * Free text -> LLM (server-proxied) with a graceful local fallback
   * =================================================================== */

  var INTENT_HINTS = [
    { re: /למה.*(עובר|לבחור|כדאי)|יתרונות|מה היתרון/, next: 'why_switch' },
    { re: /גוון|צבע|מתאים לי|בלונד|חום|שחור/, next: 'shade_open' },
    { re: /יקר|מחיר|כסף|עלות|הנחה/,           next: 'price_open' },
    { re: /שורש|כיסוי|לבן|שיבה/,               next: 'proof_roots' },
    { re: /איך|שימוש|להשתמש|כמה זמן/,          next: 'proof_how' }
  ];

  function localIntent(text) {
    for (var i = 0; i < INTENT_HINTS.length; i++) {
      if (INTENT_HINTS[i].re.test(text)) return INTENT_HINTS[i].next;
    }
    return null;
  }

  /* A system prompt is an instruction, not a guarantee. Everything the model
   * returns is scrubbed before it reaches the screen: emojis stripped, length
   * capped, and any attempt to echo the prompt or emit markup removed. */
  var EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

  function sanitizeReply(raw) {
    var s = String(raw || '');
    s = s.replace(EMOJI_RE, '');
    s = s.replace(/<[^>]*>/g, '');                 // never render model markup
    s = s.replace(/!{2,}/g, '.');                  // no manufactured excitement
    s = s.replace(/—/g, '.').replace(/–/g, '.');  // em/en dash are banned
    s = s.replace(/\s+-\s+/g, '. ');               // hyphen as a thought separator
    s = s.replace(/\s{2,}/g, ' ').trim();
    /* Two sentences is the contract. Anything longer is the model rambling
     * and burning tokens, so we cut it rather than show it. */
    var parts = s.split(/(?<=[.?!])\s+/).filter(Boolean);
    if (parts.length > 2) s = parts.slice(0, 2).join(' ');
    return s.slice(0, 300);
  }

  function handleFreeText(text, node) {
    var t = typing();
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 9000);
    var isEmailBridge = node.id === 'problem';
    if (isEmailBridge) context.mainConcern = text;
    fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
      body: JSON.stringify({
        conversationId: convId,
        sessionId: sessionId(),
        stepId: node.id,
        message: text,
        context: { shade: context.shadeKey, tags: context.tags, angle: context.angle },
        tone: window.NovaHairAITone ? window.NovaHairAITone.key() : '',
        agent: context.agent || 'sales',
        placement: context.placement || 'exit_sales',
        mode: isEmailBridge ? 'email_bridge' : 'conversation'
      })
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('ai ' + r.status)); })
      .then(function (data) {
        t.remove();
        var reply = sanitizeReply(data.reply);
        if (reply) {
          logEl.appendChild(el('div', 'nhai__msg nhai__msg--ai', reply));
          scrollDown();
        }
        if (isEmailBridge) {
          var lower = text.toLowerCase();
          var captureNode = /גוון|צבע מתאים|כהה|בהיר/.test(lower) ? 'capture_shade'
            : /מחיר|כסף|יקר|עולה|עלות/.test(lower) ? 'capture_price'
              : /טבעי|ביתי|יראו|מלאכותי/.test(lower) ? 'capture_natural'
                : 'capture_free_text';
          go(captureNode);
          return;
        }
        go(data.next && F.nodes[data.next] ? data.next : (localIntent(text) || 'root_choice'));
      })
      .catch(function () {
        /* No key, no network, or the model is down. Keep the conversation
         * alive with keyword routing rather than dead-ending her. */
        t.remove();
        if (isEmailBridge) { go('capture_free_text'); return; }
        var next = localIntent(text);
        if (next) go(next);
        else {
          say('לא בטוחה שהבנתי נכון. בואי ננסה ככה.').then(function () { go('root_choice'); });
        }
      }).finally(function () { clearTimeout(timer); });
  }

  /* =================================================================== *
   * Flow driver
   * =================================================================== */

  /* Decides where a `route` node actually sends her. The whole coupon policy
   * lives here: a discount is only worth its cost for a price objection from a
   * shopper who has NOT already decided to buy. Everyone else gets a no-coupon
   * path, so we never hand out a discount to someone who would convert anyway. */
  /* Single navigation point. OPTS.noRedirect lets the harness observe where she
   * would be sent without actually leaving the page. */
  function navigate(url, reason) {
    var A = window.NovaHairAttribution;
    var attributionWrite = Promise.resolve();
    if (A) {
      /* Stamp the cart so the order that follows a purchase/coupon exit is
       * traceable to this conversation. Support exits do not touch the cart. */
      if (/novahair-sales/.test(url) || url === '#buy' || reason === 'coupon') {
        attributionWrite = A.writeCartAttributes({
          conversationId: convId, visitorId: visitorId(), sessionId: sessionId(),
          version: popupVersion(), agent: context.agent, trigger: reason,
          coupon: reason === 'coupon' ? (F.coupon && F.coupon.code) : ''
        });
      }
      A.ga('to_' + (reason || 'exit'), { agent: context.agent, dest: url });
    }
    if (OPTS.noRedirect) { window.__lastRedirect = url; return; }
    if (url === '#buy') {
      attributionWrite.finally(function () { setTimeout(function () {
        finish('continued');
        var buy = document.getElementById('buy') || document.querySelector('.hero .hero-info');
        if (buy) {
          if (/2/.test(context.previousBundle) && typeof window.selectPack === 'function') window.selectPack('pack2');
          else if (/6/.test(context.previousBundle) && typeof window.selectPack === 'function') window.selectPack('pack6');
          else if (/4/.test(context.previousBundle) && typeof window.selectPack === 'function') window.selectPack('pack4');
          requestAnimationFrame(function () {
            buy.scrollIntoView({ behavior: 'smooth', block: 'start' });
            try { history.replaceState(null, '', location.pathname + location.search + '#buy'); } catch (_) {}
          });
        }
      }, 120); });
      return;
    }
    attributionWrite.finally(function () { setTimeout(function () {
      finish('continued');
      location.href = url;
    }, 80); });
  }

  function offerDecision(which, tagsOverride) {
    var tags = tagsOverride || context.tags || [];
    var it = F.intentTags || { ready: [], price: [] };
    var has = function (list) { return list.some(function (t) { return tags.indexOf(t) !== -1; }); };
    var ready = has(it.ready);
    var price = has(it.price);

    if (which === 'graceful') {
      /* Last-ditch save: only price-hesitant shoppers, and only in a lane that
       * is allowed to spend the first-order code. Retention/VIP/service never. */
      return (price && context.allowCoupon !== false) ? 'offer_coupon' : 'graceful_bye';
    }
    /* offer gate: convinced -> buy (no coupon); unclear -> guide (no coupon). */
    if (ready) return 'close_ready';
    return 'offer_guide';
  }

  function go(nodeId) {
    var node = F.nodes[nodeId];
    if (!node) { finish('flow_end'); return; }

    if (node.type === 'capture' && context.emailCaptured) {
      go(node.next || node.skipNext || 'close');
      return;
    }

    /* Route nodes carry no copy: resolve and jump before rendering anything. */
    if (node.type === 'route') {
      logStep(node, 'route', { choiceId: node.resolve });
      go(offerDecision(node.resolve));
      return;
    }

    currentNode = node;
    stepIndex++;
    stepStartedAt = Date.now();
    clearTimeout(hookTimer);

    logStep(node, 'shown', {});
    footEl.innerHTML = '';

    /* Match her rhythm. TONE.adapt only trims or reorders our own lines;
     * it never adds a line about her. */
    var raw = (node.messages || []).map(interpolate);
    var msgs = (window.NovaHairAITone && node.type !== 'end')
      ? window.NovaHairAITone.adapt(raw, node.protect)
      : raw;
    var chain = Promise.resolve();
    msgs.forEach(function (m) { chain = chain.then(function () { return say(m); }); });

    chain.then(function () {
      if (node.card) renderCard(node.card);
      if (node.id === 'shade_result' || node.id === 'price_bundle' || node.id === 'price_bundle_confirmed') {
        sendResultEmail('summary');
      }

      if (node.type === 'photo')        renderPhotoStep(node);
      else if (node.type === 'capture') renderCapture(node);
      else if (node.type === 'identify') renderIdentify(node);
      else if (node.type === 'coupon')  renderCoupon(node);
      else if (node.options && node.options.length) renderOptions(node);
      else if (node.redirect) {
        emit('popup_continue_clicked', { trigger: 'ai_concierge', reason: node.id });
        navigate(node.redirect, node.id);
      } else if (node.next) {
        setTimeout(function () { go(node.next); }, 500);
      } else {
        finish(node.id === 'close' ? 'closed' : 'ended');
      }
      /* The footer only gets its height once the controls exist, so an
       * earlier scroll leaves the last card clipped behind it. */
      requestAnimationFrame(function () { requestAnimationFrame(scrollDown); });
    });
  }

  function finish(how) {
    if (closed) return;
    closed = true;
    clearTimeout(hookTimer);
    logStep(currentNode, 'exit', { choiceId: how });
    var closeMethod = how === 'escape' ? 'esc' : (how === 'dismissed' ? 'x' : 'other');
    emit('popup_closed', { closeMethod: closeMethod, trigger: 'ai_concierge' });
    if (window.NovaHairPopupEngine && typeof window.NovaHairPopupEngine.markDismissed === 'function') {
      window.NovaHairPopupEngine.markDismissed(closeMethod);
    }
    if (root) root.setAttribute('data-open', 'false');
    stopViewportSync();
    document.body.style.overflow = previousBodyOverflow;
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    if (typeof OPTS.onFinish === 'function') OPTS.onFinish(how, transcript);
  }

  /* =================================================================== *
   * Open
   * =================================================================== */

  function pickAngle(decision) {
    var camp = ((decision && decision.utmCampaign) || location.search || '').toLowerCase();
    if (/cost|salon|price|מחיר/.test(camp)) return 'cost';
    if (/root|שורש/.test(camp)) return 'roots';
    if (/shade|color|גוון/.test(camp)) return 'shade';
    return 'default';
  }

  /* Returning-customer detection uses the Liquid-injected shopper object, not
   * an email lookup. For a logged-in shopper Shopify already knows her history,
   * so there is zero enumeration risk: no endpoint, no way to probe a stranger.
   * Guests are simply treated as new, which is the correct default. */
  function readShopper() {
    var s = OPTS.shopper || {};
    if (s.loggedIn && (s.ordersCount || 0) > 0) {
      context.isReturning = true;
      if (typeof s.daysSinceLastOrder === 'number') context.daysSinceLastOrder = s.daysSinceLastOrder;
      else if (s.lastOrderAt) {
        context.daysSinceLastOrder = Math.floor((Date.now() - s.lastOrderAt * 1000) / 86400000);
      }
      if (!context.name && s.firstName) context.name = String(s.firstName).slice(0, 24);
    }
  }

  /* Pick the lane and set the goal, opener, and entry. This is the router:
   * one front door, several specialists behind it (see AGENTS.md). */
  function routeAgent() {
    var A = window.NovaHairAIAgents;
    if (!A) return { laneId: 'sales', entry: F.entry, opener: null, sales: true };

    var placementId = OPTS.placement || A.defaultPlacement;
    var placement = A.placements[placementId] || A.placements[A.defaultPlacement];
    var laneId = A.chooseAgent({ placement: placementId, shopper: OPTS.shopper, safety: null });
    var lane = A.lanes[laneId] || A.lanes[A.defaultLane];

    context.agent = laneId;
    context.placement = placementId;
    context.allowCoupon = lane.allowCoupon !== false;
    /* The model gets the destination (placement goal) and the manner (lane
     * goal) as one hint, so free-text answers pull toward the right outcome. */
    context.goal = [placement && placement.goal, lane.goalHint].filter(Boolean).join(' ');

    return {
      laneId: laneId,
      entry: F.entry,
      opener: F.openers.default,
      sales: true
    };
  }

  function open(decision) {
    if (root) return;
    previouslyFocused = document.activeElement;
    previousBodyOverflow = document.body.style.overflow;
    build();
    context.angle = pickAngle(decision);
    readShopper();
    var lane = routeAgent();
    root.setAttribute('data-open', 'true');
    startViewportSync();
    document.body.style.overflow = 'hidden';
    /* Focus the dialog immediately so there is never a frame where keyboard
     * focus remains behind the modal. The first usable control takes focus
     * on the next frame once the initial message has been rendered. */
    root.focus();
    requestAnimationFrame(function () {
      var firstControl = root.querySelector('button, input, [href], [tabindex]:not([tabindex="-1"])');
      if (firstControl) firstControl.focus();
    });

    emit('popup_view', {
      trigger: (decision && decision.trigger) || 'manual',
      reason: (decision && decision.reason) || '',
      engagementScore: (decision && decision.engagementScore) || 0,
      abandonScore: (decision && decision.abandonScore) || 0,
      intentScore: (decision && decision.intentScore) || 0,
      scrollDepth: (decision && decision.snapshot && decision.snapshot.maxDepth) || 0,
      currentScrollDepth: (decision && decision.snapshot && decision.snapshot.depth) || 0,
      scrollVelocity: (decision && decision.snapshot && decision.snapshot.velocity) || 0,
      engagedSeconds: (decision && decision.snapshot && decision.snapshot.engagedTime) || 0,
      timeOnPage: (decision && decision.snapshot && decision.snapshot.timeOnPage) || 0,
      visitNumber: (decision && decision.snapshot && decision.snapshot.visit) || 0,
      pageVariant: (decision && decision.pageVariant) || '',
      experimentId: (decision && decision.experimentId) || '',
      experimentVariant: (decision && decision.experimentVariant) || '',
      experimentBucket: (decision && decision.experimentBucket) || 0,
      holdoutPercent: (decision && decision.holdoutPercent) || 0,
      conversationId: convId,
      agent: lane.laneId,
      placement: context.placement
    });
    if (window.NovaHairAttribution) {
      window.NovaHairAttribution.ga('popup_view', { agent: lane.laneId, placement: context.placement });
    }

    if (lane.sales) {
      say(lane.opener || F.openers[context.angle] || F.openers.default).then(function () {
        go(lane.entry);
      });
    } else {
      /* Retention / VIP / service: the entry node opens the conversation. */
      go(lane.entry);
    }
  }

  window.NovaHairAIPopup = {
    open: open,
    close: finish,
    getTranscript: function () { return transcript.slice(); },
    getContext: function () { return JSON.parse(JSON.stringify(context)); },
    /* Test seam: exercise the coupon-gate decision with explicit tags. */
    __offerDecision: function (which, tags) { return offerDecision(which, tags || []); }
  };

  /* Auto-wire to the behavioural engine when both are present. */
  if (window.NovaHairPopupEngine && typeof window.NovaHairPopupEngine.onDecision === 'function') {
    window.NovaHairPopupEngine.onDecision(open);
  }
})();
