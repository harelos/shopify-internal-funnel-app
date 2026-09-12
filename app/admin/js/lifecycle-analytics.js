document.addEventListener("DOMContentLoaded", () => {
  const state = { currentDays: "7", selectedFlow: "abandoned_checkout", analytics: null, audience: null, health: null };
  const $ = (selector) => document.querySelector(selector);
  const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  const formatDate = (value) => value ? new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
  const formatMoney = (values = {}) => {
    const entries = Object.entries(values || {});
    return entries.length ? entries.map(([currency, amount]) => `${currency} ${Number(amount || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") : "₪0.00";
  };
  const count = (flows, field) => flows.reduce((total, flow) => total + Number(flow.metrics?.[field] || 0), 0);
  const getFlow = () => (state.analytics?.flows || []).find((flow) => flow.flow === state.selectedFlow) || null;
  const activityFor = (flow) => (state.audience?.flowActivity || []).find((item) => item.flow === flow) || {};
  const flowStatus = (flow) => {
    if (String(flow.status).toLowerCase() === "enabled") return { label: "פעיל", className: "status-live", explanation: "שולח כאשר הטריגר והתנאים מתקיימים." };
    if (["abandoned_cart", "browse_abandonment"].includes(flow.flow)) return { label: "ממתין לזיהוי", className: "status-paused", explanation: "כבוי עד שיש זיהוי אמין והסכמה לשיווק; לא נשלח לאורחת אנונימית." };
    return { label: "מושהה", className: "status-paused", explanation: "לא ישלח עד שיופעל ב‑Resend." };
  };

  function showView(view) {
    document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== view; });
    document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  }

  function renderOverview() {
    const flows = state.analytics?.flows || [];
    const totals = state.analytics?.totals || {};
    $("#metric-sent").textContent = count(flows, "sent").toLocaleString("he-IL");
    $("#metric-delivered").textContent = count(flows, "delivered").toLocaleString("he-IL");
    $("#metric-opened").textContent = count(flows, "opened").toLocaleString("he-IL");
    $("#metric-clicked").textContent = count(flows, "firstPartyClicked").toLocaleString("he-IL");
    $("#metric-revenue").textContent = formatMoney(totals.firstPartyAttributedRevenueByCurrency || {});
    $("#flows-updated").textContent = `${flows.length} Flows · ${flows.reduce((sum, flow) => sum + (flow.emails?.length || 0), 0)} מיילים מתוכננים`;
    $("#flow-cards").innerHTML = flows.map((flow) => {
      const status = flowStatus(flow); const activity = activityFor(flow.flow); const metrics = flow.metrics || {};
      const next = String(flow.status).toLowerCase() === "enabled" && activity.nextScheduledAt ? `השלב הבא: ${formatDate(activity.nextScheduledAt)}` : status.explanation;
      return `<button class="flow-card ${flow.flow === state.selectedFlow ? "selected" : ""}" data-flow="${safe(flow.flow)}"><div class="flow-card-top"><span class="badge ${status.className}">${status.label}</span><span class="eyebrow">${Number(flow.plannedEmails || flow.emails?.length || 0)} מיילים</span></div><h3>${safe(flow.name)}</h3><p class="muted">${safe(next)}</p><div class="flow-card-stats"><span>${Number(metrics.sent || 0)} נשלחו</span><span>${Number(activity.peopleWaiting || 0)} ממתינות</span><span>${Number(metrics.firstPartyClicked || 0)} קליקים</span></div></button>`;
    }).join("");
    document.querySelectorAll("[data-flow]").forEach((button) => button.addEventListener("click", () => { state.selectedFlow = button.dataset.flow; renderOverview(); renderFlowDetail(); renderLibrary(); }));
  }

  function renderFlowDetail() {
    const flow = getFlow(); if (!flow) return;
    const status = flowStatus(flow); const activity = activityFor(flow.flow); const metrics = flow.metrics || {};
    $("#selected-flow-title").textContent = flow.name;
    const automation = $("#selected-flow-automation"); automation.hidden = !flow.automationUrl; automation.href = flow.automationUrl || "#";
    $("#selected-flow-detail").innerHTML = `<div class="flow-detail-head"><div><span class="badge ${status.className}">${status.label}</span><p class="muted" style="margin-top:8px">${safe(status.explanation)}</p></div><button class="btn btn-sm" id="open-library">ספריית המיילים</button></div><div class="flow-detail-meta"><div><b>מה מפעיל אותו</b><span class="muted">${safe(flow.trigger || "מוגדר ב‑Automation")}</span></div><div><b>מה עוצר אותו</b><span class="muted">${safe(flow.exit || "רכישה, recovery, או suppression לפי ה‑Flow")}</span></div><div><b>מצב חי</b><span class="muted">${Number(metrics.sent || 0)} נשלחו · ${Number(activity.peopleWaiting || 0)} ממתינות${activity.nextScheduledAt ? ` · הבא ${formatDate(activity.nextScheduledAt)}` : ""}</span></div></div><ol class="step-list">${(flow.emails || []).map((email) => { const metric = email.metrics || {}; return `<li><span class="step-number">${Number(email.number)}</span><div><strong>${safe(email.title || `מייל ${email.number}`)}</strong><div class="step-subject">${safe(email.subject || "")} · ${safe(email.timing || "")}</div></div><span class="muted">${Number(metric.sent || 0)} נשלחו</span></li>`; }).join("")}</ol>`;
    $("#open-library").addEventListener("click", () => showView("library"));
  }

  function renderPeople() {
    const query = String($("#people-search")?.value || "").trim().toLowerCase();
    const rows = (state.audience?.messages || []).filter((row) => `${row.recipient} ${row.flowName} ${row.subject}`.toLowerCase().includes(query));
    $("#people-table").innerHTML = rows.length ? rows.map((row) => {
      const signals = [`<span class="signal ok">נשלח</span>`];
      if (row.openedAt) signals.push(`<span class="signal neutral">נפתח</span>`);
      if (row.providerClickedAt || row.firstPartyClickedAt) signals.push(`<span class="signal ok">נלחץ</span>`);
      const next = row.nextScheduledAt ? `מייל נוסף מתוכנן: ${formatDate(row.nextScheduledAt)}` : "אין מייל מתוזמן נוסף כרגע";
      return `<tr><td class="person-cell"><strong>${safe(row.recipient)}</strong>${row.firstName ? `<br><span class="muted">${safe(row.firstName)}</span>` : ""}</td><td><strong>${safe(row.flowName)}</strong><br><span class="muted">#${Number(row.emailNumber)} · ${safe(row.emailTitle)}</span></td><td>${formatDate(row.sentAt)}</td><td>${signals.join("")}</td><td class="muted">${safe(next)}</td></tr>`;
    }).join("") : `<tr><td colspan="5" class="muted">לא נמצאו מיילים לפי החיפוש.</td></tr>`;
  }

  function renderLibrary() {
    const flow = getFlow(); if (!flow) return;
    $("#library-title").textContent = `ספריית המיילים · ${flow.name}`;
    $("#library-body").innerHTML = `<p class="section-intro">כאן רואים את התכנון והביצועים של ה־Flow הנבחר — לא את כל 39 המיילים יחד.</p><div class="table-wrap"><table class="table"><thead><tr><th>שלב</th><th>נושא</th><th>תזמון</th><th>נשלח / נמסר</th><th>פתיחה / קליק</th><th></th></tr></thead><tbody>${(flow.emails || []).map((email) => { const m = email.metrics || {}; return `<tr><td><strong>#${Number(email.number)}</strong><br><span class="muted">${safe(email.title || "")}</span></td><td>${safe(email.subject || "—")}</td><td>${safe(email.timing || "—")}</td><td>${Number(m.sent || 0)} / ${Number(m.delivered || 0)}</td><td>${Number(m.opened || 0)} / ${Number(m.firstPartyClicked || 0)}</td><td>${email.templateUrl ? `<a href="${safe(email.templateUrl)}" target="_blank" rel="noopener noreferrer">Template</a>` : "—"}</td></tr>`; }).join("")}</tbody></table></div>`;
  }

  function renderHealth() {
    const health = state.health || {}; const lifecycle = health.lifecycle || {}; const tracking = state.audience?.contactTracking || {};
    const good = health.status === "ok";
    $("#health-summary").className = `notice ${good ? "notice-good" : "notice-warn"}`;
    $("#health-summary").innerHTML = good ? `<strong>המערכת פעילה.</strong> סנכרון Shopify אחרון: ${safe(health.shopify?.lastSync || "—")} · נשלחו ב־24 השעות האחרונות: ${Number(lifecycle.emailsSentLast24h || 0)} · Recoveries: ${Number(lifecycle.recoveriesLast24h || 0)}.` : `<strong>נדרשת בדיקה.</strong> מצב Worker: ${safe(health.status || "לא ידוע")}.`;
    $("#health-status").textContent = String(health.status || "unknown").toUpperCase();
    $("#health-body").innerHTML = `<div class="flow-detail-meta"><div><b>Worker</b><span class="muted">${health.workerAlive ? "פועל" : "לא זמין"}</span></div><div><b>Shopify sync אחרון</b><span class="muted">${safe(health.shopify?.lastSync || "—")}</span></div><div><b>אירוע Resend אחרון</b><span class="muted">${safe(health.resend?.lastEvent || "—")}</span></div></div>`;
    $("#tracking-body").innerHTML = `<p><strong>לא — כרגע אין “tags” או custom properties שנכתבים ל־Resend כשנמענת פותחת או לוחצת.</strong> המקור המהימן הוא ${safe(tracking.sourceOfTruth || "D1")}. פתיחה וקליק מגיעים מ־${safe(tracking.openSignal || "Resend")}, ונשמרים במסך האנשים ובדוחות.</p><p>מה כן מסתנכרן ל־Resend: <strong>unsubscribe, hard bounce, complaint ו‑suppression</strong> — כך שנמענת לא ממשיכה לקבל מיילים שיווקיים כאשר אסור לשלוח לה. Contact tags/properties מסומנים כרגע כ־${safe(tracking.resendContactTags || "not configured")}; זה לא חוסם את ה־Flows או את המדידה, אבל אפשר להוסיף בשלב הבא שכבת סגמנטציה ל־Resend אם תהיה לה תועלת ברורה.</p>`;
  }

  async function load() {
    $("#lifecycle-status").textContent = "טוען…";
    try {
      const from = state.currentDays === "all" ? "" : `?from=${encodeURIComponent(new Date(Date.now() - Number(state.currentDays) * 86400000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`;
      const [flows, analytics, audience, health] = await Promise.all([API.get("/api/lifecycle/admin/flows"), API.get(`/api/lifecycle/admin/analytics${from}`), API.get("/api/lifecycle/admin/audience?limit=100"), API.get("/api/lifecycle/admin/health")]);
      if (!flows.ok || !analytics.ok || !audience.ok) throw new Error("Lifecycle data is unavailable");
      state.analytics = analytics; state.audience = audience; state.health = health;
      $("#range-badge").textContent = state.currentDays === "all" ? "כל הנתונים הזמינים" : `${state.currentDays} הימים האחרונים`;
      renderOverview(); renderFlowDetail(); renderPeople(); renderLibrary(); renderHealth();
      $("#lifecycle-status").textContent = `עודכן ${new Date().toLocaleTimeString("he-IL")}`;
    } catch (error) { $("#lifecycle-status").textContent = `טעינה נכשלה: ${error.message}`; }
  }

  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelectorAll("#range-buttons button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("#range-buttons button").forEach((item) => item.classList.remove("btn-primary", "active")); button.classList.add("btn-primary", "active"); state.currentDays = button.dataset.days; load(); }));
  $("#btn-refresh").addEventListener("click", load);
  $("#people-search").addEventListener("input", renderPeople);
  load();
});
