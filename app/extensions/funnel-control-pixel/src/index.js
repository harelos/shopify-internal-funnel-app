import {register} from '@shopify/web-pixels-extension';

register(({analytics, browser, settings}) => {
  const endpoint = String(settings.endpoint || '').trim();
  if (!endpoint) return;

  async function context() {
    let raw = '';
    try { raw = await browser.cookie.get('_funnel_context'); } catch (_) {}
    if (!raw) return {};
    try { return JSON.parse(decodeURIComponent(raw)); } catch (_) { return {}; }
  }

  async function forward(event) {
    const eventContext = await context();
    const body = JSON.stringify({
      event: { id: event.id, name: event.name, timestamp: event.timestamp, data: event.data },
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
