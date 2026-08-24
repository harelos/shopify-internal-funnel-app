(() => {
  "use strict";

  const ROOT_ID = "tiger-popup-preview-root";
  let active = null;

  function safeText(value, fallback = "") {
    return typeof value === "string" ? value.slice(0, 1200) : fallback;
  }

  function emitAsync(callback, name, metadata = {}) {
    if (typeof callback !== "function") return;
    Promise.resolve().then(() => callback(name, metadata)).catch(() => {});
  }

  function removeNode(node) {
    try {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    } catch {
      // Cleanup must never trap the shopper in the overlay.
    }
  }

  function close(reason = "programmatic") {
    if (!active) return;
    const state = active;
    active = null;

    try {
      window.clearTimeout(state.timeoutId);
      document.removeEventListener("keydown", state.onKeydown, true);
      state.backdrop.removeEventListener("pointerdown", state.onBackdropPointerDown);
      state.closeButton.removeEventListener("click", state.onCloseClick);
      state.secondaryButton?.removeEventListener("click", state.onSecondaryClick);
      state.ctaButton?.removeEventListener("click", state.onCtaClick);
      state.form?.removeEventListener("submit", state.onSubmit);
    } catch {
      // Continue cleanup even if an individual listener was already removed.
    }

    try {
      removeNode(state.root);
    } finally {
      // Body recovery is local and immediate. It never waits on telemetry/API.
      document.documentElement.classList.remove("tiger-popup-preview-open");
      document.body.classList.remove("tiger-popup-preview-open");
      document.body.style.overflow = state.previousBodyOverflow;
      document.body.style.paddingRight = state.previousBodyPaddingRight;
      try {
        if (state.previousFocus && typeof state.previousFocus.focus === "function" && document.contains(state.previousFocus)) {
          state.previousFocus.focus({ preventScroll: true });
        }
      } catch {
        // Focus restoration is best-effort; page usability remains primary.
      }
    }

    emitAsync(state.onEvent, "popup_close", { reason });
  }

  function makeButton(label, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = safeText(label);
    return button;
  }

  function buildForm(creative) {
    const mode = creative.formMode || "none";
    if (mode === "none") return null;

    const form = document.createElement("form");
    form.className = "tiger-popup-preview-form";
    form.noValidate = true;

    if (mode === "email_name") {
      const name = document.createElement("input");
      name.type = "text";
      name.name = "name";
      name.autocomplete = "name";
      name.placeholder = creative.direction === "rtl" ? "שם" : "Name";
      name.maxLength = 100;
      form.appendChild(name);
    }

    if (mode === "email" || mode === "email_name") {
      const email = document.createElement("input");
      email.type = "email";
      email.name = "email";
      email.autocomplete = "email";
      email.placeholder = creative.direction === "rtl" ? "אימייל" : "Email";
      email.maxLength = 254;
      email.required = true;
      form.appendChild(email);
    }

    if (mode === "quiz") {
      const helper = document.createElement("div");
      helper.className = "tiger-popup-preview-form-note";
      helper.textContent = creative.direction === "rtl" ? "תצוגת שאלון — השאלות יוגדרו בשלב הבא." : "Quiz preview — questions are configured in the next phase.";
      form.appendChild(helper);
    }

    return form;
  }

  function open(options = {}) {
    if (window.__TIGER_POPUPS_DISABLED__ === true) return { opened: false, reason: "kill_switch" };

    // Never stack overlays. Closing the previous one is synchronous and local.
    close("replaced");

    const campaign = options.campaign || {};
    const variant = options.variant || {};
    const creative = variant.creative || {};
    const safety = campaign.safety || {};
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPaddingRight = document.body.style.paddingRight;

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "tiger-popup-preview-root";
    root.dataset.campaignKey = safeText(campaign.key, "preview");
    root.dataset.variantKey = safeText(variant.key, "control");

    const backdrop = document.createElement("div");
    backdrop.className = "tiger-popup-preview-backdrop";

    const dialog = document.createElement("section");
    dialog.className = "tiger-popup-preview-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "tiger-popup-preview-title");
    dialog.tabIndex = -1;
    dialog.dir = creative.direction === "ltr" ? "ltr" : creative.direction === "auto" ? "auto" : "rtl";

    const closeButton = makeButton("×", "tiger-popup-preview-close");
    closeButton.setAttribute("aria-label", creative.direction === "rtl" ? "סגירה" : "Close");

    const content = document.createElement("div");
    content.className = "tiger-popup-preview-content";

    const eyebrow = document.createElement("div");
    eyebrow.className = "tiger-popup-preview-eyebrow";
    eyebrow.textContent = safeText(creative.eyebrow, "TIGER BRANDS");

    const title = document.createElement("h2");
    title.id = "tiger-popup-preview-title";
    title.textContent = safeText(creative.title, "Preview popup");

    const body = document.createElement("p");
    body.textContent = safeText(creative.body);

    if (creative.imageUrl && /^https:\/\//i.test(creative.imageUrl)) {
      const media = document.createElement("div");
      media.className = "tiger-popup-preview-media";
      const image = document.createElement("img");
      image.src = creative.imageUrl;
      image.alt = "";
      image.loading = "eager";
      image.decoding = "async";
      image.addEventListener("error", () => media.remove(), { once: true });
      media.appendChild(image);
      dialog.appendChild(media);
    }

    content.append(eyebrow, title, body);

    const form = buildForm(creative);
    if (form) content.appendChild(form);

    const actions = document.createElement("div");
    actions.className = "tiger-popup-preview-actions";
    const ctaButton = makeButton(creative.ctaLabel || "Continue", "tiger-popup-preview-cta");
    const secondaryButton = makeButton(creative.secondaryLabel || "Not now", "tiger-popup-preview-secondary");
    actions.append(ctaButton, secondaryButton);
    content.appendChild(actions);

    const safetyNote = document.createElement("div");
    safetyNote.className = "tiger-popup-preview-safety-note";
    safetyNote.textContent = "STAGING PREVIEW · local close is independent of network requests";
    content.appendChild(safetyNote);

    dialog.append(closeButton, content);
    backdrop.appendChild(dialog);
    root.appendChild(backdrop);

    const onKeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        close("escape");
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = [...dialog.querySelectorAll("button,input,select,textarea,a[href],[tabindex]:not([tabindex='-1'])")]
        .filter(element => element instanceof HTMLElement && !element.hasAttribute("disabled"));
      if (!focusables.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onBackdropPointerDown = event => {
      if (event.target === backdrop && safety.backdropClose !== false) close("backdrop");
    };
    const onCloseClick = () => close("x");
    const onSecondaryClick = () => close("secondary");
    const onCtaClick = () => {
      emitAsync(options.onEvent, "popup_cta_click", {});
      if (!form) close("cta");
      else form.requestSubmit();
    };
    const onSubmit = event => {
      event.preventDefault();
      if (!form?.checkValidity()) {
        form?.reportValidity();
        return;
      }
      // Preview deliberately does not persist entered PII.
      emitAsync(options.onEvent, "popup_submit", { formMode: creative.formMode || "none", previewOnly: true });
      close("submit");
    };

    closeButton.addEventListener("click", onCloseClick);
    secondaryButton.addEventListener("click", onSecondaryClick);
    ctaButton.addEventListener("click", onCtaClick);
    form?.addEventListener("submit", onSubmit);
    backdrop.addEventListener("pointerdown", onBackdropPointerDown);
    document.addEventListener("keydown", onKeydown, true);

    const maxOpenMs = Math.max(5000, Math.min(900000, Number(safety.maxOpenMs) || 300000));
    const timeoutId = window.setTimeout(() => close("timeout"), maxOpenMs);

    active = {
      root,
      backdrop,
      dialog,
      closeButton,
      secondaryButton,
      ctaButton,
      form,
      previousFocus,
      previousBodyOverflow,
      previousBodyPaddingRight,
      timeoutId,
      onKeydown,
      onBackdropPointerDown,
      onCloseClick,
      onSecondaryClick,
      onCtaClick,
      onSubmit,
      onEvent: options.onEvent,
    };

    // Append only after all local close mechanics exist.
    document.body.appendChild(root);
    document.documentElement.classList.add("tiger-popup-preview-open");
    document.body.classList.add("tiger-popup-preview-open");
    document.body.style.overflow = "hidden";

    window.requestAnimationFrame(() => {
      root.classList.add("is-open");
      try { closeButton.focus({ preventScroll: true }); } catch { dialog.focus(); }
    });

    emitAsync(options.onEvent, "popup_impression", { previewOnly: true });
    return { opened: true, reason: "opened", close };
  }

  function isOpen() {
    return Boolean(active && document.getElementById(ROOT_ID));
  }

  function safetySelfTest() {
    const beforeOverflow = document.body.style.overflow;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "focus-probe";
    trigger.style.position = "fixed";
    trigger.style.left = "-9999px";
    document.body.appendChild(trigger);
    trigger.focus();

    const result = open({
      campaign: { key: "self-test", safety: { backdropClose: true, maxOpenMs: 5000 } },
      variant: { key: "control", creative: { title: "Safety test", body: "Local close test", ctaLabel: "OK", secondaryLabel: "Close", direction: "ltr", formMode: "none" } },
    });
    const opened = result.opened && isOpen() && document.body.style.overflow === "hidden";
    close("self_test");
    const closed = !isOpen() && document.body.style.overflow === beforeOverflow;
    const focusRestored = document.activeElement === trigger;
    trigger.remove();
    return { opened, closed, focusRestored, pass: Boolean(opened && closed && focusRestored) };
  }

  window.TigerPopupPreview = Object.freeze({ open, close, isOpen, safetySelfTest });
})();
