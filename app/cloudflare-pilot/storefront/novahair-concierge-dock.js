/* NovaHair concierge dock.
 *
 * The AI concierge opens only when the popup engine decides a shopper is about
 * to leave. This test gives half the visitors a small button that is always
 * there ("שאלה על הגוון? דברי איתי") so they can open the same concierge
 * whenever they want. The app decides the arm from the visitor key (same hash
 * as every other first-party test), the assignment is written where the live
 * beacon reads it, and the cart carries it so the order can be attributed.
 *
 * Loaded by the sales page layout after the concierge scripts. ES5 on purpose.
 */
(function (global) {
  'use strict';
  var doc = document;
  if (!/^\/pages\//.test(global.location.pathname)) return;
  var EXPERIMENT = 'nova_concierge_dock_v1';
  var ENDPOINT = '/apps/funnels/api/popup/offer-variant';
  var STORAGE = 'nh_experiments';

  function cookie(name) { var m = doc.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; }
  function visitorKey() {
    var fromCookie = cookie('_fc_visitor');
    if (/^[A-Za-z0-9_-]{8,120}$/.test(fromCookie)) return fromCookie;
    try {
      var stored = global.localStorage.getItem('nh_live_visitor');
      if (stored) return stored;
      var fresh = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      global.localStorage.setItem('nh_live_visitor', fresh);
      return fresh;
    } catch (_) { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
  }
  function remember(variant) {
    try {
      var all = JSON.parse(global.localStorage.getItem(STORAGE) || '{}');
      if (!all || typeof all !== 'object') all = {};
      all[EXPERIMENT] = variant;
      global.localStorage.setItem(STORAGE, JSON.stringify(all));
    } catch (_) {}
    var tag = function () {
      return global.fetch('/cart/update.js', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ attributes: { nova_concierge_dock: variant } })
      }).catch(function () {});
    };
    if (typeof global.novaFunnelEnqueueCartMutation === 'function') global.novaFunnelEnqueueCartMutation('nova-concierge-dock', tag); else tag();
  }
  function capture(name, props) {
    try { if (global.posthog && typeof global.posthog.capture === 'function') global.posthog.capture(name, props || {}); } catch (_) {}
  }

  var css = ''
    + '.nh-dock{position:fixed;right:14px;bottom:calc(92px + env(safe-area-inset-bottom,0px));z-index:9000;display:flex;align-items:center;gap:10px;'
    + 'max-width:calc(100vw - 28px);padding:10px 14px 10px 10px;border:0;border-radius:999px;background:#17231e;color:#fff;font:600 14px/1.2 "Heebo","Assistant",system-ui,sans-serif;'
    + 'box-shadow:0 10px 30px rgba(20,31,26,.28),0 2px 6px rgba(20,31,26,.18);cursor:pointer;direction:rtl;transition:transform .18s ease,opacity .18s ease}'
    + '.nh-dock:active{transform:scale(.97)}'
    + '.nh-dock__face{width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#f5d0c4,#d98a73);flex:0 0 auto;display:grid;place-items:center;font-size:17px}'
    + '.nh-dock__text{white-space:nowrap;overflow:hidden;max-width:220px;transition:max-width .25s ease,opacity .25s ease,margin .25s ease}'
    + '.nh-dock--mini .nh-dock__text{max-width:0;opacity:0;margin:0}'
    + '.nh-dock--mini{padding:8px}'
    + '.nh-dock__dot{position:absolute;top:6px;right:6px;width:9px;height:9px;border-radius:50%;background:#34c759;box-shadow:0 0 0 2px #17231e}'
    + 'body.nh-ai-open .nh-dock,body.nova-ai-open .nh-dock,body.nh-exit-popup-open .nh-dock{opacity:0;pointer-events:none}'
    + '@media (max-width:480px){.nh-dock{right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px))}}';

  function mount() {
    if (doc.querySelector('.nh-dock')) return;
    var style = doc.createElement('style'); style.textContent = css; doc.head.appendChild(style);
    var button = doc.createElement('button');
    button.type = 'button';
    button.className = 'nh-dock';
    button.setAttribute('aria-label', 'שאלה על הגוון? דברי עם היועצת');
    button.innerHTML = '<span class="nh-dock__face" aria-hidden="true">💬</span><span class="nh-dock__text">שאלה על הגוון? דברי איתי</span><span class="nh-dock__dot" aria-hidden="true"></span>';
    doc.body.appendChild(button);
    var shownAt = Date.now();
    capture('concierge_dock_shown', { experiment: EXPERIMENT, variant: 'dock' });
    global.setTimeout(function () { button.classList.add('nh-dock--mini'); }, 7000);
    button.addEventListener('mouseenter', function () { button.classList.remove('nh-dock--mini'); });
    button.addEventListener('click', function () {
      var ai = global.NovaHairAIPopup;
      capture('concierge_dock_opened', { experiment: EXPERIMENT, variant: 'dock', seconds_since_shown: Math.round((Date.now() - shownAt) / 1000) });
      if (!ai || typeof ai.open !== 'function') return;
      try {
        ai.open({
          trigger: 'dock', reason: 'dock_tap', utmCampaign: global.location.search,
          pageVariant: doc.documentElement.getAttribute('data-nova-cro') || '',
          experimentId: EXPERIMENT, experimentVariant: 'dock', experimentBucket: 'dock', holdoutPercent: 0,
          intentScore: 0, engagementScore: 0, abandonScore: 0,
          snapshot: { maxDepth: 0, depth: 0, velocity: 0, engagedSeconds: Math.round((Date.now() - shownAt) / 1000), timeOnPage: Math.round((Date.now() - shownAt) / 1000), visit: 1 }
        });
      } catch (_) {}
    });
  }

  function decide(tries) {
    if (tries > 0 && !global.NovaHairAIPopup && tries < 20) { global.setTimeout(function () { decide(tries + 1); }, 500); return; }
    global.fetch(ENDPOINT + '?visitor=' + encodeURIComponent(visitorKey()) + '&experiment=' + EXPERIMENT, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) {
        var variant = body && body.variant ? String(body.variant) : 'control';
        remember(variant);
        if (variant === 'dock') {
          if (global.NovaHairAIPopup) mount();
          else (function wait(n) { if (global.NovaHairAIPopup) mount(); else if (n < 40) global.setTimeout(function () { wait(n + 1); }, 500); })(0);
        }
      })
      .catch(function () {});
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { decide(0); }); else decide(0);
})(window);
