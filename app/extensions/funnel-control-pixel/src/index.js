import {register} from '@shopify/web-pixels-extension';
import {
  cartContextFromEvent,
  reduceCheckoutEvent,
  resolvePixelEndpoint,
} from './runtime.js';

register(({analytics, browser, settings}) => {
  const endpoint = resolvePixelEndpoint(settings.endpoint);

  async function cookieContext() {
    let raw = '';
    try { raw = await browser.cookie.get('_funnel_context'); } catch (_) {}
    if (!raw) return {};
    try { return JSON.parse(decodeURIComponent(raw)); } catch (_) { return {}; }
  }

  async function forward(event) {
    const cartContext = cartContextFromEvent(event);
    const storedContext = await cookieContext();
    const eventContext = {...cartContext, ...storedContext};
    const body = JSON.stringify({
      event: reduceCheckoutEvent(event),
      context: eventContext,
    });
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
        keepalive: true,
      });
    } catch (_) {
      // The pixel must never block checkout. Webhook reconciliation remains authoritative.
    }
  }

  analytics.subscribe('checkout_started', forward);
  analytics.subscribe('checkout_completed', forward);
});
