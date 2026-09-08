document.addEventListener("DOMContentLoaded", () => {
  const currencyFormatters = new Map();
  const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const dateTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  let journeys = [];
  let selectedId = null;
  let activeDays = 1;

  const byId = id => document.getElementById(id);
  const setText = (id, value) => { const node = byId(id); if (node) node.textContent = value; };
  const money = (value, currency = "ILS") => {
    if (!currencyFormatters.has(currency)) {
      currencyFormatters.set(currency, new Intl.NumberFormat("he-IL", { style: "currency", currency, maximumFractionDigits: 2 }));
    }
    return currencyFormatters.get(currency).format(Number(value || 0));
  };

  function timezoneParts(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  }

  function localMidnightUtc(parts) {
    const expected = Date.UTC(parts.year, parts.month - 1, parts.day);
    let timestamp = expected;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const represented = timezoneParts(new Date(timestamp));
      const representedTimestamp = Date.UTC(represented.year, represented.month - 1, represented.day, represented.hour, represented.minute, represented.second);
      timestamp -= representedTimestamp - expected;
    }
    return new Date(timestamp);
  }

  function reportRange(days) {
    const now = new Date();
    const local = timezoneParts(now);
    const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
    localDate.setUTCDate(localDate.getUTCDate() - Math.max(0, days - 1));
    return {
      from: localMidnightUtc({ year: localDate.getUTCFullYear(), month: localDate.getUTCMonth() + 1, day: localDate.getUTCDate() }).toISOString(),
      to: now.toISOString(),
    };
  }

  function statusLabel(status) {
    return status === "VERIFIED" ? "Verified" : status === "PARTIAL" ? "Partial" : "Unattributed";
  }

  function durationLabel(minutes) {
    if (!Number.isFinite(minutes)) return "Not available";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function renderList(filter = "") {
    const needle = filter.trim().toLowerCase();
    const visible = journeys.filter(journey => !needle || journey.orderNumber.toLowerCase().includes(needle) || journey.channel.toLowerCase().includes(needle));
    const list = byId("journey-list");
    if (!visible.length) {
      list.innerHTML = '<div class="journey-no-results">No paid orders match this view.</div>';
      return;
    }
    list.innerHTML = visible.map(journey => `<button class="journey-item ${journey.id === selectedId ? "active" : ""}" type="button" data-journey-id="${escapeHtml(journey.id)}">
      <span class="journey-item-top"><strong>${escapeHtml(journey.orderNumber)}</strong><span class="journey-item-revenue">${money(journey.revenue, journey.currency)}</span></span>
      <span class="journey-item-bottom"><span>${escapeHtml(journey.channel)}</span><span class="journey-status ${journey.status.toLowerCase()}">${statusLabel(journey.status)}</span></span>
    </button>`).join("");
    list.querySelectorAll("[data-journey-id]").forEach(button => button.addEventListener("click", () => selectJourney(button.dataset.journeyId)));
  }

  function renderTimeline(journey) {
    if (journey.status === "UNATTRIBUTED") {
      return `<div class="journey-missing"><strong>No verified browser identity survived for this historical order.</strong><br>The purchase remains in Shopify revenue, but no page, ad, experiment, or assistant touchpoint is guessed.</div>`;
    }
    const timeline = journey.timeline || [];
    return `<div class="journey-timeline">${timeline.map(entry => `<div class="timeline-entry ${escapeHtml(entry.category)}">
      <div class="timeline-copy"><strong>${escapeHtml(entry.label)}</strong>${entry.detail ? `<span>${escapeHtml(entry.detail)}</span>` : ""}</div>
      <time class="timeline-time" datetime="${escapeHtml(entry.at)}">${dateTime.format(new Date(entry.at))}</time>
      ${entry.page ? `<span class="timeline-page">${escapeHtml(entry.page)}</span>` : ""}
    </div>`).join("")}</div>`;
  }

  function selectJourney(id) {
    selectedId = id;
    renderList(byId("journey-search")?.value || "");
    const journey = journeys.find(item => item.id === id);
    if (!journey) return;
    const detail = byId("journey-detail");
    const assignment = journey.experimentAssignments?.[0];
    detail.innerHTML = `<header class="journey-detail-header">
      <div><p class="eyebrow">${statusLabel(journey.status)} JOURNEY</p><h2>${escapeHtml(journey.orderNumber)}</h2><p>${escapeHtml(journey.channel)} · ${escapeHtml(journey.device)}</p></div>
      <div class="journey-price"><strong>${money(journey.revenue, journey.currency)}</strong><span>Net Shopify revenue</span></div>
    </header>
    <div class="journey-facts">
      <div class="journey-fact"><span>First touch</span><strong>${escapeHtml(journey.channel)}</strong></div>
      <div class="journey-fact"><span>Last touch</span><strong>${escapeHtml(journey.lastTouchChannel)}</strong></div>
      <div class="journey-fact"><span>Time to purchase</span><strong>${durationLabel(journey.durationMinutes)}</strong></div>
      <div class="journey-fact"><span>Experiment</span><strong>${assignment ? escapeHtml(assignment.variant) : "No verified assignment"}</strong></div>
    </div>
    <div class="timeline-heading"><h3>Purchase path</h3><span>${integer.format(journey.touchpoints || 0)} verified touchpoints</span></div>
    ${renderTimeline(journey)}`;
  }

  async function loadConnection() {
    const pill = byId("journey-connection");
    try {
      const status = await API.get("/api/shopify/status");
      const connected = Boolean(status.ok);
      pill.className = `connection-pill ${connected ? "connected" : "error"}`;
      pill.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${connected ? "Shopify connected" : "Shopify needs attention"}`;
    } catch {
      pill.className = "connection-pill error";
      pill.innerHTML = '<span class="status-dot" aria-hidden="true"></span>Connection unavailable';
    }
  }

  async function loadJourneys(days) {
    activeDays = days;
    document.querySelectorAll(".range-button").forEach(button => button.classList.toggle("active", Number(button.dataset.days) === days));
    const notice = byId("journey-notice");
    notice.className = "journey-notice";
    notice.innerHTML = `<strong>Building verified journeys…</strong><span>${days === 1 ? "Today" : `Last ${days} days`} in Israel time.</span>`;
    const range = reportRange(days);
    try {
      const data = await API.get(`/api/journeys?${new URLSearchParams(range).toString()}`);
      journeys = data.journeys || [];
      const summary = data.summary || {};
      setText("journey-orders", integer.format(Number(summary.orders || 0)));
      setText("journey-verified", integer.format(Number(summary.verified || 0)));
      setText("journey-unattributed", integer.format(Number(summary.unattributed || 0)));
      setText("journey-revenue", summary.currency ? money(summary.totalRevenue, summary.currency) : "Mixed");
      notice.innerHTML = `<strong>${integer.format(Number(summary.verified || 0))} of ${integer.format(Number(summary.orders || 0))} purchases have a verified path</strong><span>Missing identity is clearly marked, never inferred.</span>`;
      selectedId = journeys[0]?.id || null;
      renderList(byId("journey-search")?.value || "");
      if (selectedId) selectJourney(selectedId);
      else byId("journey-detail").innerHTML = '<div class="journey-empty"><p class="eyebrow">NO PURCHASES</p><h2>No paid orders in this range</h2><p>Choose a wider period to inspect earlier journeys.</p></div>';
    } catch (error) {
      journeys = [];
      notice.className = "journey-notice warning";
      notice.innerHTML = `<strong>Journey data could not be loaded</strong><span>${escapeHtml(error.message || "Try again shortly.")}</span>`;
      renderList();
    }
  }

  byId("journey-search")?.addEventListener("input", event => renderList(event.target.value));
  document.querySelectorAll(".range-button").forEach(button => button.addEventListener("click", () => loadJourneys(Number(button.dataset.days || 1))));
  loadConnection();
  loadJourneys(activeDays);
});
