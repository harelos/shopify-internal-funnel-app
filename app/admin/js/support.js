(() => {
  const els = {
    error: document.getElementById("support-error"),
    sync: document.getElementById("btn-sync"),
    threads: document.getElementById("thread-list"),
    detail: document.getElementById("thread-detail"),
    count: document.getElementById("thread-count"),
    statThreads: document.getElementById("stat-threads"),
    statHuman: document.getElementById("stat-human"),
    statSource: document.getElementById("stat-source"),
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

  function showError(message) {
    els.error.textContent = message || "Something went wrong";
    els.error.style.display = "block";
  }

  function clearError() {
    els.error.textContent = "";
    els.error.style.display = "none";
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
    els.statSource.textContent = String(status.syncSource || "—").toUpperCase();
    els.sync.disabled = !status.stagingEnabled;
    els.sync.title = status.stagingEnabled ? "" : "Set SUPPORT_STAGING_ENABLED=true first";
    els.boundary.textContent = status.boundary || "READ ONLY";
    els.boundary.className = "support-badge safe";
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
      empty.textContent = "No support data yet. Enable staging and sync fixtures.";
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

  async function selectThread(id, reloadList = true) {
    clearError();
    selectedThreadId = id;
    try {
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

      els.detail.append(heading, meta, summary, boundary);
      for (const message of thread.messages || []) els.detail.appendChild(renderMessage(message));

      if (reloadList) await loadThreads();
    } catch (error) {
      showError(error.message);
    }
  }

  async function sync() {
    clearError();
    els.sync.disabled = true;
    const oldText = els.sync.textContent;
    els.sync.textContent = "Syncing…";
    try {
      const result = await API.post("/api/support/sync", {});
      els.sync.textContent = `Synced ${result.threads} threads`;
      await Promise.all([loadOverview(), loadThreads()]);
      window.setTimeout(() => { els.sync.textContent = oldText; els.sync.disabled = false; }, 1200);
    } catch (error) {
      showError(error.message);
      els.sync.textContent = oldText;
      els.sync.disabled = false;
    }
  }

  els.sync.addEventListener("click", sync);

  Promise.all([loadStatus(), loadOverview(), loadThreads()]).catch((error) => showError(error.message));
})();
