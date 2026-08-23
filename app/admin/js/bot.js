document.addEventListener("DOMContentLoaded", () => {
  const client = window.API;
  const saveStatus = document.getElementById("bot-save-status");
  const LOCAL_BACKUP_KEY = "tiger-bot-config-draft-v2";
  let currentConfig = null;
  let simulatorConversationId = null;

  const $ = id => document.getElementById(id);
  const val = id => $(id)?.value ?? "";
  const checked = id => Boolean($(id)?.checked);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function section(name) {
    document.querySelectorAll("[data-section]").forEach(node => node.classList.toggle("active", node.dataset.section === name));
    document.querySelectorAll(".bot-section").forEach(node => node.classList.toggle("active", node.dataset.panel === name));
    if (name === "knowledge") loadKnowledge();
    if (name === "analytics") loadAnalytics();
  }
  document.querySelectorAll("[data-section]").forEach(node => node.addEventListener("click", () => section(node.dataset.section)));

  function modelRows() { return [...document.querySelectorAll(".bot-model-row")]; }
  function addModelRow(model = { provider: "mock", model: "mock-sales", trafficPct: 0 }) {
    const root = $("model-rows");
    if (!root || modelRows().length >= 12) return;
    const row = document.createElement("div");
    row.className = "bot-model-row";
    row.innerHTML = `
      <select class="bot-select provider" data-model-provider>
        <option value="mock">Mock</option><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="anthropic">Anthropic</option><option value="xai">xAI / Grok</option>
      </select>
      <input class="bot-input model" data-model-name placeholder="model id">
      <input class="bot-input weight" data-model-weight type="number" min="0" max="100" step="0.01" aria-label="Traffic percent">
      <button class="bot-btn danger small remove" data-model-remove aria-label="Remove">×</button>`;
    root.appendChild(row);
    row.querySelector("[data-model-provider]").value = model.provider || "mock";
    row.querySelector("[data-model-name]").value = model.model || "";
    row.querySelector("[data-model-weight]").value = String(model.trafficPct ?? 0);
    row.querySelector("[data-model-weight]").addEventListener("input", updateModelTotal);
    row.querySelector("[data-model-remove]").addEventListener("click", () => { row.remove(); updateModelTotal(); });
    updateModelTotal();
  }

  function updateModelTotal() {
    const total = modelRows().reduce((sum, row) => sum + Math.max(0, Number(row.querySelector("[data-model-weight]")?.value || 0)), 0);
    const badge = $("model-weight-status");
    if (badge) {
      badge.textContent = `${Number(total.toFixed(2))}% allocated`;
      badge.classList.toggle("good", Math.abs(total - 100) < 0.0001);
      badge.classList.toggle("warn", Math.abs(total - 100) >= 0.0001);
    }
  }
  $("model-add")?.addEventListener("click", () => addModelRow({ provider: "openai", model: "", trafficPct: 0 }));

  function collectConfig() {
    return {
      version: 1,
      identity: {
        name: val("bot-name"), label: val("bot-label"), welcome: val("bot-welcome"), placement: val("bot-placement"),
        avatarUrl: val("bot-avatar-url"), subtitle: val("bot-subtitle"), trustLine: val("bot-trust-line"),
      },
      routing: { support: checked("route-support"), retention: checked("route-retention"), risk: checked("route-risk") },
      playbook: { stages: val("sales-stages"), methods: val("sales-methods") },
      offers: {
        firstPct: Number(val("discount-first") || 0), secondPct: Number(val("discount-second") || 0), maxPct: Number(val("discount-max") || 0),
        firstMinMessages: Number(val("discount-first-msgs") || 0), secondMinMessages: Number(val("discount-second-msgs") || 0),
        marginFloorIls: val("margin-floor") === "" ? null : Number(val("margin-floor")),
      },
      models: modelRows().map(row => ({
        provider: row.querySelector("[data-model-provider]")?.value || "mock",
        model: row.querySelector("[data-model-name]")?.value.trim() || "",
        trafficPct: Math.max(0, Number(row.querySelector("[data-model-weight]")?.value || 0)),
      })).filter(item => item.model),
      crm: { progressive: checked("crm-progressive"), email: checked("crm-email"), phone: checked("crm-phone") },
      security: { messagesPer5m: Number(val("sec-msg-5m") || 0), messagesPerHour: Number(val("sec-msg-hour") || 0), maxUserChars: Number(val("sec-max-chars") || 0) },
    };
  }

  function setValue(id, value) { const node = $(id); if (node && value !== undefined && value !== null) node.value = String(value); }
  function setChecked(id, value) { const node = $(id); if (node && typeof value === "boolean") node.checked = value; }

  function applyConfig(config) {
    currentConfig = config;
    setValue("bot-name", config.identity?.name); setValue("bot-label", config.identity?.label); setValue("bot-welcome", config.identity?.welcome);
    setValue("bot-placement", config.identity?.placement); setValue("bot-avatar-url", config.identity?.avatarUrl); setValue("bot-subtitle", config.identity?.subtitle); setValue("bot-trust-line", config.identity?.trustLine);
    setChecked("route-support", config.routing?.support); setChecked("route-retention", config.routing?.retention); setChecked("route-risk", config.routing?.risk);
    setValue("sales-stages", config.playbook?.stages); setValue("sales-methods", config.playbook?.methods);
    setValue("discount-first", config.offers?.firstPct); setValue("discount-second", config.offers?.secondPct); setValue("discount-max", config.offers?.maxPct);
    setValue("discount-first-msgs", config.offers?.firstMinMessages); setValue("discount-second-msgs", config.offers?.secondMinMessages); setValue("margin-floor", config.offers?.marginFloorIls);
    setChecked("crm-progressive", config.crm?.progressive); setChecked("crm-email", config.crm?.email); setChecked("crm-phone", config.crm?.phone);
    setValue("sec-msg-5m", config.security?.messagesPer5m); setValue("sec-msg-hour", config.security?.messagesPerHour); setValue("sec-max-chars", config.security?.maxUserChars);
    $("model-rows").innerHTML = "";
    (config.models?.length ? config.models : [{ provider: "mock", model: "mock-sales", trafficPct: 100 }]).forEach(addModelRow);
    refreshPreview();
  }

  function refreshPreview() {
    const name = val("bot-name") || "Sara";
    const subtitle = val("bot-subtitle") || "כאן כדי לעזור לבחור נכון";
    const welcome = val("bot-welcome") || "מה תרצי לדעת לפני שאת מחליטה?";
    const trust = val("bot-trust-line") || "מידע על המוצר, משלוחים והזמנות במקום אחד";
    $("preview-name").textContent = name; $("sim-name").textContent = name; $("preview-subtitle").textContent = subtitle; $("preview-welcome").textContent = welcome; $("preview-trust").textContent = trust;
    const initial = name.trim().charAt(0).toUpperCase() || "S";
    [$("preview-avatar"), $("sim-avatar")].forEach(node => { if (node) { node.textContent = initial; node.style.backgroundImage = ""; } });
    const avatar = val("bot-avatar-url").trim();
    if (/^https:\/\//i.test(avatar)) [$("preview-avatar"), $("sim-avatar")].forEach(node => { if (node) { node.style.backgroundImage = `url("${avatar.replace(/"/g, "%22")}")`; node.textContent = ""; } });
  }
  ["bot-name","bot-subtitle","bot-welcome","bot-trust-line","bot-avatar-url"].forEach(id => $(id)?.addEventListener("input", refreshPreview));

  async function loadConfig() {
    try {
      const response = await client.get("/api/bot/config");
      applyConfig(response.config);
      saveStatus.textContent = response.persisted ? "Server draft loaded · storefront off" : "Default draft loaded · storefront off";
    } catch (error) {
      try {
        const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
        if (raw) { applyConfig(JSON.parse(raw)); saveStatus.textContent = "Server unavailable · browser backup loaded"; return; }
      } catch (_) {}
      saveStatus.textContent = `Could not load: ${error.message || error}`;
    }
  }

  async function saveConfig() {
    const draft = collectConfig();
    const total = draft.models.reduce((sum, item) => sum + item.trafficPct, 0);
    if (!draft.models.length || Math.abs(total - 100) > 0.0001) { saveStatus.textContent = "Model traffic must total exactly 100%."; section("models"); return; }
    localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(draft));
    saveStatus.textContent = "Saving…";
    try {
      const response = await client.put("/api/bot/config", draft);
      currentConfig = response.config;
      saveStatus.textContent = `Saved ${response.status || "DRAFT"} · storefront off`;
    } catch (error) { saveStatus.textContent = `Save failed: ${error.message || error}`; }
  }
  $("btn-bot-save")?.addEventListener("click", saveConfig);

  async function loadProviders() {
    try {
      const response = await client.get("/api/bot/providers/status");
      const root = $("provider-status"); root.innerHTML = "";
      Object.entries(response.providers || {}).filter(([key]) => key !== "pricingConfigured").forEach(([key, on]) => {
        const span = document.createElement("span"); span.className = `bot-provider-chip ${on ? "on" : ""}`; span.textContent = `${key}: ${on ? "ready" : "not configured"}`; root.appendChild(span);
      });
      const pricing = document.createElement("span"); pricing.className = `bot-provider-chip ${response.providers?.pricingConfigured ? "on" : ""}`; pricing.textContent = `pricing: ${response.providers?.pricingConfigured ? "ready" : "missing"}`; root.appendChild(pricing);
    } catch (_) {}
  }

  async function loadKnowledge() {
    const root = $("knowledge-list");
    try {
      const response = await client.get("/api/bot/knowledge"); $("knowledge-count").textContent = String(response.count || 0);
      if (!response.packs?.length) { root.innerHTML = '<div class="bot-empty">No knowledge packs yet.</div>'; return; }
      root.innerHTML = response.packs.map(pack => `<div class="bot-knowledge-item"><div><strong>${esc(pack.title)}</strong><span>${esc(pack.key)} · ${esc(pack.scope)}${pack.scopeId ? `:${esc(pack.scopeId)}` : ""} · priority ${esc(pack.priority)}</span></div><button class="bot-btn danger small" data-delete-knowledge="${esc(pack.key)}">Delete</button></div>`).join("");
      root.querySelectorAll("[data-delete-knowledge]").forEach(button => button.addEventListener("click", async () => { await client.del(`/api/bot/knowledge/${encodeURIComponent(button.dataset.deleteKnowledge)}`); await loadKnowledge(); }));
    } catch (error) { root.innerHTML = `<div class="bot-empty bot-error">${esc(error.message || error)}</div>`; }
  }

  $("knowledge-save")?.addEventListener("click", async () => {
    const key = val("knowledge-key").trim(); if (!key) { $("knowledge-status").textContent = "Key required"; return; }
    try {
      await client.put(`/api/bot/knowledge/${encodeURIComponent(key)}`, { title: val("knowledge-title"), scope: val("knowledge-scope"), scopeId: val("knowledge-scope-id") || null, priority: Number(val("knowledge-priority") || 0), text: val("knowledge-text") });
      $("knowledge-status").textContent = "Saved"; await loadKnowledge();
    } catch (error) { $("knowledge-status").textContent = error.message || String(error); }
  });

  function appendSim(role, text) {
    const div = document.createElement("div"); div.className = `bot-msg ${role === "user" ? "user" : "assistant"}`; div.textContent = text; $("sim-messages").appendChild(div); $("sim-messages").scrollTop = $("sim-messages").scrollHeight;
  }
  function simulatorContext() { return { pageType: val("sim-page-type"), productId: val("sim-product-id") || null, funnelId: val("sim-funnel-id") || null, cartValueIls: val("sim-cart-value") === "" ? null : Number(val("sim-cart-value")), returningCustomer: checked("sim-returning"), vipCustomer: checked("sim-vip") }; }
  function resetSimulator() { simulatorConversationId = null; $("sim-messages").innerHTML = '<div class="bot-msg assistant">שלחי הודעת בדיקה. שום דבר כאן לא מופיע בחנות.</div>'; $("sim-meta").textContent = "Conversation not started."; }
  $("sim-reset")?.addEventListener("click", resetSimulator);
  async function sendSimulator() {
    const input = $("sim-input"); const message = input.value.trim(); if (!message) return; input.value = ""; appendSim("user", message); $("sim-send").disabled = true; $("sim-meta").textContent = "Thinking…";
    const typing = document.createElement("div"); typing.className = "bot-typing"; typing.innerHTML = "<i></i><i></i><i></i>"; $("sim-messages").appendChild(typing);
    try {
      const response = await client.post("/api/bot/simulator/message", { conversationId: simulatorConversationId, visitorKey: "admin-simulator-sticky", message, pageContext: simulatorContext() });
      simulatorConversationId = response.conversationId; typing.remove(); appendSim("assistant", response.reply);
      $("sim-meta").textContent = `${response.route} · ${response.model.provider}/${response.model.model} · ${response.latencyMs}ms${response.estimatedCostUsd == null ? " · cost unknown" : ` · $${Number(response.estimatedCostUsd).toFixed(6)}`}`;
    } catch (error) { typing.remove(); appendSim("assistant", `Simulator error: ${error.message || error}`); $("sim-meta").textContent = "Failed without model fallback."; }
    finally { $("sim-send").disabled = false; }
  }
  $("sim-send")?.addEventListener("click", sendSimulator); $("sim-input")?.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendSimulator(); } });

  $("preview-send")?.addEventListener("click", () => { section("simulator"); $("sim-input").focus(); });

  async function loadAnalytics() {
    try {
      const response = await client.get(`/api/bot/analytics?range=${encodeURIComponent(val("analytics-range") || "7d")}`);
      $("kpi-conversations").textContent = response.conversations ?? 0; $("kpi-user-messages").textContent = response.counters?.BOT_MESSAGE_USER ?? 0; $("kpi-assistant-messages").textContent = response.counters?.BOT_MESSAGE_ASSISTANT ?? 0;
      $("kpi-errors").textContent = (response.counters?.bot_error ?? 0) + (response.counters?.bot_security_block ?? 0);
      const rows = Object.entries(response.models || {}); const root = $("analytics-models");
      if (!rows.length) { root.innerHTML = '<div class="bot-empty">No model telemetry yet.</div>'; return; }
      root.innerHTML = `<table class="bot-table"><thead><tr><th>Model</th><th>Conversations</th><th>Messages</th><th>Avg latency</th><th>Est. AI cost</th></tr></thead><tbody>${rows.map(([model, data]) => `<tr><td>${esc(model)}</td><td>${esc(data.conversations)}</td><td>${esc(data.messages)}</td><td>${data.avgLatencyMs == null ? "—" : `${esc(data.avgLatencyMs)} ms`}</td><td>${Number(data.estimatedCostUsd || 0) ? `$${Number(data.estimatedCostUsd).toFixed(6)}` : "—"}</td></tr>`).join("")}</tbody></table>`;
    } catch (error) { $("analytics-models").innerHTML = `<div class="bot-empty bot-error">${esc(error.message || error)}</div>`; }
  }
  $("analytics-range")?.addEventListener("change", loadAnalytics);

  loadConfig(); loadProviders(); refreshPreview(); updateModelTotal();
});
