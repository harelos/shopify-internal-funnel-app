/* nova-pdp.js
   Behaviour for the reusable Nova product page.

   All money strings are rendered by Liquid and shipped in the embedded JSON,
   so this file never formats currency and never needs the shop's money format.
*/
(function () {
  'use strict';

  function NovaPdp(root) {
    this.root = root;
    this.form = root.querySelector('[data-nova-form]');
    this.data = this.readData();
    if (!this.data) return;

    this.idInput = root.querySelector('[data-nova-variant-id]');
    this.optionInputs = Array.prototype.slice.call(root.querySelectorAll('[data-nova-option]'));
    this.cta = root.querySelector('[data-nova-cta]');
    this.stickyCta = root.querySelector('[data-nova-sticky-cta]');

    this.bindOptions();
    this.bindGallery();
    this.bindSticky();
    this.bindQuantity();
    this.update();
    this.ready = true;
  }

  NovaPdp.prototype.readData = function () {
    var el = this.root.querySelector('[data-nova-variants]');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  };

  /* ---- variant selection ------------------------------------------------ */

  NovaPdp.prototype.selectedValues = function () {
    var byIndex = {};
    this.optionInputs.forEach(function (input) {
      if (input.checked) byIndex[input.dataset.novaOption] = input.value;
    });
    return byIndex;
  };

  NovaPdp.prototype.matchVariant = function () {
    var sel = this.selectedValues();
    var keys = Object.keys(sel);
    return (
      this.data.variants.filter(function (v) {
        return keys.every(function (k) {
          return v.options[Number(k)] === sel[k];
        });
      })[0] || null
    );
  };

  NovaPdp.prototype.bindOptions = function () {
    var self = this;
    this.optionInputs.forEach(function (input) {
      input.addEventListener('change', function () {
        self.update();
      });
    });
  };

  /* Disable values that cannot combine with the rest of the selection. */
  NovaPdp.prototype.refreshAvailability = function () {
    var self = this;
    var sel = this.selectedValues();

    this.optionInputs.forEach(function (input) {
      var idx = Number(input.dataset.novaOption);
      var probe = Object.assign({}, sel);
      probe[idx] = input.value;

      var reachable = self.data.variants.some(function (v) {
        return Object.keys(probe).every(function (k) {
          return v.options[Number(k)] === probe[k];
        });
      });
      var sellable = self.data.variants.some(function (v) {
        var match = Object.keys(probe).every(function (k) {
          return v.options[Number(k)] === probe[k];
        });
        return match && v.available;
      });

      input.disabled = !reachable;
      input.closest('.nova-swatch, .nova-pill, .nova-pack').classList.toggle('is-unavailable', reachable && !sellable);
    });
  };

  NovaPdp.prototype.update = function () {
    var v = this.matchVariant();
    this.refreshAvailability();

    var setText = function (sel, value, rootEl) {
      Array.prototype.forEach.call(rootEl.querySelectorAll(sel), function (n) {
        n.textContent = value == null ? '' : value;
        n.hidden = value == null || value === '';
      });
    };

    if (!v) {
      if (this.cta) {
        this.cta.disabled = true;
        this.cta.textContent = this.data.strings.unavailable;
      }
      return;
    }

    if (this.idInput) this.idInput.value = v.id;

    setText('[data-nova-price-now]', v.price, this.root);
    setText('[data-nova-price-was]', v.compare_at, this.root);
    setText('[data-nova-price-save]', v.save_badge, this.root);
    setText('[data-nova-sticky-now]', v.price, this.root);
    setText('[data-nova-sticky-was]', v.compare_at, this.root);

    // Each option group shows its own selected value, not the full variant title.
    var sel = this.selectedValues();
    Array.prototype.forEach.call(this.root.querySelectorAll('[data-nova-selected-label]'), function (n) {
      var idx = n.getAttribute('data-nova-selected-label');
      if (sel[idx] != null) n.textContent = sel[idx];
    });

    [this.cta, this.stickyCta].forEach(
      function (btn) {
        if (!btn) return;
        btn.disabled = !v.available;
        btn.textContent = v.available ? this.data.strings.add : this.data.strings.soldout;
      }.bind(this)
    );

    // Real remaining stock for this variant, or nothing at all. Liquid decided
    // whether the number qualifies; this only shows what it was given.
    var low = this.root.querySelector('[data-nova-low]');
    if (low) {
      low.textContent = v.low_stock || '';
      low.hidden = !v.low_stock;
    }

    // Follow the variant's own image, but not on first paint. The default
    // shade usually has a swatch assigned, and jumping to it on load means the
    // shopper never sees the opening shot. Only move once she picks a shade.
    if (this.ready && v.media_index != null) this.goToSlide(v.media_index);

    if (v.url && window.history && window.history.replaceState) {
      window.history.replaceState({}, '', v.url);
    }
  };

  /* ---- gallery ---------------------------------------------------------- */

  NovaPdp.prototype.bindGallery = function () {
    var self = this;
    this.track = this.root.querySelector('[data-nova-track]');
    this.thumbs = Array.prototype.slice.call(this.root.querySelectorAll('[data-nova-thumb]'));
    if (!this.track) return;

    this.thumbs.forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        self.goToSlide(i);
      });
    });

    var ticking = false;
    this.track.addEventListener(
      'scroll',
      function () {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(function () {
          // Stride is the slide plus the gap, not the track width, or the
          // index drifts by one after a few slides. RTL tracks report a
          // negative scrollLeft, hence the abs.
          var stride = self.track.children[1]
            ? Math.abs(self.track.children[1].offsetLeft - self.track.children[0].offsetLeft)
            : self.track.clientWidth;
          var i = Math.round(Math.abs(self.track.scrollLeft) / (stride || 1));
          self.markThumb(i);
          ticking = false;
        });
      },
      { passive: true }
    );
  };

  NovaPdp.prototype.goToSlide = function (i) {
    if (!this.track) return;
    var slide = this.track.children[i];
    if (!slide) return;
    // RTL tracks scroll negatively in some engines; offsetLeft stays reliable.
    this.track.scrollTo({ left: slide.offsetLeft - this.track.offsetLeft, behavior: 'auto' });
    this.markThumb(i);
  };

  NovaPdp.prototype.markThumb = function (i) {
    this.thumbs.forEach(function (t, j) {
      t.setAttribute('aria-current', j === i ? 'true' : 'false');
    });
  };

  /* ---- sticky bar ------------------------------------------------------- */

  NovaPdp.prototype.bindSticky = function () {
    var bar = this.root.querySelector('[data-nova-sticky]');
    var anchor = this.root.querySelector('[data-nova-cta]');
    if (!bar || !anchor || !('IntersectionObserver' in window)) return;

    // Show the bar whenever the real Add to cart is off screen, including
    // before the shopper has reached it. On a phone the buy box starts below
    // the fold, so waiting until they scroll past it leaves the first screen
    // with no visible way to buy.
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          bar.classList.toggle('is-visible', !e.isIntersecting);
        });
      },
      { threshold: 0 }
    );
    io.observe(anchor);
  };

  /* ---- quantity --------------------------------------------------------- */

  NovaPdp.prototype.bindQuantity = function () {
    var input = this.root.querySelector('[data-nova-qty]');
    if (!input) return;
    Array.prototype.forEach.call(this.root.querySelectorAll('[data-nova-qty-step]'), function (btn) {
      btn.addEventListener('click', function () {
        var next = parseInt(input.value, 10) + parseInt(btn.dataset.novaQtyStep, 10);
        input.value = String(Math.max(1, next));
      });
    });
  };

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-nova-pdp]'), function (el) {
      if (!el.dataset.novaReady) {
        el.dataset.novaReady = '1';
        new NovaPdp(el);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Theme editor re-renders sections without a full page load.
  document.addEventListener('shopify:section:load', init);
})();
