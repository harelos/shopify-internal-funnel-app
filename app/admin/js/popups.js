(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const panels = [...document.querySelectorAll("[data-panel]")];
  const api = window.API;

  const FALLBACK = {
    key: "popup-draft-1",
    name: "Popup draft 1",
    type: "lead_capture",
    status: "DRAFT",
    experimentVersion: 1,
    trigger: { mode: "time", seconds: 20, scrollPct: 50, inactivitySeconds: 30, requireCartItems: false, desktopExitOnly: true },
    targeting: { includePaths: [], excludePaths: [], productHandles: [], funnelIds: [], trafficSources: [], referrerContains: [], utmSources: [], visitorState: "any", cartMinSubtotal: null, cartMaxSubtotal: null, requireCartItems: false },
    frequency: { suppressAfterCloseMinutes: 1440, suppressAfterSubmitDays: 30, maxImpressionsPerSession: 1, maxImpressionsPerVisitorDay: 1 },
    safety: { visibleCloseButton: true, escClose: true, localImmediateClose: true, backdropClose: true, restoreFocus: true, cleanupBodyScroll: true, maxOpenMs: 300000 },
    variants: [
      { key: "control", name: "Control", weightBasisPoints: 5000, creative: { eyebrow: "TIGER BRANDS", title: "רוצה עזרה לבחור נכון?", body: "הצעה או המלצה רלוונטית תופיע כאן רק כאשר תנאי הקמפיין מתקיימים.", ctaLabel: "המשך", secondaryLabel: "לא עכשיו", imageUrl: "", direction: "rtl", formMode: "none" } },
      { key: "b", name: "B", weightBasisPoints: 5000, creative: { eyebrow: "TIGER BRANDS", title: "יש משהו שיכול להתאים לך", body: "הצעה או המלצה רלוונטית תופיע כאן רק כאשר תנאי הקמפיין מתקיימים.", ctaLabel: "המשך", secondaryLabel: "לא עכשיו", imageUrl: "", direction: "rtl", formMode: "none" } },
    ],
  };

  let config = structuredClone(FALLBACK);
  let activeVariantIndex = 0;
  let runtime = { stagingEnabled: false, eventIngestEnabled: false, storefrontEnabled: false, killSwitch: true, boundary: "STAGING_ONLY" };

  function showError(message) {
    const element = $("pp-error");
    if (!element) return;
    element.textContent = String(message || "Something went wrong");
    element.classList.remove("hidden");
  }

  function clearError() {
    const element = $("pp-error");
    if (!element) return;
    element.textContent = "";
    element.classList.add("hidden");
  }

  function setTab(name) {
    tabs.forEach(tab => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach(panel => panel.classList.toggle("active", panel.dataset.panel === name));
  }

  function splitList(value) {
    return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
  }

  function joinList(value) {
    return Array.isArray(value) ? value.join(", ") : "";
  }

  function nullableNumber(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function numberValue(id, fallback = 0) {
    const parsed = Number($(id)?.value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function setValue(id, value) {
    const element = $(id);
    if (element) element.value = value ?? "";
  }

  function setChecked(id, value) {
    const element = $(id);
    if (element) element.checked = Boolean(value);
  }

  function activeVariant() {
    if (!config.variants.length) config.variants = structuredClone(FALLBACK.variants);
    activeVariantIndex = Math.min(Math.max(0, activeVariantIndex), config.variants.length - 1);
    return config.variants[activeVariantIndex];
  }

  function syncCreativeFromInputs() {
    const variant = activeVariant();
    variant.creative = {
      ...variant.creative,
      eyebrow: $("creative-eyebrow")?.value || "",
      title: $("creative-title")?.value || "",
      body: $("creative-body")?.value || "",
      ctaLabel: $("creative-cta")?.value || "",
      secondaryLabel: $("creative-secondary")?.value || "",
      formMode: $("creative-form")?.value || "none",
      direction: $("creative-direction")?.value || "rtl",
      imageUrl: $("creative-image")?.value || "",
    };
  }

  function renderCreativeEditor() {
    const variant = activeVariant();
    const creative = variant.creative || {};
    setValue("creative-eyebrow", creative.eyebrow);
    setValue("creative-title", creative.title);
    setValue("creative-body", creative.body);
    setValue("creative-cta", creative.ctaLabel);
    setValue("creative-secondary", creative.secondaryLabel);
    setValue("creative-form", creative.formMode || "none");
    setValue("creative-direction", creative.direction || "rtl");
    setValue("creative-image", creative.imageUrl);
    $("pp-active-variant-label").textContent = variant.name || variant.key;
    updateInlinePreview();
  }

  function updateInlinePreview() {
    syncCreativeFromInputs();
    const creative = activeVariant().creative;
    $("pp-preview-eyebrow").textContent = creative.eyebrow || "TIGER BRANDS";
    $("pp-preview-title").textContent = creative.title || "Preview popup";
    $("pp-preview-body").textContent = creative.body || "";
    $("pp-preview-cta").textContent = creative.ctaLabel || "Continue";
    const preview = $("pp-inline-preview");
    preview.dir = creative.direction === "ltr" ? "ltr" : creative.direction === "auto" ? "auto" : "rtl";
  }

  function renderVariants() {
    const list = $("pp-variant-list");
    list.textContent = "";

    config.variants.forEach((variant, index) => {
      const row = document.createElement("div");
      row.className = "pp-variant";
      if (index === activeVariantIndex) row.style.borderColor = "#71717a";

      const head = document.createElement("div");
      head.className = "pp-variant-head";

      const name = document.createElement("input");
      name.className = "pp-input";
      name.value = variant.name || `Variant ${index + 1}`;
      name.maxLength = 80;
      name.setAttribute("aria-label", `Variant ${index + 1} name`);
      name.addEventListener("input", () => {
        variant.name = name.value;
        if (index === activeVariantIndex) $("pp-active-variant-label").textContent = name.value || variant.key;
      });

      const weight = document.createElement("input");
      weight.className = "pp-input pp-variant-weight";
      weight.type = "number";
      weight.min = "0";
      weight.max = "100";
      weight.step = "0.01";
      weight.value = String((variant.weightBasisPoints || 0) / 100);
      weight.setAttribute("aria-label", `Variant ${index + 1} traffic percent`);
      weight.addEventListener("input", () => {
        variant.weightBasisPoints = Math.round(Math.max(0, Math.min(100, Number(weight.value) || 0)) * 100);
        updateWeightTotal();
      });

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "pp-btn";
      edit.textContent = index === activeVariantIndex ? "Editing" : "Edit";
      edit.addEventListener("click", () => {
        syncCreativeFromInputs();
        activeVariantIndex = index;
        renderVariants();
        renderCreativeEditor();
        setTab("builder");
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "pp-btn danger pp-variant-remove";
      remove.textContent = "Remove";
      remove.disabled = config.variants.length <= 1;
      remove.addEventListener("click", () => {
        if (config.variants.length <= 1) return;
        syncCreativeFromInputs();
        config.variants.splice(index, 1);
        activeVariantIndex = Math.min(activeVariantIndex, config.variants.length - 1);
        renderVariants();
        renderCreativeEditor();
      });

      head.append(name, weight, edit, remove);
      const meta = document.createElement("div");
      meta.className = "pp-save-state";
      meta.textContent = `key: ${variant.key} · ${variant.weightBasisPoints} basis points`;
      row.append(head, meta);
      list.appendChild(row);
    });

    updateWeightTotal();
  }

  function updateWeightTotal() {
    const total = config.variants.reduce((sum, variant) => sum + (Number(variant.weightBasisPoints) || 0), 0);
    const display = $("pp-weight-total");
    display.textContent = `${(total / 100).toFixed(total % 100 ? 2 : 0)}%`;
    display.classList.toggle("invalid", total !== 10000);
  }

  function addVariant() {
    if (config.variants.length >= 12) return showError("Maximum 12 variants per popup experiment.");
    syncCreativeFromInputs();
    const used = new Set(config.variants.map(item => item.key));
    let key = "b";
    for (let code = 98; code <= 122; code += 1) {
      const candidate = String.fromCharCode(code);
      if (!used.has(candidate)) { key = candidate; break; }
    }
    const source = structuredClone(activeVariant().creative);
    config.variants.push({ key, name: key.toUpperCase(), weightBasisPoints: 0, creative: source });
    activeVariantIndex = config.variants.length - 1;
    renderVariants();
    renderCreativeEditor();
    clearError();
  }

  function renderRuntimeStatus() {
    $("pp-storefront-status").textContent = runtime.storefrontEnabled ? "Storefront enabled" : "Storefront off";
    $("pp-storefront-status").className = `pp-status ${runtime.storefrontEnabled ? "warn" : "off"}`;
    $("pp-kill-status").textContent = runtime.killSwitch ? "Kill switch on" : "Kill switch off";
    $("pp-kill-status").className = `pp-status ${runtime.killSwitch ? "safe" : "warn"}`;
    $("pp-boundary-status").textContent = String(runtime.boundary || "STAGING_ONLY").replaceAll("_", " ").toLowerCase();
    $("pp-runtime-code").textContent = [
      `POPUP_STAGING_ENABLED=${runtime.stagingEnabled}`,
      `POPUP_STAGING_EVENT_INGEST=${runtime.eventIngestEnabled}`,
      `POPUP_KILL_SWITCH=${runtime.killSwitch}`,
      `storefrontEnabled=${runtime.storefrontEnabled}`,
    ].join("\n");
  }

  function populate(configInput) {
    config = structuredClone(configInput || FALLBACK);
    activeVariantIndex = 0;
    setValue("popup-key", config.key);
    setValue("popup-name", config.name);
    setValue("popup-type", config.type);
    setValue("popup-status", config.status);
    setValue("experiment-version", config.experimentVersion);

    setValue("trigger-mode", config.trigger.mode);
    setValue("trigger-seconds", config.trigger.seconds);
    setValue("trigger-scroll", config.trigger.scrollPct);
    setValue("trigger-inactivity", config.trigger.inactivitySeconds);
    setChecked("trigger-require-cart", config.trigger.requireCartItems);
    setChecked("trigger-desktop-exit", config.trigger.desktopExitOnly);

    setValue("target-include-paths", joinList(config.targeting.includePaths));
    setValue("target-exclude-paths", joinList(config.targeting.excludePaths));
    setValue("target-products", joinList(config.targeting.productHandles));
    setValue("target-funnels", joinList(config.targeting.funnelIds));
    setValue("target-sources", joinList(config.targeting.trafficSources));
    setValue("target-utm", joinList(config.targeting.utmSources));
    setValue("target-referrer", joinList(config.targeting.referrerContains));
    setValue("target-visitor-state", config.targeting.visitorState);
    setValue("target-cart-min", config.targeting.cartMinSubtotal);
    setValue("target-cart-max", config.targeting.cartMaxSubtotal);
    setChecked("target-require-cart", config.targeting.requireCartItems);

    setValue("freq-close-minutes", config.frequency.suppressAfterCloseMinutes);
    setValue("freq-submit-days", config.frequency.suppressAfterSubmitDays);
    setValue("freq-session-max", config.frequency.maxImpressionsPerSession);
    setValue("freq-day-max", config.frequency.maxImpressionsPerVisitorDay);

    setChecked("safety-backdrop", config.safety.backdropClose);
    setValue("safety-timeout", config.safety.maxOpenMs);
    $("pp-campaign-state").textContent = config.status === "PAUSED" ? "Paused" : "Draft";
    renderVariants();
    renderCreativeEditor();
  }

  function collectConfig() {
    syncCreativeFromInputs();
    config.key = String($("popup-key")?.value || "").trim();
    config.name = String($("popup-name")?.value || "").trim();
    config.type = $("popup-type")?.value || "lead_capture";
    config.status = $("popup-status")?.value || "DRAFT";
    config.experimentVersion = Math.max(1, Math.round(numberValue("experiment-version", 1)));
    config.trigger = {
      mode: $("trigger-mode")?.value || "time",
      seconds: numberValue("trigger-seconds", 20),
      scrollPct: numberValue("trigger-scroll", 50),
      inactivitySeconds: numberValue("trigger-inactivity", 30),
      requireCartItems: Boolean($("trigger-require-cart")?.checked),
      desktopExitOnly: Boolean($("trigger-desktop-exit")?.checked),
    };
    config.targeting = {
      includePaths: splitList($("target-include-paths")?.value),
      excludePaths: splitList($("target-exclude-paths")?.value),
      productHandles: splitList($("target-products")?.value),
      funnelIds: splitList($("target-funnels")?.value),
      trafficSources: splitList($("target-sources")?.value),
      referrerContains: splitList($("target-referrer")?.value),
      utmSources: splitList($("target-utm")?.value),
      visitorState: $("target-visitor-state")?.value || "any",
      cartMinSubtotal: nullableNumber($("target-cart-min")?.value),
      cartMaxSubtotal: nullableNumber($("target-cart-max")?.value),
      requireCartItems: Boolean($("target-require-cart")?.checked),
    };
    config.frequency = {
      suppressAfterCloseMinutes: numberValue("freq-close-minutes", 1440),
      suppressAfterSubmitDays: numberValue("freq-submit-days", 30),
      maxImpressionsPerSession: numberValue("freq-session-max", 1),
      maxImpressionsPerVisitorDay: numberValue("freq-day-max", 1),
    };
    config.safety = {
      visibleCloseButton: true,
      escClose: true,
      localImmediateClose: true,
      backdropClose: Boolean($("safety-backdrop")?.checked),
      restoreFocus: true,
      cleanupBodyScroll: true,
      maxOpenMs: numberValue("safety-timeout", 300000),
    };
    $("pp-campaign-state").textContent = config.status === "PAUSED" ? "Paused" : "Draft";
    return structuredClone(config);
  }

  function validateLocal(candidate) {
    const errors = [];
    if (!candidate.key) errors.push("Campaign key is required.");
    if (!candidate.name) errors.push("Campaign name is required.");
    const total = candidate.variants.reduce((sum, item) => sum + (Number(item.weightBasisPoints) || 0), 0);
    if (total !== 10000) errors.push(`Variant weights must total 100%; current total is ${(total / 100).toFixed(2)}%.`);
    if (candidate.targeting.cartMinSubtotal != null && candidate.targeting.cartMaxSubtotal != null && candidate.targeting.cartMaxSubtotal < candidate.targeting.cartMinSubtotal) errors.push("Cart maximum must be greater than or equal to cart minimum.");
    return errors;
  }

  async function saveDraft() {
    clearError();
    const candidate = collectConfig();
    const localErrors = validateLocal(candidate);
    if (localErrors.length) {
      showError(localErrors.join(" "));
      return;
    }
    if (!api?.put) {
      $("popup-save-status").textContent = "API unavailable. Preview is still safe, but the draft was not persisted.";
      return;
    }
    const button = $("btn-popup-save");
    button.disabled = true;
    $("popup-save-status").textContent = "Saving draft…";
    try {
      const response = await api.put(`/api/popups/campaigns/${encodeURIComponent(candidate.key)}`, candidate);
      config = structuredClone(response.campaign || candidate);
      runtime = response.runtime || runtime;
      populate(config);
      renderRuntimeStatus();
      $("popup-save-status").textContent = "Draft saved. Storefront remains off.";
    } catch (error) {
      showError(error.message);
      $("popup-save-status").textContent = "Save failed. Nothing was published.";
    } finally {
      button.disabled = false;
    }
  }

  function openPreview() {
    clearError();
    const candidate = collectConfig();
    const preview = window.TigerPopupPreview;
    if (!preview?.open) return showError("Preview runtime did not load.");
    const result = preview.open({
      campaign: candidate,
      variant: activeVariant(),
      onEvent: (name) => {
        // Deliberately local only. Preview events are not posted to the API.
        $("popup-save-status").textContent = `Local preview event: ${name}. No storefront event was sent.`;
      },
    });
    if (!result.opened) showError(`Preview did not open: ${result.reason}`);
  }

  function simulatorContext() {
    return {
      visitorId: "preview-visitor-sticky",
      sessionId: "preview-session",
      sessionElapsedMs: Math.max(0, numberValue("sim-elapsed", 25)) * 1000,
      scrollDepthPct: numberValue("sim-scroll", 70),
      inactiveMs: 45_000,
      exitIntent: true,
      manualTrigger: true,
      isMobile: false,
      pagePath: $("sim-path")?.value || "/",
      productHandle: "novahair",
      funnelId: null,
      trafficSource: $("sim-utm")?.value || null,
      referrer: "https://www.facebook.com/",
      utmSource: $("sim-utm")?.value || null,
      visitorState: "new",
      cartSubtotal: 250,
      cartItemCount: Math.max(0, numberValue("sim-cart-items", 0)),
      previousCloseAtMs: null,
      previousSubmitAtMs: null,
      sessionImpressions: 0,
      visitorDayImpressions: 0,
    };
  }

  async function runSimulator() {
    clearError();
    const candidate = collectConfig();
    const localErrors = validateLocal(candidate);
    if (localErrors.length) return showError(localErrors.join(" "));
    const resultBox = $("pp-simulator-result");
    if (!api?.post) {
      resultBox.className = "pp-callout warn";
      resultBox.textContent = "Simulator API unavailable. Creative preview remains available offline.";
      return;
    }
    resultBox.className = "pp-callout";
    resultBox.textContent = "Evaluating…";
    try {
      const response = await api.post("/api/popups/evaluate", { campaign: candidate, context: simulatorContext() });
      const result = response.result || {};
      resultBox.className = `pp-callout ${result.eligible ? "safe" : "warn"}`;
      resultBox.textContent = result.eligible
        ? `Eligible · sticky variant: ${result.variant?.name || result.variant?.key || "—"} · bucket ${result.assignmentBucket}`
        : `Not eligible · reason: ${result.reason || "unknown"}`;
    } catch (error) {
      resultBox.className = "pp-callout danger";
      resultBox.textContent = `Simulator failed: ${error.message}`;
    }
  }

  function runSafetyTest() {
    const preview = window.TigerPopupPreview;
    if (!preview?.safetySelfTest) return showError("Preview safety runtime did not load.");
    const result = preview.safetySelfTest();
    const output = $("pp-safety-result");
    output.textContent = result.pass ? "PASS — opened, locally closed, restored body state and focus." : `FAIL — ${JSON.stringify(result)}`;
    output.style.color = result.pass ? "#166534" : "#991b1b";
    document.body.dataset.popupSafetySelfTest = result.pass ? "pass" : "fail";
  }

  function metric(name, totals) {
    return Number(totals?.[name] || 0).toLocaleString();
  }

  async function loadAnalytics() {
    const body = $("pp-analytics-body");
    if (!api?.get) return;
    try {
      const key = encodeURIComponent(config.key || "");
      const response = await api.get(`/api/popups/analytics?campaignKey=${key}`);
      const totals = response.totals || {};
      $("metric-eligible").textContent = metric("popup_eligible", totals);
      $("metric-impression").textContent = metric("popup_impression", totals);
      $("metric-cta").textContent = metric("popup_cta_click", totals);
      $("metric-submit").textContent = metric("popup_submit", totals);
      body.textContent = "";
      const entries = Object.entries(response.variants || {});
      if (!entries.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 9;
        cell.className = "pp-empty";
        cell.textContent = "No staging events for this campaign.";
        row.appendChild(cell);
        body.appendChild(row);
        return;
      }
      for (const [variant, counts] of entries) {
        const row = document.createElement("tr");
        const values = [variant, metric("popup_eligible", counts), metric("popup_impression", counts), metric("popup_close", counts), metric("popup_cta_click", counts), metric("popup_submit", counts), metric("popup_add_to_cart", counts), metric("popup_checkout", counts), metric("popup_purchase", counts)];
        for (const value of values) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        }
        body.appendChild(row);
      }
    } catch (error) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 9;
      cell.className = "pp-empty";
      cell.textContent = `Analytics unavailable: ${error.message}`;
      row.appendChild(cell);
      body.textContent = "";
      body.appendChild(row);
    }
  }

  async function load() {
    renderRuntimeStatus();
    if (!api?.get) {
      populate(FALLBACK);
      $("popup-save-status").textContent = "API unavailable. Loaded safe local preview defaults.";
      return;
    }
    try {
      const [statusResponse, configResponse] = await Promise.all([
        api.get("/api/popups/status"),
        api.get("/api/popups/config"),
      ]);
      runtime = statusResponse || runtime;
      renderRuntimeStatus();
      const first = configResponse.campaigns?.[0] || configResponse.defaultCampaign || FALLBACK;
      populate(first);
      $("popup-save-status").textContent = configResponse.campaigns?.length ? "Saved draft loaded. Storefront remains off." : "New local draft. Save when ready.";
    } catch (error) {
      populate(FALLBACK);
      showError(`Admin API unavailable: ${error.message}. Safe local preview is still usable.`);
      $("popup-save-status").textContent = "Fallback preview loaded; nothing is published.";
    }
  }

  tabs.forEach(tab => tab.addEventListener("click", () => {
    setTab(tab.dataset.tab);
    if (tab.dataset.tab === "analytics") loadAnalytics();
  }));

  ["creative-eyebrow", "creative-title", "creative-body", "creative-cta", "creative-secondary", "creative-form", "creative-direction", "creative-image"].forEach(id => {
    $(id)?.addEventListener("input", updateInlinePreview);
    $(id)?.addEventListener("change", updateInlinePreview);
  });

  $("btn-popup-save")?.addEventListener("click", saveDraft);
  $("btn-popup-preview")?.addEventListener("click", openPreview);
  $("btn-popup-evaluate")?.addEventListener("click", runSimulator);
  $("btn-popup-evaluate-secondary")?.addEventListener("click", runSimulator);
  $("btn-add-variant")?.addEventListener("click", addVariant);
  $("btn-safety-test")?.addEventListener("click", runSafetyTest);
  $("btn-refresh-analytics")?.addEventListener("click", loadAnalytics);

  load();
})();
