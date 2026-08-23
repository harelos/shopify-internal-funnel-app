document.addEventListener("DOMContentLoaded", () => {
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const panels = [...document.querySelectorAll("[data-panel]")];
  const brainTabs = [...document.querySelectorAll("[data-brain-tab]")];
  const brainPanels = [...document.querySelectorAll("[data-brain-panel]")];
  const modelWeights = [...document.querySelectorAll(".model-weight")];
  const modelWeightStatus = document.getElementById("model-weight-status");
  const saveStatus = document.getElementById("bot-save-status");

  function setTab(name) {
    tabs.forEach(tab => tab.classList.toggle("btn-primary", tab.dataset.tab === name));
    panels.forEach(panel => panel.classList.toggle("hidden", panel.dataset.panel !== name));
  }

  function setBrainTab(name) {
    brainTabs.forEach(tab => tab.classList.toggle("btn-primary", tab.dataset.brainTab === name));
    brainPanels.forEach(panel => panel.classList.toggle("hidden", panel.dataset.brainPanel !== name));
  }

  function updateModelAllocation() {
    const total = modelWeights.reduce((sum, input) => sum + Math.max(0, Number(input.value || 0)), 0);
    if (!modelWeightStatus) return;
    modelWeightStatus.textContent = `Traffic allocation: ${total}%${total === 100 ? "" : " — must total 100% before activation"}`;
    modelWeightStatus.style.color = total === 100 ? "var(--green)" : "var(--accent)";
  }

  function collectDraft() {
    const value = id => document.getElementById(id)?.value ?? "";
    const checked = id => Boolean(document.getElementById(id)?.checked);
    return {
      version: 1,
      identity: {
        name: value("bot-name"),
        label: value("bot-label"),
        welcome: value("bot-welcome"),
        placement: value("bot-placement"),
      },
      routing: {
        support: checked("route-support"),
        retention: checked("route-retention"),
        risk: checked("route-risk"),
      },
      playbook: {
        stages: value("sales-stages"),
        methods: value("sales-methods"),
      },
      offers: {
        firstPct: Number(value("discount-first") || 0),
        secondPct: Number(value("discount-second") || 0),
        maxPct: Number(value("discount-max") || 0),
        firstMinMessages: Number(value("discount-first-msgs") || 0),
        secondMinMessages: Number(value("discount-second-msgs") || 0),
        marginFloorIls: value("margin-floor") === "" ? null : Number(value("margin-floor")),
      },
      models: [...document.querySelectorAll(".model-provider")].map((input, index) => ({
        model: input.value.trim(),
        trafficPct: Math.max(0, Number(modelWeights[index]?.value || 0)),
      })),
      crm: {
        progressive: checked("crm-progressive"),
        email: checked("crm-email"),
        phone: checked("crm-phone"),
      },
      security: {
        messagesPer5m: Number(value("sec-msg-5m") || 0),
        messagesPerHour: Number(value("sec-msg-hour") || 0),
        maxUserChars: Number(value("sec-max-chars") || 0),
      },
      savedAt: new Date().toISOString(),
    };
  }

  function restoreDraft() {
    try {
      const raw = localStorage.getItem("tiger-bot-config-draft-v1");
      if (!raw) return;
      const draft = JSON.parse(raw);
      const setValue = (id, value) => {
        const node = document.getElementById(id);
        if (node && value !== undefined && value !== null) node.value = String(value);
      };
      const setChecked = (id, value) => {
        const node = document.getElementById(id);
        if (node && typeof value === "boolean") node.checked = value;
      };

      setValue("bot-name", draft.identity?.name);
      setValue("bot-label", draft.identity?.label);
      setValue("bot-welcome", draft.identity?.welcome);
      setValue("bot-placement", draft.identity?.placement);
      setChecked("route-support", draft.routing?.support);
      setChecked("route-retention", draft.routing?.retention);
      setChecked("route-risk", draft.routing?.risk);
      setValue("sales-stages", draft.playbook?.stages);
      setValue("sales-methods", draft.playbook?.methods);
      setValue("discount-first", draft.offers?.firstPct);
      setValue("discount-second", draft.offers?.secondPct);
      setValue("discount-max", draft.offers?.maxPct);
      setValue("discount-first-msgs", draft.offers?.firstMinMessages);
      setValue("discount-second-msgs", draft.offers?.secondMinMessages);
      setValue("margin-floor", draft.offers?.marginFloorIls);
      setChecked("crm-progressive", draft.crm?.progressive);
      setChecked("crm-email", draft.crm?.email);
      setChecked("crm-phone", draft.crm?.phone);
      setValue("sec-msg-5m", draft.security?.messagesPer5m);
      setValue("sec-msg-hour", draft.security?.messagesPerHour);
      setValue("sec-max-chars", draft.security?.maxUserChars);

      const providers = [...document.querySelectorAll(".model-provider")];
      (draft.models || []).forEach((model, index) => {
        if (providers[index]) providers[index].value = model.model || "";
        if (modelWeights[index] && model.trafficPct != null) modelWeights[index].value = String(model.trafficPct);
      });
      if (saveStatus) saveStatus.textContent = `Restored local draft from ${new Date(draft.savedAt).toLocaleString()}. Nothing is deployed.`;
    } catch {
      localStorage.removeItem("tiger-bot-config-draft-v1");
    }
  }

  tabs.forEach(tab => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
  brainTabs.forEach(tab => tab.addEventListener("click", () => setBrainTab(tab.dataset.brainTab)));
  modelWeights.forEach(input => input.addEventListener("input", updateModelAllocation));

  document.getElementById("btn-bot-save")?.addEventListener("click", () => {
    const draft = collectDraft();
    const trafficTotal = draft.models.reduce((sum, item) => sum + item.trafficPct, 0);
    if (trafficTotal !== 100) {
      if (saveStatus) saveStatus.textContent = "Draft not saved: model traffic must total exactly 100%.";
      return;
    }
    if (draft.offers.firstPct > draft.offers.maxPct || draft.offers.secondPct > draft.offers.maxPct) {
      if (saveStatus) saveStatus.textContent = "Draft not saved: an offer tier cannot exceed the absolute discount cap.";
      return;
    }
    localStorage.setItem("tiger-bot-config-draft-v1", JSON.stringify(draft));
    if (saveStatus) saveStatus.textContent = "Local admin draft saved. Storefront runtime remains disabled and no customer can see this configuration.";
  });

  restoreDraft();
  updateModelAllocation();
});
