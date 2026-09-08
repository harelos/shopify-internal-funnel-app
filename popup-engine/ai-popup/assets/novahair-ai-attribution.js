/**
 * NovaHair concierge - attribution & measurement.
 *
 * Three jobs, all so the conversation can be measured end to end:
 *   1. Capture the FULL marketing context once per session (all UTMs, the ad
 *      click ids, referrer, landing path) and keep it stable.
 *   2. Write it onto the Shopify cart as `_nh_*` attributes, using the same
 *      underscore convention the store already uses (_NOVA_EXIT_POPUP). Shopify
 *      copies cart attributes onto the order's note_attributes, so an order can
 *      later be tied back to the exact conversation, lane, and campaign with no
 *      extra integration. This is the "fit to Shopify parameters" hook.
 *   3. Mirror key events to GA4 / GTM via dataLayer + gtag, so the same funnel
 *      is visible in Analytics. No-op when GA is not on the page.
 *
 * Nothing here blocks the conversation; every network call is best-effort.
 */
window.NovaHairAttribution = (function () {
  'use strict';

  var SKEY = 'novahair_attribution_v1';

  /* Marketing params worth carrying. Click ids matter: Shopify, Meta and Google
   * all reconcile conversions through them, not just UTMs. */
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var CLICK_KEYS = ['gclid', 'fbclid', 'ttclid', 'msclkid', 'wbraid', 'gbraid'];
  var localCartTail = Promise.resolve();

  function readParams() {
    var p;
    try { p = new URLSearchParams(window.location.search); } catch (_) { return {}; }
    var out = {};
    UTM_KEYS.concat(CLICK_KEYS).forEach(function (k) {
      var v = p.get(k);
      if (v) out[k] = String(v).slice(0, 200);
    });
    return out;
  }

  /* First-touch within the tab session. If she arrived on the ad-tagged landing
   * page and then navigated deeper, later pages keep the original attribution
   * rather than overwriting it with empty values. */
  function capture() {
    var stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch (_) {}
    if (stored) return stored;

    var params = readParams();
    var referrerHost = '';
    try { referrerHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch (_) {}

    /* Infer source when the ad forgot the UTM but the referrer betrays it. */
    if (!params.utm_source) {
      if (params.fbclid || /facebook|instagram/i.test(referrerHost)) params.utm_source = 'facebook';
      else if (params.gclid || /google/i.test(referrerHost)) params.utm_source = 'google';
      else if (referrerHost) params.utm_source = 'referral';
      else params.utm_source = 'direct';
    }

    var attr = {
      utm_source: params.utm_source || '',
      utm_medium: params.utm_medium || '',
      utm_campaign: params.utm_campaign || '',
      utm_content: params.utm_content || '',
      utm_term: params.utm_term || '',
      gclid: params.gclid || '',
      fbclid: params.fbclid || '',
      ttclid: params.ttclid || '',
      landingPath: (window.location.pathname || '').slice(0, 200),
      referrerHost: referrerHost.slice(0, 120)
    };
    try { sessionStorage.setItem(SKEY, JSON.stringify(attr)); } catch (_) {}
    return attr;
  }

  function get() { return capture(); }

  /* Fields safe to attach to every analytics event. Kept small and flat so the
   * server payload whitelist stays tidy. */
  function eventFields() {
    var a = capture();
    return {
      utm_source: a.utm_source,
      utm_medium: a.utm_medium,
      utm_campaign: a.utm_campaign,
      utm_content: a.utm_content,
      utm_term: a.utm_term,
      gclid: a.gclid,
      fbclid: a.fbclid,
      landingPath: a.landingPath,
      referrerHost: a.referrerHost
    };
  }

  /* Write the conversation's attribution onto the Shopify cart. Shopify carries
   * cart attributes to Order.note_attributes, so the order is traceable to the
   * conversation. Called at conversion moments only (lead, coupon, to-product),
   * not on every open, to avoid needless cart writes. */
  function writeCartAttributes(extra) {
    var a = capture();
    var device = (extra && extra.device) || (window.matchMedia && window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop');
    var attributes = {
      '_nh_popup': '1',
      '_nh_conversation_id': (extra && extra.conversationId) || '',
      '_nh_visitor_id': (extra && extra.visitorId) || '',
      '_nh_session_id': (extra && extra.sessionId) || '',
      '_nh_version': (extra && extra.version) || '',
      '_nh_agent': (extra && extra.agent) || '',
      '_nh_trigger': (extra && extra.trigger) || '',
      '_nh_page': (window.location.pathname || '').slice(0, 200),
      '_nh_device': device,
      '_nh_utm_source': a.utm_source,
      '_nh_utm_medium': a.utm_medium,
      '_nh_utm_campaign': a.utm_campaign,
      '_nh_utm_content': a.utm_content,
      '_nh_utm_term': a.utm_term,
      '_nh_gclid': a.gclid,
      '_nh_fbclid': a.fbclid
    };
    if (extra && extra.coupon) attributes['_nh_coupon'] = extra.coupon;
    if (extra && extra.lead) attributes['_nh_lead'] = '1';

    var job = function () {
      return window.fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({ attributes: attributes })
      });
    };

    try {
      var key = ['ai-attribution', attributes._nh_conversation_id, attributes._nh_trigger,
        attributes._nh_coupon || '', attributes._nh_lead || ''].join(':');
      if (typeof window.novaFunnelEnqueueCartMutation === 'function') {
        return window.novaFunnelEnqueueCartMutation(key, job).catch(function () {});
      }
      localCartTail = localCartTail.catch(function () {}).then(job);
      return localCartTail.catch(function () {});
    } catch (_) {
      return Promise.resolve();
    }
  }

  /* Mirror an event to GA4 / GTM. dataLayer for GTM, gtag for direct GA4.
   * Silent when neither is present. Event names are prefixed nh_. */
  function ga(name, params) {
    var a = capture();
    var payload = Object.assign({
      event: 'nh_' + name,
      utm_source: a.utm_source,
      utm_medium: a.utm_medium,
      utm_campaign: a.utm_campaign,
      utm_content: a.utm_content
    }, params || {});
    try {
      if (Array.isArray(window.dataLayer)) window.dataLayer.push(payload);
      if (typeof window.gtag === 'function') window.gtag('event', 'nh_' + name, payload);
    } catch (_) { /* analytics is best-effort */ }
  }

  return {
    get: get,
    eventFields: eventFields,
    writeCartAttributes: writeCartAttributes,
    ga: ga
  };
})();

