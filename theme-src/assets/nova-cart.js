/*
  Add to cart without leaving the product page, and put a relevant suggestion
  inside the drawer.

  The bug this fixes: the Nova product form was a plain HTML form posting to
  /cart/add. The theme's cart drawer is only opened by the theme's own
  <product-form> element, which our form is not wrapped in, so every add to cart
  did a full page navigation to /cart. The customer left the product page and
  the drawer never appeared.

  Rather than adopt <product-form> (it expects a spinner element and a <span>
  inside the button that our markup does not have), this does the same job
  directly: post to /cart/add.js, hand the response to the drawer, and let the
  drawer render and open itself.

  Everything degrades. If the drawer is missing, or fetch fails, the form
  submits natively exactly as before, so the customer can always still buy.
*/
(function () {
  'use strict';

  var UPSELL_ID = 'nova-cart-upsell';

  // The drawer rebuilds itself on every add, taking the suggestion block with
  // it. Remember which product the customer is shopping so the block can be put
  // back after an add made from inside the drawer itself.
  var lastProductId = null;

  function drawer() {
    return document.querySelector('cart-drawer');
  }

  function cartAddUrl() {
    var base = (window.routes && window.routes.cart_add_url) || '/cart/add';
    return base.indexOf('.js') === -1 ? base + '.js' : base;
  }

  function busy(button, on) {
    if (!button) return;
    button.setAttribute('aria-busy', on ? 'true' : 'false');
    button.classList.toggle('is-loading', !!on);
    if (on) {
      button.dataset.novaLabel = button.dataset.novaLabel || button.textContent.trim();
      button.disabled = true;
    } else {
      button.disabled = false;
      if (button.dataset.novaLabel) button.textContent = button.dataset.novaLabel;
    }
  }

  function showError(form, message) {
    var el = form.querySelector('[data-nova-cart-error]');
    if (!el) {
      el = document.createElement('p');
      el.setAttribute('data-nova-cart-error', '');
      el.className = 'nova-cart-error';
      form.appendChild(el);
    }
    el.textContent = message;
    el.hidden = !message;
  }

  /* The drawer re-renders from server-rendered sections, so ask for the same
     ones the theme's own code asks for. */
  function sectionsFor(cart) {
    if (!cart || typeof cart.getSectionsToRender !== 'function') return null;
    try {
      return cart.getSectionsToRender().map(function (s) { return s.id; });
    } catch (e) {
      return null;
    }
  }

  function injectUpsell(productId) {
    var cart = drawer();
    if (!cart) return;

    // Prefer the curated block already on the product page. Those companions
    // were chosen as merchandising (a colour buys the shampoo that protects
    // it); Shopify's own related-products engine has no order history on this
    // store yet and pairs a root spray with a sunscreen.
    var onPage = document.querySelector('.nova-pairs');
    if (onPage) {
      var clone = onPage.cloneNode(true);
      clone.setAttribute('data-nova-upsell', '');
      clone.classList.add('nova-pairs--in-drawer');
      // drop anything already in the cart so we never suggest a duplicate
      inCart().then(function (ids) {
        clone.querySelectorAll('[data-nova-upsell-add]').forEach(function (b) {
          if (ids.indexOf(String(b.getAttribute('data-nova-upsell-add'))) !== -1) {
            var li = b.closest('li');
            if (li) li.remove();
          }
          b.removeAttribute('data-nova-add-bound');
        });
        if (!clone.querySelector('[data-nova-upsell-add]')) return;
        place(cart, clone);
      });
      return;
    }

    if (!productId) return;
    var url = '/recommendations/products?section_id=' + UPSELL_ID +
              '&product_id=' + encodeURIComponent(productId) +
              '&limit=3&intent=related';

    fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (html) {
        if (!html) return;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var block = doc.querySelector('[data-nova-upsell]');
        if (!block || !block.querySelector('[data-nova-upsell-item]')) return;
        place(cart, block);
      })
      .catch(function () { /* a missing suggestion is not worth an error */ });
  }

  function inCart() {
    return fetch('/cart.js', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { return r.json(); })
      .then(function (c) { return (c.items || []).map(function (i) { return String(i.variant_id); }); })
      .catch(function () { return []; });
  }

  function place(cart, block) {
    // above the checkout button, where the customer is already looking
    var host = cart.querySelector('.drawer__footer') ||
               cart.querySelector('.drawer__inner') || cart;
    var existing = cart.querySelector('[data-nova-upsell]');
    if (existing) existing.remove();
    host.insertBefore(block, host.firstChild);
    wireUpsell(block);
  }

  function wireUpsell(block) {
    block.querySelectorAll('[data-nova-upsell-add]').forEach(function (btn) {
      if (btn.dataset.novaAddBound) return;
      btn.dataset.novaAddBound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var id = btn.getAttribute('data-nova-upsell-add');
        if (!id) return;
        busy(btn, true);
        addToCart({ id: id, quantity: 1 }, null, btn, lastProductId);
      });
    });
  }

  function addToCart(payload, form, button, productId) {
    if (productId) lastProductId = productId;
    var cart = drawer();
    var body = Object.assign({}, payload);
    var ids = sectionsFor(cart);
    if (ids) {
      body.sections = ids;
      body.sections_url = window.location.pathname;
    }

    return fetch(cartAddUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j }; }); })
      .then(function (res) {
        if (!res.ok || res.json.status) {
          var msg = res.json.description || res.json.message || 'לא הצלחנו להוסיף לסל. נסי שוב.';
          if (form) showError(form, msg);
          return;
        }
        if (form) showError(form, '');

        if (cart && typeof cart.renderContents === 'function') {
          cart.renderContents(res.json);        // this also opens the drawer
          // The drawer carries an is-empty class while the cart has nothing in
          // it, and the theme's CSS hides the contents behind it. Shopify
          // renders the new contents but does not clear the class, so without
          // this the drawer opens and shows a blank panel.
          cart.classList.remove('is-empty');
        } else if (cart && typeof cart.open === 'function') {
          cart.open();
        } else {
          window.location = (window.routes && window.routes.cart_url) || '/cart';
          return;
        }

        // the drawer swaps its own innerHTML, so add the suggestion after
        setTimeout(function () { injectUpsell(productId || lastProductId); }, 260);
      })
      .catch(function () {
        if (form) form.submit();               // last resort: the old behaviour
      })
      .finally(function () { busy(button, false); });
  }

  function bind(form) {
    if (form.dataset.novaCartBound) return;
    form.dataset.novaCartBound = '1';

    form.addEventListener('submit', function (e) {
      // no drawer on this theme setting means the normal POST is still correct
      if (!drawer()) return;

      e.preventDefault();
      var button = form.querySelector('[data-nova-cta]') ||
                   form.querySelector('button[type="submit"]');
      var idInput = form.querySelector('[name="id"]');
      var qtyInput = form.querySelector('[name="quantity"]');
      if (!idInput || !idInput.value) return;

      busy(button, true);
      addToCart(
        { id: idInput.value, quantity: Number(qtyInput && qtyInput.value) || 1 },
        form,
        button,
        form.getAttribute('data-nova-product-id')
      );
    });
  }

  function init() {
    document.querySelectorAll('[data-nova-form]').forEach(bind);
    // the "pairs well with" block sits on the page itself, under the button,
    // and uses the same add control as the one inside the drawer
    wireUpsell(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('shopify:section:load', init);
})();
