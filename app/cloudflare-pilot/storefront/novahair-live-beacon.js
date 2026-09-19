/* NovaHair live beacon.
 *
 * Reports what a shopper does on a sales page to the Worker as it happens, so the
 * Live screen in Funnel Control can show it seconds later. Only actions on the page:
 * no names, no emails, no typed text. Batched every two seconds, one request per
 * batch, sent through the Shopify app proxy which signs every request.
 *
 * Loaded by the sales page layout after the page's own scripts. ES5 on purpose.
 */
(function (global) {
  'use strict';
  var doc = document;
  var PAGE = global.location.pathname;
  if (!/^\/pages\//.test(PAGE)) return;

  var ENDPOINT = '/apps/funnels/live';
  var FLUSH_MS = 2000, MAX_BATCH = 20, MAX_PER_LOAD = 80;
  var queue = [], timer = null, sent = 0, started = Date.now();

  function rand() { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
  function stored(store, name) {
    try { var v = store.getItem(name); if (!v) { v = rand(); store.setItem(name, v); } return v; } catch (_) { return rand(); }
  }
  function cookie(name) { var m = doc.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; }
  function text(el, max) { return String((el && (el.getAttribute('aria-label') || el.getAttribute('data-label') || el.textContent)) || '').replace(/\s+/g, ' ').trim().slice(0, max || 60); }

  var sessionKey = stored(global.sessionStorage, 'nh_live_session');
  var visitorKey = (cookie('_fc_visitor').match(/^[A-Za-z0-9_-]{8,120}$/) || [])[0] || stored(global.localStorage, 'nh_live_visitor');

  var params; try { params = new URLSearchParams(global.location.search); } catch (_) { params = { get: function () { return null; } }; }
  function sourceLabel() {
    try {
      var saved = global.sessionStorage.getItem('nh_live_source');
      if (saved) return saved;
    } catch (_) {}
    var utm = params.get('utm_source'), medium = params.get('utm_medium'), campaign = params.get('utm_campaign');
    var ref = ''; try { ref = doc.referrer ? new URL(doc.referrer).hostname.replace(/^www\./, '') : ''; } catch (_) {}
    var label = utm ? utm + (medium ? ' / ' + medium : '') + (campaign ? ' / ' + campaign.slice(0, 40) : '') : (ref || 'direct');
    if (/fbclid/.test(global.location.search) && !utm) label = 'facebook / paid';
    try { global.sessionStorage.setItem('nh_live_source', label); } catch (_) {}
    return label.slice(0, 80);
  }
  var source = sourceLabel();
  var isInternal = (function () {
    var flag = params.get('fc_internal') === '1' || params.get('tbg_qa') === '1' || Boolean(params.get('nova_cro_variant')) || /(?:^|; )_tbg_analytics_exclude=1/.test(doc.cookie);
    try { if (flag) global.sessionStorage.setItem('nh_live_internal', '1'); else if (global.sessionStorage.getItem('nh_live_internal') === '1') flag = true; } catch (_) {}
    return flag;
  })();
  var device = (function () {
    var ua = navigator.userAgent || '';
    var app = /FBAN|FBAV|FB_IAB/i.test(ua) ? '-facebook' : /Instagram/i.test(ua) ? '-instagram' : '';
    return (/iPhone|iPad/i.test(ua) ? 'iphone' : /Android/i.test(ua) ? 'android' : /Mobile/i.test(ua) ? 'mobile' : 'desktop') + app;
  })();

  function variant() { return doc.documentElement.getAttribute('data-nova-cro') || null; }
  /* Other tests the page runs, written by their own scripts (the exit popup's offer test). */
  function experiments() {
    try {
      var parsed = JSON.parse(global.localStorage.getItem('nh_experiments') || 'null');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }
  function payload(events) {
    return JSON.stringify({ sessionKey: sessionKey, visitorKey: visitorKey, page: PAGE, device: device, source: source, variant: variant(), experiments: experiments(), isInternal: isInternal, events: events });
  }
  function flush(unloading) {
    if (timer) { global.clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var batch = queue.splice(0, MAX_BATCH);
    var body = payload(batch);
    try {
      if (unloading && navigator.sendBeacon) {
        if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
      }
      global.fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body }).catch(function () {});
    } catch (_) {}
    if (queue.length) schedule();
  }
  function schedule() { if (!timer) timer = global.setTimeout(function () { flush(false); }, FLUSH_MS); }
  function push(kind, label, detail) {
    if (sent >= MAX_PER_LOAD) return;
    sent += 1;
    queue.push({ kind: kind, label: label, detail: detail || {}, at: Date.now() });
    if (queue.length >= MAX_BATCH) flush(false); else schedule();
  }

  /* ---- what we watch ---- */
  push('view', 'landed', { referrer: source, width: global.innerWidth, variant: variant() });

  var seenSections = {};
  var SECTION_LABELS = { buy: 'reached the buy box', 'proof-bar': 'passed the trust bar', 'before-after': 'looked at before / after', mechanism: 'reading how it works', formula: 'reading ingredients', 'how-to-use': 'reading how to use', 'social-proof': 'reading reviews', comparison: 'reading the comparison', 'offer-reentry': 'saw the offer again', guarantee: 'reading the guarantee', faq: 'reading the FAQ', 'reviews-full': 'reading all reviews' };
  if (global.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id; if (!id || seenSections[id]) return;
        seenSections[id] = true;
        push('section', SECTION_LABELS[id] || ('reached ' + id), { id: id });
      });
    }, { threshold: 0.4 });
    var sections = doc.querySelectorAll('section[id]');
    for (var i = 0; i < sections.length; i++) io.observe(sections[i]);
  }

  var lastDepth = 0;
  global.addEventListener('scroll', function () {
    var height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight) - global.innerHeight;
    if (height <= 0) return;
    var depth = Math.floor(((global.scrollY || global.pageYOffset || 0) / height) * 4) * 25;
    if (depth > lastDepth) { lastDepth = depth; if (depth >= 25) push('section', 'scrolled ' + depth + '%', { depth: depth }); }
  }, { passive: true });

  doc.addEventListener('click', function (event) {
    if (!event.isTrusted) return;
    var t = event.target; if (!t || !t.closest) return;
    var bundle = t.closest('.bundle-card');
    if (bundle) { var qty = bundle.getAttribute('data-nova-bundle') || (bundle.getAttribute('data-offer') || '').replace('pack', ''); push('bundle', 'chose ' + qty + ' bottles (₪' + (bundle.getAttribute('data-price') || '') + ')', { bundle: qty, price: bundle.getAttribute('data-price') }); return; }
    var shade = t.closest('.nh-shade-option-v2, .shade-option');
    if (shade) { var key = shade.getAttribute('data-nova-shade') || shade.getAttribute('data-color'); push('shade', 'picked shade ' + text(shade, 30), { shade: key }); return; }
    if (t.closest('[data-nova-action="shade-compare"], .nh-shade-compare-trigger-v2')) { push('compare', 'opened the shade comparison'); return; }
    if (t.closest('.mix-shades-btn')) { push('mix', 'opened mix shades'); return; }
    if (t.closest('.nh-cro-vd__cta')) { push('module_action', 'took the upgrade to 4 bottles', { module: 'value_delta' }); return; }
    if (t.closest('.nh-cro-vd__decline')) { push('module_action', 'declined the upgrade', { module: 'value_delta' }); return; }
    if (t.closest('.nh-cro-cart__cta')) { push('module_action', 'took the upgrade in the cart', { module: 'value_delta' }); return; }
    if (t.closest('.nh-cro-sr__cta, .nh-cro-sr__help')) { push('module_action', 'used shade help', { module: 'shade_rescue' }); return; }
    if (t.closest('.nh-cro-sc__cta')) { push('module_action', 'took the scroll shortcut', { module: 'scroll_rescue' }); return; }
    if (t.closest('#CartDrawer-Checkout, cart-drawer [name="checkout"]')) { push('checkout_click', 'went to checkout'); return; }
    if (t.closest('#mainCheckout, #stickyCtaBtn, [data-nova-action="add-to-cart"]')) { push('click', 'tapped the buy button: ' + text(t.closest('button'), 40)); return; }
    if (t.closest('.nh-exit-popup, .nh-exit-popup__dialog')) { push('popup', 'exit popup: ' + text(t.closest('button, a') || t, 40)); return; }
    if (t.closest('[data-return-to-buybox], .nh-midpage-cta__button')) { push('click', 'tapped a mid-page button'); return; }
    var control = t.closest('a, button, [role="button"], summary, .thumb');
    if (control) push('click', 'tapped ' + (control.tagName === 'A' ? 'link' : 'button') + (text(control, 40) ? ': ' + text(control, 40) : ''), { tag: control.tagName.toLowerCase(), id: control.id || null });
  }, true);

  doc.addEventListener('sales-page-commerce:added', function (event) {
    var sel = doc.querySelector('.bundle-card.sel');
    var qty = sel ? (sel.getAttribute('data-nova-bundle') || (sel.getAttribute('data-offer') || '').replace('pack', '')) : '';
    var detail = (event && event.detail) || {};
    push('cart_add', 'added ' + (qty ? qty + ' bottles' : 'the bundle') + ' to cart' + (detail.alreadyPresent ? ' (already there)' : ''), { bundle: qty, variantId: detail.variantId || null });
    flush(false);
  });
  var drawer = doc.querySelector('cart-drawer');
  if (drawer && global.MutationObserver) {
    var open = drawer.classList.contains('active');
    new MutationObserver(function () {
      var now = drawer.classList.contains('active');
      if (now !== open) { open = now; push(now ? 'cart_open' : 'cart_close', now ? 'opened the cart' : 'closed the cart'); }
    }).observe(drawer, { attributes: true, attributeFilter: ['class'] });
  }
  var MODULE_LABELS = { nova_cro_module_viewed: 'saw', nova_cro_triggered: 'qualified for', nova_value_delta_upgrade: 'upgraded via', nova_value_delta_decline: 'declined' };
  doc.addEventListener('nova-cro:event', function (event) {
    var d = (event && event.detail) || {}; var props = d.props || {};
    if (d.name === 'nova_cro_module_viewed') push('module', 'saw ' + String(props.module || '').replace(/_/g, ' ') + (props.placement ? ' (' + props.placement.replace(/_/g, ' ') + ')' : ''), { module: props.module, placement: props.placement || null });
    else if (d.name === 'nova_cro_triggered') push('module', 'qualified for ' + String(props.module || '').replace(/_/g, ' ') + ' (' + String(props.reason || '').replace(/_/g, ' ') + ')', { module: props.module, reason: props.reason || null, viewed: false });
  });

  function leave() {
    push('leave', 'left after ' + Math.round((Date.now() - started) / 1000) + 's', { seconds: Math.round((Date.now() - started) / 1000), depth: lastDepth });
    flush(true);
  }
  global.addEventListener('pagehide', leave);
  doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') flush(true); });
})(window);
