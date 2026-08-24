(() => {
  const els = {
    error: document.getElementById("support-error"),
    success: document.getElementById("support-success"),
    sync: document.getElementById("btn-sync"),
    probe: document.getElementById("btn-probe"),
    threads: document.getElementById("thread-list"),
    detail: document.getElementById("thread-detail"),
    count: document.getElementById("thread-count"),
    statThreads: document.getElementById("stat-threads"),
    statHuman: document.getElementById("stat-human"),
    statSource: document.getElementById("stat-source"),
    statMailbox: document.getElementById("stat-mailbox"),
    categories: document.getElementById("category-summary"),
    boundary: document.getElementById("boundary-badge"),
  };

  const categoryLabels = {
    shipping_tracking: "Shipping / tracking",
    product_usage: "Product usage",
    refund_return: "Refund / return",
    address_change: "Address change",
    shade_product_question: "Shade / product question",
    damaged_wrong_item: "Damaged / wrong item",
    order_status: "Order status",
    other: "Other",
  };

  let selectedThreadId = null;
  let supportStatus = null;

  function showError(message) {
    els.success.style.display = "none";
    els.error.textContent = message || "Something went wrong";
    els.error.style.display = "block";
  }

  function showSuccess(message) {
    els.error.style.display = "none";
    els.success.textContent = message || "Done";
    els.success.style.display = "block";
  }

  function clearNotices() {
    els.error.textContent = "";
    els.error.style.display = "none";
    els.success.textContent = "";
    els.success.style.display = "none";
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function badge(text, className = "") {
    const span = document.createElement("span");
    span.className = `support-badge ${className}`.trim();
    span.textContent = text;
    return span;
  }

  async function loadStatus() {
    const status = await API.get("/api/support/status");
    supportStatus = status;
    const source = String(status.syncSource || "—").toUpperCase();
    els.statSource.textContent = source;
    els.boundary.textContent = status.boundary || "READ ONLY";
    els.boundary.className = "support-badge safe";

    if (!status.stagingEnabled) {
      els.statMailbox.textContent = "STAGING OFF";
      els.sync.disabled = true;
      els.probe.disabled = true;
      els.sync.title = "Set SUPPORT_STAGING_ENABLED=true first";
      els.probe.title = "Set SUPPORT_STAGING_ENABLED=true first";
      return status;
    }

    if (status.syncSource === "imap") {
      const ready = Boolean(status.imapReadEnabled && status.imapConfigured);
      els.statMailbox.textContent = ready ? `${status.imapMailbox || "INBOX"} · READY` : "IMAP GATED";
      els.sync.disabled = !ready;
      els.probe.disabled = !ready;
      const reason = !status.imapReadEnabled
        ? "Set SUPPORT_IMAP_READ_ENABLED=true in staging"
        : !status.imapConfigured
          ? "Configure IMAP username/password in the staging secret manager"
          : "";
      els.sync.title = reason;
      els.probe.title = reason;
    } else {
      els.statMailbox.textContent = "FIXTURE READY";
      els.sync.disabled = false;
      els.probe.disabled = false;
      els.sync.title = "";
      els.probe.title = "";
    }

    return status;
  }

  async function loadOverview() {
    const overview = await API.get("/api/support/overview");
    els.statThreads.textContent = overview.totalThreads;
    els.statHuman.textContent = overview.needsHuman;
    els.categories.textContent = "";
    for (const item of overview.categories || []) {
      const label = `${categoryLabels[item.category] || item.category}: ${item.count}`;
      els.categories.appendChild(badge(label));
    }
  }

  function threadButton(thread) {
    const button = document.createElement("button");
    button.className = `support-thread${thread.id === selectedThreadId ? " active" : ""}`;
    button.type = "button";
    button.dataset.threadId = thread.id;

    const title = document.createElement("div");
    title.className = "support-thread-title";
    title.textContent = thread.subject || "(no subject)";

    const meta = document.createElement("div");
    meta.className = "support-thread-meta";
    const category = categoryLabels[thread.category] || thread.category;
    meta.textContent = `${category} · ${thread.messageCount} message${thread.messageCount === 1 ? "" : "s"} · ${formatDate(thread.lastMessageAt)}`;

    const badges = document.createElement("div");
    badges.className = "support-category-row";
    if (thread.requiresHuman) badges.appendChild(badge("Needs human", "danger"));
    if (thread.urgency === "high") badges.appendChild(badge("High urgency", "danger"));
    badges.appendChild(badge(`${Math.round((thread.confidence || 0) * 100)}% classification`));

    const summary = document.createElement("div");
    summary.className = "support-thread-summary";
    summary.textContent = thread.summary || thread.latestMessage?.text || "";

    button.append(title, meta, badges, summary);
    button.addEventListener("click", () => selectThread(thread.id));
    return button;
  }

  async function loadThreads() {
    const data = await API.get("/api/support/threads?limit=100");
    const threads = data.threads || [];
    els.count.textContent = `${threads.length} loaded`;
    els.threads.textContent = "";

    if (threads.length === 0) {
      const empty = document.createElement("div");
      empty.className = "support-empty";
      empty.textContent = "No support data yet. Enable staging and sync the configured inbox.";
      els.threads.appendChild(empty);
      return;
    }

    for (const thread of threads) els.threads.appendChild(threadButton(thread));

    if (!selectedThreadId && threads[0]) {
      await selectThread(threads[0].id, false);
    }
  }

  function renderMessage(message) {
    const card = document.createElement("div");
    card.className = `support-message ${message.direction === "OUTBOUND" ? "outbound" : ""}`.trim();

    const head = document.createElement("div");
    head.className = "support-message-head";

    const sender = document.createElement("span");
    sender.textContent = `${message.direction} · ${message.from}`;
    const time = document.createElement("span");
    time.textContent = formatDate(message.sentAt);
    head.append(sender, time);

    const body = document.createElement("div");
    body.className = "support-message-body";
    body.textContent = message.text || "(empty text body)";

    card.append(head, body);
    return card;
  }

  function renderShopifyOrder(order) {
    const card = document.createElement("div");
    card.className = "support-message";

    const head = document.createElement("div");
    head.className = "support-message-head";
    const title = document.createElement("strong");
    title.textContent = order.name || "Shopify order";
    const date = document.createElement("span");
    date.textContent = formatDate(order.processedAt || order.createdAt);
    head.append(title, date);

    const states = document.createElement("div");
    states.className = "support-category-row";
    if (order.financialStatus) states.appendChild(badge(`Payment: ${order.financialStatus}`));
    if (order.fulfillmentStatus) states.appendChild(badge(`Fulfillment: ${order.fulfillmentStatus}`));
    if (order.cancelledAt) states.appendChild(badge("Cancelled", "danger"));
    if (order.total) states.appendChild(badge(`${order.total.amount} ${order.total.currencyCode}`));

    const items = document.createElement("div");
    items.className = "support-message-body";
    items.style.marginTop = "10px";
    items.textContent = (order.lineItems || []).length
      ? (order.lineItems || []).map((item) => `${item.quantity}× ${item.name}${item.sku ? ` · SKU ${item.sku}` : ""}`).join("\n")
      : "No line items returned.";

    const tracking = document.createElement("div");
    tracking.style.marginTop = "10px";
    const trackingRows = (order.fulfillments || []).flatMap((fulfillment) => fulfillment.tracking || []);
    if (trackingRows.length === 0) {
      tracking.className = "muted";
      tracking.textContent = "No tracking information returned.";
    } else {
      const label = document.createElement("div");
      label.className = "muted";
      label.textContent = "Tracking";
      tracking.appendChild(label);
      for (const item of trackingRows) {
        const row = document.createElement("div");
        row.style.marginTop = "4px";
        const text = [item.company, item.number].filter(Boolean).join(" · ") || "Tracking link";
        if (item.url) {
          const link = document.createElement("a");
          link.href = item.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = text;
          row.appendChild(link);
        } else {
          row.textContent = text;
        }
        tracking.appendChild(row);
      }
    }

    card.append(head, states, items, tracking);
    return card;
  }

  async function loadShopifyContext(threadId, container, button) {
    clearNotices();
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = "Loading Shopify…";
    container.textContent = "";
    try {
      const context = await API.get(`/api/support/threads/${encodeURIComponent(threadId)}/shopify-context`);
      const meta = document.createElement("div");
      meta.className = "support-category-row";
      meta.appendChild(badge("SHOPIFY · READ ONLY", "safe"));
      meta.appendChild(badge(context.matchedEmail || "customer email"));
      container.appendChild(meta);

      if (!(context.orders || []).length) {
        const empty = document.createElement("div");
        empty.className = "support-warning";
        empty.textContent = "No recent Shopify orders were returned for this email.";
        container.appendChild(empty);
      } else {
        for (const order of context.orders) container.appendChild(renderShopifyOrder(order));
      }

      const note = document.createElement("p");
      note.className = "muted";
      note.style.fontSize = "12px";
      note.textContent = context.note || "Read-only Shopify context.";
      container.appendChild(note);
    } catch (error) {
      const errorBox = document.createElement("div");
      errorBox.className = "support-error";
      errorBox.style.display = "block";
      errorBox.textContent = error.message;
      container.appendChild(errorBox);
    } finally {
      button.textContent = oldText;
      button.disabled = !supportStatus?.shopifyLookupEnabled;
    }
  }

  function renderShopifyContextPanel(threadId) {
    const section = document.createElement("section");
    section.style.marginTop = "18px";

    const top = document.createElement("div");
    top.style.display = "flex";
    top.style.justifyContent = "space-between";
    top.style.alignItems = "center";
    top.style.gap = "12px";

    const heading = document.createElement("h3");
    heading.textContent = "Shopify order context";
    heading.style.margin = "0";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = "Load order context";
    button.disabled = !supportStatus?.shopifyLookupEnabled;
    button.title = supportStatus?.shopifyLookupEnabled
      ? "Read-only order lookup"
      : "Set SUPPORT_SHOPIFY_LOOKUP_ENABLED=true in staging";

    const content = document.createElement("div");
    content.style.marginTop = "10px";
    if (!supportStatus?.shopifyLookupEnabled) {
      content.appendChild(badge("SHOPIFY LOOKUP GATED", "warn"));
    }

    button.addEventListener("click", () => loadShopifyContext(threadId, content, button));
    top.append(heading, button);
    section.append(top, content);
    return section;
  }

  async function selectThread(id, reloadList = true) {
    clearNotices();
    selectedThreadId = id;
    try {
      if (!supportStatus) await loadStatus();
      const thread = await API.get(`/api/support/threads/${encodeURIComponent(id)}`);
      els.detail.textContent = "";

      const heading = document.createElement("h2");
      heading.textContent = thread.subject || "(no subject)";

      const meta = document.createElement("div");
      meta.className = "support-category-row";
      meta.appendChild(badge(categoryLabels[thread.category] || thread.category));
      meta.appendChild(badge(`${Math.round((thread.confidence || 0) * 100)}% confidence`));
      if (thread.requiresHuman) meta.appendChild(badge("Human review", "danger"));
      if (thread.urgency === "high") meta.appendChild(badge("High urgency", "danger"));
      meta.appendChild(badge(thread.source || "UNKNOWN"));

      const summary = document.createElement("p");
      summary.className = "muted";
      summary.style.marginTop = "12px";
      summary.textContent = thread.summary || "No summary yet.";

      const boundary = document.createElement("div");
      boundary.className = "support-warning";
      boundary.textContent = "Draft/analysis only. There is intentionally no Send, Refund, Cancel, Reship or Shopify write action on this screen.";

      els.detail.append(heading, meta, summary, boundary, renderShopifyContextPanel(id));
      for (const message of thread.messages || []) els.detail.appendChild(renderMessage(message));

      if (reloadList) await loadThreads();
    } catch (error) {
      showError(error.message);
    }
  }

  async function probe() {
    clearNotices();
    els.probe.disabled = true;
    const oldText = els.probe.textContent;
    els.probe.textContent = "Testing…";
    try {
      const result = await API.post("/api/support/probe", {});
      showSuccess(`${result.source} connection OK · ${result.mailbox} · ${result.messageCount} messages · read only`);
    } catch (error) {
      showError(error.message);
    } finally {
      els.probe.textContent = oldText;
      await loadStatus().catch(() => {});
    }
  }

  async function sync() {
    clearNotices();
    els.sync.disabled = true;
    const oldText = els.sync.textContent;
    els.sync.textContent = "Syncing…";
    try {
      const result = await API.post("/api/support/sync", {});
      showSuccess(`Synced ${result.messages} messages into ${result.threads} reconstructed threads from ${result.source}.`);
      await Promise.all([loadOverview(), loadThreads()]);
    } catch (error) {
      showError(error.message);
    } finally {
      els.sync.textContent = oldText;
      await loadStatus().catch(() => {});
    }
  }

  els.probe.addEventListener("click", probe);
  els.sync.addEventListener("click", sync);

  Promise.all([loadStatus(), loadOverview(), loadThreads()]).catch((error) => showError(error.message));
})();
