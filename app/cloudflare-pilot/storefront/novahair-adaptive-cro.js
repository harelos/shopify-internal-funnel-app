/* NovaHair adaptive CRO engine — experiment nova_adaptive_cro_v2.
 *
 * PostHog assigns the variant; this file only reacts to what the shopper does.
 * Without a variant (flag missing, PostHog blocked, no consent) nothing renders and
 * nothing is captured: the page behaves exactly as it does today.
 *
 * Variants: control | value_delta | shade_rescue | scroll_rescue | full_adaptive
 * QA only:  ?nova_cro_variant=<variant> forces a variant for the current page load.
 */
(function (global) {
  'use strict';

  var FLAG = 'nova_adaptive_cro_v2';
  var STATE_KEY = 'nova_adaptive_state_v1';
  var PRICE = { 2: 189, 4: 239, 6: 319 };
  var FROM = 2, TO = 4, DELTA = 50, PER_EXTRA = 25;
  var IDLE_MS = 12000;          /* time inside the shade area that counts as hesitation */
  var DEPTH = 0.45;             /* page depth that arms the scroll rescue */
  var VARIANTS = ['control', 'value_delta', 'shade_rescue', 'scroll_rescue', 'full_adaptive'];

  var doc = document;
  function q(sel, root) { return (root || doc).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  function on(el, type, fn, opts) { if (el) el.addEventListener(type, fn, opts || false); }
  function guard(label, fn) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (err) { report(label, err); }
    };
  }
  function report(label, err) {
    try {
      if (global.posthog && typeof global.posthog.capture === 'function' && state.variant) {
        global.posthog.capture('nova_cro_error', { where: label, message: String((err && err.message) || err).slice(0, 200) });
      }
    } catch (_) {}
  }

  /* ---------------------------------------------------------------- state */

  var state = {
    variant: null,            /* locked once PostHog (or the QA override) gives a real one */
    on: { valueDelta: false, shadeRescue: false, scrollRescue: false },
    bundle: null,             /* 2 | 4 | 6 */
    shade: null,              /* shade key, or 'mix' */
    shadeChanges: 0,          /* changes of mind after the first pick */
    lastShade: null,
    bundleTouched: false,
    interacted: false,        /* a real gesture has happened, so DOM changes are hers */
    addedToCart: false,
    checkoutStarted: false,
    maxDepth: 0,
    shadeVisibleMs: 0,
    source: null,             /* what caused the bundle change being observed */
    open: { vd: false, sr: false, sc: false, cartDelta: false, cart: false }
  };

  /* what may still be shown this session, persisted so a reload does not repeat an offer */
  var session = { vdBuy: 0, vdCart: 0, vdDeclines: 0, sr: 0, sc: 0 };
  function loadSession() {
    try {
      var raw = global.sessionStorage.getItem(STATE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      for (var key in session) if (typeof saved[key] === 'number') session[key] = saved[key];
    } catch (_) {}
  }
  function saveSession() {
    try { global.sessionStorage.setItem(STATE_KEY, JSON.stringify(session)); } catch (_) {}
  }

  /* ---------------------------------------------------------------- events */

  var sent = [];   /* kept in memory so QA can read exactly what was captured */

  function capture(name, extra) {
    if (!state.variant) return;
    var props = {
      experiment_variant: state.variant,
      selected_bundle: state.bundle == null ? null : String(state.bundle),
      selected_shade: state.shade,
      page_path: global.location.pathname
    };
    if (extra) for (var key in extra) props[key] = extra[key];
    sent.push({ name: name, props: props, at: Date.now() });
    try { if (global.posthog && typeof global.posthog.capture === 'function') global.posthog.capture(name, props); }
    catch (err) { report('capture:' + name, err); }
    /* the live beacon listens for this; it is a page-local event, nothing leaves the browser here */
    try { doc.dispatchEvent(new CustomEvent('nova-cro:event', { detail: { name: name, props: props } })); } catch (_) {}
  }

  /* Revenue attribution that does not depend on PostHog reaching the thank-you page:
   * the variant is written onto the Shopify cart, so every order carries it. */
  function tagCart() {
    if (!state.variant || tagCart.done) return;
    tagCart.done = true;
    var job = function () {
      var root = (global.Shopify && global.Shopify.routes && global.Shopify.routes.root) || '/';
      return fetch(root + 'cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ attributes: { nova_cro_variant: state.variant, nova_cro_experiment: FLAG } })
      }).catch(function () { tagCart.done = false; });
    };
    if (typeof global.novaFunnelEnqueueCartMutation === 'function') global.novaFunnelEnqueueCartMutation('nova-cro-attribute', job);
    else job();
  }

  /* ---------------------------------------------------------------- reading the page */

  function bundleOf(card) {
    if (!card) return null;
    var attr = card.getAttribute('data-nova-bundle');
    if (attr) return Number(attr) || null;
    var match = (card.getAttribute('data-offer') || '').match(/pack(\d+)/);
    return match ? Number(match[1]) : null;
  }
  function selectedBundle() { return bundleOf(q('.nova .bundle-card.sel')); }
  function mixCounts() {
    var counts = {}, total = 0, keys = 0;
    qa('[id^="mmQty_"]').forEach(function (node) {
      var value = Number(node.textContent || 0) || 0;
      if (value > 0) { counts[node.id.slice(6)] = value; total += value; keys++; }
    });
    return { counts: counts, total: total, keys: keys };
  }
  function selectedShade() {
    if (mixCounts().keys > 1) return 'mix';
    var option = q('.nova .nh-shade-option-v2.sel') || q('.nova .shade-option.sel');
    return option ? (option.getAttribute('data-nova-shade') || option.getAttribute('data-color')) : null;
  }

  /* ---------------------------------------------------------------- module plumbing */

  function el(tag, cls, html) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }
  /* Reveal on the next frame so the transition runs from its resting state. A backgrounded tab
   * never paints a frame, so a timer makes sure the module is never left invisible. */
  function reveal(node) {
    node.classList.add('nh-cro--on');
    var show = function () { node.classList.add('nh-cro--in'); };
    global.requestAnimationFrame(function () { global.requestAnimationFrame(show); });
    global.setTimeout(show, 120);
  }
  function hide(node) {
    if (!node) return;
    node.classList.remove('nh-cro--in');
    node.classList.remove('nh-cro--on');
  }
  /* "viewed" means it really came into view, not merely that it was inserted. */
  function whenSeen(node, fn) {
    if (!global.IntersectionObserver) { fn(); return; }
    var observer = new global.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        fn();
      });
    }, { threshold: 0.5 });
    observer.observe(node);
  }
  function anyOpen() { return state.open.vd || state.open.sr || state.open.sc; }

  /* The sticky buy bar is fixed over the bottom ~185px of the screen. A module revealed under it
   * looks tappable and is not, which is how taps get eaten. Nudge it clear of the bar. */
  function clearOfStickyBar(node) {
    var nudge = function (smooth) {
      var bar = q('#stickyBuyBar');
      var hidden = !bar || bar.classList.contains('nh-sticky-v3--suppressed') || global.getComputedStyle(bar).visibility === 'hidden';
      var limit = hidden ? (global.innerHeight || 0) : bar.getBoundingClientRect().top;
      var overlap = node.getBoundingClientRect().bottom - limit + 12;
      if (overlap <= 0) return false;
      /* Safari before 15.4 ignores the object form silently instead of throwing, so the plain
       * two-argument call is the one that has to do the actual correcting. */
      if (smooth) { try { global.scrollBy({ top: overlap, behavior: 'smooth' }); } catch (_) {} }
      else { global.scrollBy(0, overlap); }
      return true;
    };
    var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!nudge(!reduced)) return;
    /* smooth scrolling is ignored in some in-app browsers; check and correct instantly if so */
    global.setTimeout(function () { nudge(false); }, 500);
  }

  /* ---------------------------------------------------------------- module 1: bundle value delta */

  var vdNode = null;
  function buildValueDelta() {
    if (vdNode) return vdNode;
    vdNode = el('div', 'nh-cro nh-cro-vd',
      '<div class="nh-cro-vd__eyebrow">שימי לב להבדל</div>' +
      '<div class="nh-cro-vd__main"><span class="nh-cro-vd__plus">+₪' + DELTA + '</span>' +
      '<span class="nh-cro-vd__gain">וקבלי <b>עוד ' + (TO - FROM) + ' בקבוקים</b></span></div>' +
      '<div class="nh-cro-vd__cmp">' + FROM + ' בקבוקים · ₪' + PRICE[FROM] + ' ← <b>' + TO + ' בקבוקים · ₪' + PRICE[TO] + '</b></div>' +
      '<div class="nh-cro-vd__sub">כל בקבוק נוסף יוצא רק ₪' + PER_EXTRA + '</div>' +
      '<div class="nh-cro-vd__row">' +
      '<button type="button" class="nh-cro-vd__cta">שדרגי ל־' + TO + ' בקבוקים</button>' +
      '<button type="button" class="nh-cro-vd__decline">אשאר עם ' + FROM + '</button>' +
      '</div>');
    vdNode.setAttribute('data-nova-module', 'value-delta');
    vdNode.setAttribute('role', 'status');
    on(q('.nh-cro-vd__cta', vdNode), 'click', guard('vd-upgrade', function () {
      hideValueDelta();
      capture('nova_value_delta_upgrade', {
        from_bundle: String(FROM), to_bundle: String(TO),
        from_price: PRICE[FROM], to_price: PRICE[TO], delta_ils: DELTA, placement: 'buy_box'
      });
      state.source = 'value_delta_module';
      selectPack(TO);
    }));
    on(q('.nh-cro-vd__decline', vdNode), 'click', guard('vd-decline', function () {
      hideValueDelta();
      session.vdDeclines += 1; saveSession();
      capture('nova_value_delta_decline', { placement: 'buy_box', declines: session.vdDeclines });
    }));
    return vdNode;
  }
  function hideValueDelta() { state.open.vd = false; hide(vdNode); }
  function showValueDelta() {
    var anchor = q('.nova .bundle-card[data-nova-bundle="' + FROM + '"]') || q('.nova .bundle-card[data-offer="pack' + FROM + '"]');
    if (!anchor || !anchor.parentNode) return;
    var node = buildValueDelta();
    if (node.previousElementSibling !== anchor) anchor.parentNode.insertBefore(node, anchor.nextSibling);
    state.open.vd = true;
    session.vdBuy += 1; saveSession();
    reveal(node);
    global.setTimeout(function () { clearOfStickyBar(node); }, 60);
    whenSeen(node, function () {
      capture('nova_cro_module_viewed', { module: 'value_delta', placement: 'buy_box', target_bundle: String(TO), delta_ils: DELTA });
    });
  }

  /* ---------------------------------------------------------------- module 2: shade rescue */

  var srNode = null;
  function openPageCompare() {
    var trigger = q('.nova [data-nova-action="shade-compare"]') || q('.nova .nh-shade-compare-trigger-v2');
    if (trigger) trigger.click();
  }
  function buildShadeRescue() {
    if (srNode) return srNode;
    srNode = el('div', 'nh-cro nh-cro-sr',
      '<div class="nh-cro-sr__q">מתלבטת בין שני גוונים?</div>' +
      '<div class="nh-cro-sr__a">בחרי קודם את הגוון שהכי קרוב לצבע הבסיס שלך. עדיין לא בטוחה? השווי ביניהם כאן.</div>' +
      '<div class="nh-cro-sr__row">' +
      '<button type="button" class="nh-cro-sr__cta">השווי בין שני גוונים</button>' +
      '<button type="button" class="nh-cro-sr__help">איך לבחור נכון?</button>' +
      '</div>');
    srNode.setAttribute('data-nova-module', 'shade-rescue');
    srNode.setAttribute('role', 'status');
    on(q('.nh-cro-sr__cta', srNode), 'click', guard('sr-compare', function () {
      capture('nova_shade_compare_clicked', { source: 'shade_rescue' });
      hideShadeRescue();
      openPageCompare();
    }));
    on(q('.nh-cro-sr__help', srNode), 'click', guard('sr-help', function () {
      capture('nova_shade_help_clicked', { source: 'shade_rescue' });
      openPageCompare();
    }));
    return srNode;
  }
  function hideShadeRescue() { state.open.sr = false; hide(srNode); }
  function showShadeRescue(reason) {
    var box = q('.nova .step-box.nh-shade-selector-v2');
    if (!box) return;
    var after = q('.nova .nh-shade-actions-v3');
    var node = buildShadeRescue();
    if (after && after.parentNode === box) {
      if (node.previousElementSibling !== after) box.insertBefore(node, after.nextSibling);
    } else if (node.parentNode !== box) box.appendChild(node);
    state.open.sr = true;
    session.sr += 1; saveSession();
    reveal(node);
    global.setTimeout(function () { clearOfStickyBar(node); }, 60);
    whenSeen(node, function () { capture('nova_cro_module_viewed', { module: 'shade_rescue', trigger: reason }); });
  }

  /* ---------------------------------------------------------------- module 3: scroll rescue */

  var scNode = null;
  function buildScrollRescue() {
    if (scNode) return scNode;
    scNode = el('div', 'nh-cro nh-cro-sc-wrap',
      '<div class="nh-cro-sc">' +
      '<div class="nh-cro-sc__h">עדיין מתלבטת?</div>' +
      '<div class="nh-cro-sc__offer">' + TO + ' בקבוקים ב־₪' + PRICE[TO] + '</div>' +
      '<div class="nh-cro-sc__sub">פחות מ־₪60 לבקבוק</div>' +
      '<button type="button" class="nh-cro-sc__cta">בחרי גוון והמשיכי להזמנה</button>' +
      '<div class="nh-cro-sc__trust">משלוח חינם לנקודת איסוף · 60 יום אחריות</div>' +
      '</div>');
    scNode.setAttribute('data-nova-module', 'scroll-rescue');
    scNode.setAttribute('role', 'status');
    on(q('.nh-cro-sc__cta', scNode), 'click', guard('sc-click', function () {
      capture('nova_scroll_rescue_clicked', {});
      hideScrollRescue();
      var target = q('.nova .step-box.nh-shade-selector-v2') || q('.nova #buy');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    return scNode;
  }
  function hideScrollRescue() { state.open.sc = false; hide(scNode); }
  /* Inserted at the next section boundary BELOW the fold, so nothing moves under her thumb. */
  function scrollAnchor() {
    var offset = global.scrollY || global.pageYOffset || 0;
    var bottom = offset + (global.innerHeight || 0);
    var sections = qa('.nova section.sec');
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top + offset > bottom) return sections[i];
    }
    return null;
  }
  function showScrollRescue() {
    var anchor = scrollAnchor();
    if (!anchor || !anchor.parentNode) return;
    var node = buildScrollRescue();
    anchor.parentNode.insertBefore(node, anchor);
    state.open.sc = true;
    session.sc += 1; saveSession();
    reveal(node);
    whenSeen(node, function () { capture('nova_cro_module_viewed', { module: 'scroll_rescue', trigger: 'depth_45' }); });
  }

  /* ---------------------------------------------------------------- module 4: value delta in the cart */

  var cartNode = null, cartBusy = false;
  function buildCartDelta() {
    if (cartNode) return cartNode;
    cartNode = el('div', 'nh-cro-cart',
      '<div class="nh-cro-cart__t">לפני שממשיכים — יש כאן שדרוג משתלם</div>' +
      '<div class="nh-cro-cart__m">רק <b>₪' + DELTA + '</b> נוספים = עוד ' + (TO - FROM) + ' בקבוקים</div>' +
      '<div class="nh-cro-cart__c">' + FROM + ' בקבוקים · ₪' + PRICE[FROM] + ' ← <b>' + TO + ' בקבוקים · ₪' + PRICE[TO] + '</b></div>' +
      '<button type="button" class="nh-cro-cart__cta">שדרגי ל־' + TO + ' בקבוקים</button>');
    cartNode.setAttribute('data-nova-module', 'value-delta-cart');
    on(q('.nh-cro-cart__cta', cartNode), 'click', guard('cart-upgrade', upgradeInCart));
    return cartNode;
  }
  function cartHost() {
    var drawer = q('cart-drawer');
    if (!drawer) return null;
    var button = q('#CartDrawer-Checkout', drawer) || q('[name="checkout"]', drawer);
    if (!button) return null;
    return (button.closest && button.closest('.cart__ctas')) || button.parentNode;
  }
  function placeCartDelta() {
    if (!state.open.cartDelta) return;
    var host = cartHost();
    if (!host) return;
    var node = buildCartDelta();
    if (node.parentNode !== host) host.insertBefore(node, host.firstChild);
    reveal(node);
  }
  function hideCartDelta() { state.open.cartDelta = false; hide(cartNode); }

  /* Upgrading from the cart runs the page's own buy flow, so the adapter replaces the one
   * main line instead of adding a second one. A custom mix is doubled, not thrown away. */
  function upgradeInCart() {
    if (cartBusy) return;
    cartBusy = true;
    var button = cartNode && q('.nh-cro-cart__cta', cartNode);
    if (button) { button.disabled = true; button.textContent = 'מעדכנת…'; }
    capture('nova_value_delta_upgrade', {
      from_bundle: String(FROM), to_bundle: String(TO),
      from_price: PRICE[FROM], to_price: PRICE[TO], delta_ils: DELTA, placement: 'side_cart'
    });
    var before = mixCounts();
    state.source = 'sidecart_upgrade';
    selectPack(TO);
    if (before.keys > 1) rebalanceMix(before.counts, TO / FROM);
    var done = function () {
      cartBusy = false;
      if (button) { button.disabled = false; button.textContent = 'שדרגי ל־' + TO + ' בקבוקים'; }
      hideCartDelta();
    };
    try {
      var result = typeof global.executeBuy === 'function' ? global.executeBuy() : null;
      if (result && typeof result.then === 'function') result.then(done, done);
      else global.setTimeout(done, 1500);
    } catch (err) { report('executeBuy', err); done(); }
  }
  /* Changing pack collapses a mix into the primary shade; put her own distribution back, doubled. */
  function rebalanceMix(counts, factor) {
    if (typeof global.updateMmQty !== 'function') return;
    var target = {}, key, now;
    for (key in counts) target[key] = counts[key] * factor;
    now = mixCounts().counts;
    for (key in now) if (!(key in target)) target[key] = 0;
    for (key in target) {          /* release quantities first, or the bundle-size cap blocks the rest */
      var down = (target[key] || 0) - (now[key] || 0);
      if (down < 0) global.updateMmQty(key, down);
    }
    now = mixCounts().counts;
    for (key in target) {
      var up = (target[key] || 0) - (now[key] || 0);
      if (up > 0) global.updateMmQty(key, up);
    }
  }

  /* ---------------------------------------------------------------- acting on the page */

  function selectPack(qty) {
    var card = q('.nova .bundle-card[data-nova-bundle="' + qty + '"]') || q('.nova .bundle-card[data-offer="pack' + qty + '"]');
    if (card) { card.click(); return; }                 /* the page's own handler does the rest */
    if (typeof global.selectPack === 'function') global.selectPack('pack' + qty);
  }

  /* ---------------------------------------------------------------- triggers */

  function onBundleChange(qty) {
    if (!state.interacted) { state.bundle = qty; return; }   /* the page's own start-up selection */
    var source = state.source || 'hero_bundle_selector';
    state.source = null;
    state.bundle = qty;
    state.bundleTouched = true;
    if (state.open.sr) hideShadeRescue();                    /* priority: she is past the shade step */
    capture('nova_bundle_selected', { bundle: String(qty), price: PRICE[qty] || null, source: source });
    if (qty !== FROM) { hideValueDelta(); return; }
    if (!state.on.valueDelta) return;
    capture('nova_cro_triggered', { module: 'value_delta', reason: 'selected_2_pack' });
    if (session.vdBuy >= 1 || session.vdDeclines >= 1 || anyOpen()) return;
    showValueDelta();
  }

  function onShadeChange(shade) {
    var previous = state.lastShade;
    state.shade = shade;
    if (shade && shade !== 'mix') {
      if (previous && previous !== shade) state.shadeChanges += 1;
      state.lastShade = shade;
    }
    if (state.shadeChanges >= 2) maybeShadeRescue('multiple_shade_changes');
  }

  function maybeShadeRescue(reason) {
    if (!state.on.shadeRescue) return;
    capture('nova_cro_triggered', { module: 'shade_rescue', reason: reason, shade_changes: state.shadeChanges });
    if (session.sr >= 1 || state.bundleTouched || anyOpen()) return;
    showShadeRescue(reason);
  }

  function maybeScrollRescue() {
    if (!state.on.scrollRescue || session.sc >= 1) return;
    if (state.addedToCart || state.checkoutStarted || state.bundleTouched) return;
    // Reported only when the module actually shows. Reporting before the
    // open-dialog check fired on every scroll past 45% while another module
    // was open: 257 events from nine shoppers on 2026-09-18.
    if (anyOpen()) return;
    capture('nova_cro_triggered', { module: 'scroll_rescue', reason: 'depth_45', depth: Math.round(state.maxDepth * 100) });
    showScrollRescue();
  }

  function onAddedToCart() {
    state.addedToCart = true;
    hideValueDelta(); hideShadeRescue(); hideScrollRescue();
    capture('nova_add_to_cart', { bundle: String(state.bundle), price: PRICE[state.bundle] || null });
    tagCart();
    if (state.bundle !== FROM || !state.on.valueDelta) return;
    capture('nova_cro_triggered', { module: 'value_delta', reason: 'added_2_pack_to_cart' });
    if (session.vdCart >= 1 || session.vdDeclines >= 2) return;
    session.vdCart += 1; saveSession();
    state.open.cartDelta = true;
    placeCartDelta();
    if (cartNode) whenSeen(cartNode, function () {
      capture('nova_cro_module_viewed', { module: 'value_delta', placement: 'side_cart', target_bundle: String(TO), delta_ils: DELTA });
    });
  }

  /* ---------------------------------------------------------------- wiring */

  function watchBundles() {
    var wrap = q('.nova .bundle-cards-container');
    if (!wrap) return;
    state.bundle = selectedBundle();
    new global.MutationObserver(guard('bundle-observer', function () {
      var qty = selectedBundle();
      if (qty && qty !== state.bundle) onBundleChange(qty);
    })).observe(wrap, { attributes: true, attributeFilter: ['class'], subtree: true });
  }

  function watchShades() {
    state.shade = selectedShade();
    state.lastShade = state.shade === 'mix' ? null : state.shade;
    var grid = q('.nova .nh-shade-grid-v2') || q('.nova .shade-grid');
    if (grid) {
      new global.MutationObserver(guard('shade-observer', function () {
        var shade = selectedShade();
        if (shade !== state.shade) onShadeChange(shade);
      })).observe(grid, { attributes: true, attributeFilter: ['class', 'aria-current', 'aria-checked'], subtree: true });
    }
    var drawer = q('.nova #mmDrawer');
    if (drawer) {
      new global.MutationObserver(guard('mix-observer', function () {
        var shade = selectedShade();
        if (shade !== state.shade) state.shade = shade;
      })).observe(drawer, { childList: true, characterData: true, subtree: true });
    }
  }

  function watchShadeDwell() {
    var box = q('.nova .step-box.nh-shade-selector-v2');
    if (!box || !global.IntersectionObserver) return;
    var since = 0, timer = null;
    var stop = function () {
      if (!since) return;
      state.shadeVisibleMs += Date.now() - since;
      since = 0;
      if (timer) { global.clearTimeout(timer); timer = null; }
    };
    new global.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) { stop(); return; }
        if (since) return;
        since = Date.now();
        timer = global.setTimeout(guard('dwell', function () {
          stop();
          if (!state.bundleTouched) maybeShadeRescue('idle_in_shade_area');
        }), Math.max(0, IDLE_MS - state.shadeVisibleMs));
      });
    }, { threshold: 0.35 }).observe(box);
    on(doc, 'visibilitychange', function () { if (doc.hidden) stop(); });
  }

  function watchDepth() {
    var ticking = false;
    var measure = guard('depth', function () {
      ticking = false;
      var height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight) - (global.innerHeight || 0);
      if (height <= 0) return;
      var depth = (global.scrollY || global.pageYOffset || 0) / height;
      if (depth > state.maxDepth) state.maxDepth = depth;
      if (state.maxDepth >= DEPTH) maybeScrollRescue();
    });
    /* a timer, not requestAnimationFrame: the Facebook and Instagram in-app browsers throttle
     * frames hard, and this has to keep measuring there */
    var schedule = function () {
      if (ticking) return;
      ticking = true;
      global.setTimeout(measure, 200);
    };
    on(global, 'scroll', schedule, { passive: true });
    schedule();                       /* she may land already scrolled, e.g. coming back */
  }

  function watchCart() {
    on(doc, 'sales-page-commerce:added', guard('added', onAddedToCart));
    var drawer = q('cart-drawer');
    if (!drawer) return;
    new global.MutationObserver(guard('drawer-observer', function () {
      var isOpen = drawer.classList.contains('active');
      if (isOpen !== state.open.cart) {
        state.open.cart = isOpen;
        if (isOpen) capture('nova_sidecart_opened', { bundle: String(state.bundle), price: PRICE[state.bundle] || null });
        else hideCartDelta();
      }
      if (state.open.cartDelta && isOpen) placeCartDelta();   /* the drawer re-renders itself on every change */
    })).observe(drawer, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  }

  function watchClicks() {
    on(doc, 'pointerdown', function (event) { if (event.isTrusted) state.interacted = true; }, { passive: true, capture: true });
    on(doc, 'keydown', function (event) { if (event.isTrusted) state.interacted = true; }, true);
    on(doc, 'click', guard('click', function (event) {
      if (!event.isTrusted) return;             /* clicks this engine dispatches are not shopper taps */
      var target = event.target;
      if (!target || !target.closest) return;
      state.interacted = true;
      if (target.closest('.nova .bundle-cards-container')) state.source = 'hero_bundle_selector';
      else if (target.closest('.nova [data-return-to-buybox]')) state.source = 'midpage_bundle_selector';
      else if (target.closest('#stickyBuyBar')) state.source = 'sticky_cta';
      if (target.closest('.nova [data-nova-action="shade-compare"], .nova .nh-shade-compare-trigger-v2')) {
        capture('nova_shade_compare_clicked', { source: 'page' });
        maybeShadeRescue('compare_opened');
      }
      if (target.closest('#CartDrawer-Checkout, cart-drawer [name="checkout"]')) {
        state.checkoutStarted = true;
        capture('nova_checkout_clicked', { bundle: String(state.bundle), price: PRICE[state.bundle] || null, source: 'side_cart' });
      }
    }), true);
  }

  /* ---------------------------------------------------------------- start */

  function start(variant) {
    if (state.variant || VARIANTS.indexOf(variant) === -1) return;   /* the first real variant wins and is then fixed */
    state.variant = variant;
    state.on.valueDelta = variant === 'value_delta' || variant === 'full_adaptive';
    state.on.shadeRescue = variant === 'shade_rescue' || variant === 'full_adaptive';
    state.on.scrollRescue = variant === 'scroll_rescue' || variant === 'full_adaptive';
    try { if (global.posthog && typeof global.posthog.register === 'function') global.posthog.register({ nova_cro_variant: variant }); } catch (_) {}
    doc.documentElement.setAttribute('data-nova-cro', variant);
    if (state.addedToCart) tagCart();
  }

  /* ------------------------------------------------------------ self-assignment */

  /* PostHog only answers once the shopper has accepted cookies. On the first night that left
   * roughly five sessions in seven with no variant at all, including both paid orders, so the
   * test measured almost nobody. The page therefore buckets the visitor itself, from a key it
   * already has, and tells PostHog afterwards. Same FNV-1a hash as src/lib/cro-assignment.ts:
   * keep the two in step or a visitor lands in different buckets in different places. */

  var SPLIT_URL = '/apps/funnels/cro-split';
  var SPLIT_CACHE_KEY = 'nova_cro_split_v1';
  var SPLIT_CACHE_MS = 10 * 60 * 1000;
  var DEFAULT_SPLIT = [{ key: 'control', weight: 50 }, { key: 'full_adaptive', weight: 50 }];

  function visitorKey() {
    var m = doc.cookie.match(/(?:^|; )_fc_visitor=([^;]+)/);
    var fromCookie = m ? decodeURIComponent(m[1]) : '';
    if (/^[A-Za-z0-9_-]{8,120}$/.test(fromCookie)) return fromCookie;
    try {
      var stored = global.localStorage.getItem('nh_live_visitor');
      if (stored) return stored;
      var fresh = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      global.localStorage.setItem('nh_live_visitor', fresh);
      return fresh;
    } catch (_) {
      /* storage denied: still bucket this page load rather than dropping the visitor */
      return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }
  }

  function hashKey(key) {
    var hash = 2166136261;
    for (var i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function bucket(key, weights) {
    var eligible = [];
    for (var i = 0; i < weights.length; i += 1) {
      if (weights[i] && Number(weights[i].weight) > 0 && VARIANTS.indexOf(weights[i].key) !== -1) eligible.push(weights[i]);
    }
    if (!eligible.length || !key) return null;
    var total = 0;
    for (var t = 0; t < eligible.length; t += 1) total += Number(eligible[t].weight);
    var point = hashKey(key) % total;
    for (var v = 0; v < eligible.length; v += 1) {
      point -= Number(eligible[v].weight);
      if (point < 0) return eligible[v].key;
    }
    return eligible[eligible.length - 1].key;
  }

  function cachedSplit() {
    try {
      var raw = global.localStorage.getItem(SPLIT_CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.at || Date.now() - parsed.at > SPLIT_CACHE_MS) return null;
      return parsed;
    } catch (_) { return null; }
  }

  function assignFrom(split) {
    if (state.variant) return;
    if (split && split.active === false) return;         /* test paused: leave the page alone */
    var weights = (split && split.variants && split.variants.length) ? split.variants : DEFAULT_SPLIT;
    var chosen = bucket(visitorKey(), weights);
    if (chosen) start(chosen);
  }

  /* Ask for the current split, but never block on it: a cached or default split buckets the
   * visitor straight away, and a fresher answer only changes who is bucketed next time. */
  function selfAssign() {
    var cached = cachedSplit();
    if (cached) assignFrom(cached);
    var done = false;
    try {
      global.fetch(SPLIT_URL, { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (body) {
        done = true;
        if (!body || !body.variants) return;
        try { global.localStorage.setItem(SPLIT_CACHE_KEY, JSON.stringify({ at: Date.now(), active: body.active, variants: body.variants })); } catch (_) {}
        assignFrom(body);
      })['catch'](function () { done = true; assignFrom(cached || null); });
    } catch (_) { assignFrom(cached || null); }
    /* if the network is slow or blocked, bucket anyway rather than losing the visitor */
    global.setTimeout(function () { if (!done) assignFrom(cached || null); }, 1500);
  }

  /* This store starts PostHog opted out and opts in only after Shopify reports consent, which
   * leaves the flags unfetched: onFeatureFlags never fires on its own here. So ask for them, then
   * watch until they arrive. getAllFeatureFlags does not record an exposure, so the poll is silent;
   * getFeatureFlag is called once, when there is a real answer, and that is the exposure. */
  function watchFlags() {
    var ph = global.posthog;
    if (!ph) return;
    var tries = 0;
    var check = guard('flags', function () {
      if (state.variant) return;
      var flags = typeof ph.getAllFeatureFlags === 'function' ? ph.getAllFeatureFlags() : null;
      var present = flags && (Array.isArray(flags)
        ? flags.some(function (f) { return f && f.key === FLAG; })
        : Object.prototype.hasOwnProperty.call(flags, FLAG));
      if (present && typeof ph.getFeatureFlag === 'function') {
        /* Records the exposure for shoppers who did consent, so PostHog's own view still works.
         * The variant this page uses is already decided; PostHog no longer overrides it. */
        var variant = ph.getFeatureFlag(FLAG);
        if (variant) { start(String(variant)); return; }
      }
      /* Consent has to land before PostHog will fetch anything, and on this page that can take
       * a while, so ask twice and keep watching for a minute rather than giving up at 8s.
       * getAllFeatureFlags above is a local read: polling it costs nothing and records no exposure. */
      if ((tries === 0 || tries === 8) && typeof ph.reloadFeatureFlags === 'function') ph.reloadFeatureFlags();
      tries += 1;
      if (tries < 25) global.setTimeout(check, 400);          /* first 10s, closely */
      else if (tries < 50) global.setTimeout(check, 2000);    /* then every 2s out to ~60s */
    });
    if (typeof ph.onFeatureFlags === 'function') ph.onFeatureFlags(check);
    global.setTimeout(check, 250);
  }

  function boot() {
    loadSession();
    watchClicks();
    watchBundles();
    watchShades();
    watchShadeDwell();
    watchDepth();
    watchCart();

    var override = null;
    try { override = new global.URLSearchParams(global.location.search).get('nova_cro_variant'); } catch (_) {}
    if (override && VARIANTS.indexOf(override) !== -1) start(override);   /* QA only, this page load only */
    else { selfAssign(); watchFlags(); }

    global.NovaCRO = {
      get variant() { return state.variant; },
      get valueDelta() { return state.on.valueDelta; },
      get shadeRescue() { return state.on.shadeRescue; },
      get scrollRescue() { return state.on.scrollRescue; },
      get state() { return state; },
      get session() { return session; },
      get events() { return sent; }
    };
  }

  if (doc.readyState === 'loading') on(doc, 'DOMContentLoaded', guard('boot', boot));
  else guard('boot', boot)();
})(window);
