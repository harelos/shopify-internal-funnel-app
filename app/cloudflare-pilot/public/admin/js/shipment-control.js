document.addEventListener("DOMContentLoaded", () => {
  const byId = id => document.getElementById(id);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  let payload = null;
  let view = "ACTIONABLE";
  let severity = "";
  let contact = "";

  function displayTime(value, fallback = "No verified run yet") {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : time.format(date);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function humanState(value) {
    const labels = {
      NEW: "New",
      ACKNOWLEDGED: "Acknowledged",
      ASSIGNED: "Assigned to you",
      WAITING_FOR_CJ: "Waiting for CJ",
      CUSTOMER_UPDATED: "Customer updated",
      RESOLVED: "Resolved",
    };
    return labels[value] || String(value || "New").replaceAll("_", " ");
  }

  function orderAdminUrl(order) {
    const gid = String(order.shopifyOrderGid || "");
    const id = gid.split("/").pop();
    return /^\d+$/.test(id) ? `https://admin.shopify.com/store/jacobfelipe/orders/${id}` : "#";
  }

  function actionButtons(order) {
    const buttons = [];
    if (order.workflowState === "NEW") buttons.push(["ACKNOWLEDGED", "Acknowledge", ""]);
    if (!["ASSIGNED", "RESOLVED"].includes(order.workflowState)) buttons.push(["ASSIGNED", "Assign to me", ""]);
    if (String(order.contactTarget).includes("CJ") && order.workflowState !== "WAITING_FOR_CJ") buttons.push(["WAITING_FOR_CJ", "Waiting for CJ", ""]);
    if (String(order.contactTarget).includes("Customer") && order.workflowState !== "CUSTOMER_UPDATED") buttons.push(["CUSTOMER_UPDATED", "Customer updated", ""]);
    if (order.workflowState !== "RESOLVED") buttons.push(["RESOLVED", "Resolve", "resolve"]);
    return buttons.map(([state, label, style]) => `<button class="workflow-button ${style}" type="button" data-order-id="${escapeHtml(order.id)}" data-state="${state}">${label}</button>`).join("");
  }

  function card(order) {
    const signals = Array.isArray(order.signals) ? order.signals : [];
    const sourceConflict = order.sourceAgreement !== "VERIFIED";
    const statusMeta = [
      order.cjStatus ? `CJ: ${order.cjStatus}` : null,
      order.trackingStatus || null,
      order.orderBusinessDays ? `${order.orderBusinessDays} business days` : null,
    ].filter(Boolean).join(" · ");
    const signalPills = signals.slice(1, 4).map(signal => `<span class="signal-pill">${escapeHtml(signal.label)}</span>`).join("");
    const multiSale = order.afterSellLikely ? `<span class="signal-pill">${escapeHtml(order.saleTransactionCount)} successful charges · check AfterSell</span>` : "";
    return `<article class="shipment-card" data-severity="${escapeHtml(order.severity)}">
      <div class="shipment-order">
        <a href="${orderAdminUrl(order)}" target="_top" rel="noopener"><strong>${escapeHtml(order.orderName)}</strong></a>
        <span class="priority-pill">${escapeHtml(order.severity === "MONITORING" ? "Monitoring" : order.severity)}</span>
        <span class="source-pill ${sourceConflict ? "conflict" : ""}">${sourceConflict ? "Source conflict" : "Verified by Shopify + CJ"}</span>
      </div>
      <div class="shipment-status">
        <h3>${escapeHtml(order.statusLabel)}</h3>
        <p>${escapeHtml(statusMeta || "Waiting for the next verified milestone")}</p>
        <div class="signal-row">${multiSale}${signalPills}</div>
      </div>
      <div class="shipment-action">
        <h3>${escapeHtml(order.doNow)}</h3>
        <p>Human approval remains required for messages, refunds, cancellations, and CJ payment.</p>
        <span class="contact-line">Contact: ${escapeHtml(order.contactTarget)}</span>
      </div>
      <div class="shipment-workflow">
        <span class="workflow-pill">${escapeHtml(humanState(order.workflowState))}</span>
        <div class="workflow-actions">${actionButtons(order)}</div>
      </div>
    </article>`;
  }

  function filteredOrders() {
    const query = byId("shipment-search").value.trim().replace(/^#/, "");
    return (payload?.orders || []).filter(order => {
      if (view === "ACTIONABLE" && (!order.isActionable || order.workflowState === "RESOLVED")) return false;
      if (view === "RESOLVED" && order.workflowState !== "RESOLVED") return false;
      if (severity && order.severity !== severity) return false;
      if (contact && !String(order.contactTarget).includes(contact)) return false;
      if (query && !String(order.orderName).includes(query)) return false;
      return true;
    });
  }

  function renderList() {
    const orders = filteredOrders();
    const list = byId("shipment-list");
    if (!orders.length) {
      list.innerHTML = `<div class="empty-queue"><strong>No orders match this view.</strong>Try another filter or refresh the latest provider snapshot.</div>`;
      return;
    }
    list.innerHTML = orders.map(card).join("");
  }

  function renderHeader(data) {
    const summary = data.summary || {};
    byId("count-critical").textContent = summary.critical || 0;
    byId("count-cj").textContent = summary.contactCj || 0;
    byId("count-customer").textContent = summary.updateCustomer || 0;
    byId("count-monitoring").textContent = summary.monitoring || 0;
    byId("filter-actionable-count").textContent = summary.actionNow || 0;
    byId("hero-sync-time").textContent = displayTime(data.latestRun?.receivedAt);
    const hero = byId("shipment-hero");
    hero.className = `shipment-hero ${summary.critical ? "critical" : summary.actionNow ? "attention" : ""}`.trim();
    byId("hero-kicker").textContent = data.sourceState === "CURRENT" ? "Shopify + CJ are current" : data.sourceState === "PARTIAL" ? "One source needs attention" : "Snapshot needs attention";
    byId("hero-title").textContent = summary.actionNow ? `${summary.actionNow} ${summary.actionNow === 1 ? "order needs" : "orders need"} a decision` : "No verified shipment issue needs action";
    byId("hero-copy").textContent = summary.critical
      ? `${summary.critical} critical ${summary.critical === 1 ? "case is" : "cases are"} at the top. Start there, then move to the CJ and customer queues.`
      : "The queue is based on reconciled payment, fulfillment, risk, and tracking milestones—not public tracking-page guesses.";
    const pill = byId("shipment-source-pill");
    const current = data.sourceState === "CURRENT";
    pill.className = `connection-pill ${current ? "connected" : "error"}`;
    pill.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${current ? "Shopify + CJ current" : "Source attention needed"}`;
  }

  async function refresh() {
    const button = byId("refresh-shipments");
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      payload = await API.get("/api/shipments/dashboard");
      renderHeader(payload);
      renderList();
    } catch (error) {
      byId("shipment-hero").className = "shipment-hero critical";
      byId("hero-kicker").textContent = "Dashboard unavailable";
      byId("hero-title").textContent = "Shipment evidence could not be loaded";
      byId("hero-copy").textContent = error?.message || "Refresh the embedded app and try again.";
      byId("shipment-list").innerHTML = '<div class="empty-queue"><strong>No workflow action was changed.</strong>The reporting endpoint must recover before this queue is reliable.</div>';
    } finally {
      button.disabled = false;
      button.textContent = "Refresh";
    }
  }

  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    view = button.dataset.view;
    document.querySelectorAll("[data-view]").forEach(item => item.classList.toggle("active", item === button));
    renderList();
  }));
  document.querySelectorAll("[data-filter], [data-contact]").forEach(button => button.addEventListener("click", () => {
    severity = button.dataset.filter || "";
    contact = button.dataset.contact || "";
    byId("severity-filter").value = severity;
    view = severity === "MONITORING" ? "ALL" : "ACTIONABLE";
    document.querySelectorAll("[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === view));
    renderList();
    document.querySelector(".shipment-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  byId("severity-filter").addEventListener("change", event => { severity = event.target.value; contact = ""; renderList(); });
  byId("shipment-search").addEventListener("input", renderList);
  byId("refresh-shipments").addEventListener("click", refresh);
  byId("shipment-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-order-id][data-state]");
    if (!button) return;
    button.disabled = true;
    try {
      await API.patch(`/api/shipments/${encodeURIComponent(button.dataset.orderId)}/workflow`, { state: button.dataset.state });
      await refresh();
    } catch (error) {
      button.disabled = false;
      button.textContent = error?.message || "Try again";
    }
  });
  refresh();
});

