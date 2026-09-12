import {register} from '@shopify/web-pixels-extension';

register(({analytics, browser, settings, init}) => {
  const endpoint = String(settings.endpoint || '').trim();
  if (!endpoint) return;

  async function context() {
    let raw = '';
    try { raw = await browser.cookie.get('_funnel_context'); } catch (_) {}
    if (!raw) return {};
    try { return JSON.parse(decodeURIComponent(raw)); } catch (_) { return {}; }
  }

  function value(value, max = 300) {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const result = String(value).trim();
    return result ? result.slice(0, max) : undefined;
  }

  function minimalData(event) {
    const source = event && event.data ? event.data : {};
    const checkout = source.checkout || {};
    const order = source.order || {};
    const cart = source.cart || {};
    const cartLine = source.cartLine || {};
    const variant = source.productVariant || cartLine.merchandise || {};
    const product = variant.product || {};
    const image = variant.image || product.featuredImage || {};
    return {
      checkoutToken: value(checkout.token || source.checkout_token, 300),
      orderId: value(order.id, 300),
      cartId: value(cart.id || cartLine.cartId, 300),
      productHandle: value(product.handle, 180),
      productName: value(product.title, 240),
      productImage: value(image.src || image.url, 1200),
      variantId: value(variant.id, 180),
      variantName: value(variant.title, 180),
      quantity: Number.isFinite(Number(cartLine.quantity)) ? Number(cartLine.quantity) : undefined,
    };
  }

  async function forward(event) {
    const eventContext = await context();
    const customer = init && init.data ? init.data.customer : null;
    const body = JSON.stringify({
      event: {
        id: event.id,
        name: event.name,
        timestamp: event.timestamp,
        clientId: event.clientId,
        data: minimalData(event),
      },
      context: {
        ...eventContext,
        shopifyClientId: value(event.clientId, 300),
        shopifyCustomerId: value(customer && customer.id, 180),
      },
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

  analytics.subscribe('product_viewed', forward);
  analytics.subscribe('product_added_to_cart', forward);
  analytics.subscribe('product_removed_from_cart', forward);
  analytics.subscribe('cart_viewed', forward);
  analytics.subscribe('checkout_started', forward);
  analytics.subscribe('checkout_completed', forward);
});
