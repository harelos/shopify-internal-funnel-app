(() => {
  const state = { status: "ALL", conversations: [], selectedId: null, mailbox: null };
  const list = document.getElementById("conversation-list");
  const panel = document.getElementById("conversation-panel");
  const workspace = document.querySelector(".support-workspace");
  const toast = document.getElementById("toast");

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function when(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en-IL", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" }).format(new Date(value));
  }

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  async function overview() {
    const data = await API.get("/api/support/overview");
    document.getElementById("count-open").textContent = data.counts.open;
    document.getElementById("count-review").textContent = data.counts.pendingReview;
    document.getElementById("count-escalated").textContent = data.counts.escalated;
    document.getElementById("count-learned").textContent = data.counts.learnedReplies;
    state.mailbox = data.mailboxes[0] || null;
    const status = document.getElementById("mailbox-status");
    if (!state.mailbox) {
      status.textContent = "Connected in Codex · waiting for first mailbox sync";
      document.getElementById("save-settings").disabled = true;
      return;
    }
    status.textContent = `${state.mailbox.address} · ${state.mailbox.connectionStatus.toLowerCase()} · last sync ${when(state.mailbox.lastSyncAt)}`;
    const lastRun = state.mailbox.lastAgentRunAt ? new Date(state.mailbox.lastAgentRunAt).getTime() : 0;
    const recent = Date.now() - lastRun < 6 * 60 * 1000;
    const failed = state.mailbox.connectionStatus === "ERROR";
    const dot = document.getElementById("agent-dot");
    dot.classList.toggle("agent-offline", !recent || failed);
    document.getElementById("agent-detail").textContent = failed
      ? `Agent needs attention · ${state.mailbox.lastError || "last run failed"}`
      : recent
        ? `Agent active · last check ${when(state.mailbox.lastAgentRunAt)} · next ${when(state.mailbox.nextAgentRunAt)} · ${state.mailbox.ignoredMessageCount || 0} unrelated messages filtered in the last scan`
        : "Agent is configured but has not checked in during the last 6 minutes.";
    document.getElementById("automation-mode").value = state.mailbox.automationMode;
    document.getElementById("reply-delay").value = String(state.mailbox.replyDelayMinutes);
  }

  function renderList() {
    if (!state.conversations.length) {
      list.innerHTML = '<div class="support-empty"><strong>Inbox is ready.</strong><br>No conversations have been synced yet.</div>';
      return;
    }
    list.innerHTML = state.conversations.map(row => {
      const last = row.messages?.[0];
      const initials = (row.customer?.displayName || row.customer?.email || "C").slice(0, 1).toUpperCase();
      return `<button class="conversation-row ${row.id === state.selectedId ? "active" : ""}" data-id="${esc(row.id)}">
        <span class="conversation-avatar">${esc(initials)}</span>
        <span class="conversation-copy">
          <span class="conversation-name">${esc(row.customer?.displayName || row.customer?.email)}</span>
          <span class="conversation-subject">${esc(row.subject)}</span>
          <span class="conversation-preview">${esc(last?.textBody || "No message preview")}</span>
        </span>
        <span class="conversation-meta">${esc(when(row.updatedAt))}<span class="status-pill ${row.status.toLowerCase()}">${esc(row.status.replaceAll("_", " "))}</span></span>
      </button>`;
    }).join("");
    list.querySelectorAll("[data-id]").forEach(button => button.addEventListener("click", () => selectConversation(button.dataset.id)));
  }

  async function conversations() {
    const suffix = state.status === "ALL" ? "" : `?status=${encodeURIComponent(state.status)}`;
    const data = await API.get(`/api/support/conversations${suffix}`);
    state.conversations = data.conversations;
    renderList();
  }

  function latestUsableDraft(row) {
    return row.drafts.find(draft => ["PENDING_REVIEW", "ESCALATED", "QUEUED_TO_SEND"].includes(draft.status));
  }

  async function selectConversation(id) {
    state.selectedId = id;
    renderList();
    const data = await API.get(`/api/support/conversations/${encodeURIComponent(id)}`);
    const row = data.conversation;
    const draft = latestUsableDraft(row);
    panel.innerHTML = `<header class="conversation-top">
      <div><h2>${esc(row.customer.displayName || row.customer.email)}</h2><p>${esc(row.subject)}</p></div>
      <div class="conversation-badges"><span class="human-badge">${esc(row.audienceType.replaceAll("_", " "))}</span><span class="human-badge">${esc(row.topic.replaceAll("_", " "))}</span><span class="human-badge risk-${row.riskLevel.toLowerCase()}">${esc(row.riskLevel)} risk</span></div>
    </header>
    <section class="context-grid">
      <div class="context-card"><small>Order</small><strong>${esc(row.shopifyOrderName || "Not matched yet")}</strong></div>
      <div class="context-card"><small>Customer history</small><strong>${row.customer.lifetimeOrders == null ? "Checking Shopify" : `${row.customer.lifetimeOrders} orders`}</strong></div>
      <div class="context-card"><small>Decision</small><strong>${esc(row.status.replaceAll("_", " "))}</strong></div>
      <div class="context-card"><small>Confidence</small><strong>${Math.round((row.confidence || 0) * 100)}%</strong></div>
    </section>
    ${row.triageStatus === "NEEDS_REVIEW" ? `<section class="triage-notice"><strong>Needs inbox triage</strong><span>${esc(row.triageReason || "This message did not contain enough support signals for automatic handling.")}</span></section>` : ""}
    <section class="message-thread">${row.messages.map(message => `<article class="message ${message.direction.toLowerCase()}"><div class="message-head"><strong>${message.direction === "INBOUND" ? "Customer" : "Tiger Brands"}</strong><span>${esc(when(message.sentAt))}</span></div><div class="message-body">${esc(message.textBody)}</div></article>`).join("")}</section>
    ${draft ? `<section class="draft-card"><div class="draft-head"><div><strong>${draft.status === "ESCALATED" ? "Needs your decision" : "AI reply draft"}</strong><div class="draft-reason">${esc(draft.reason)} · ${Math.round(draft.confidence * 100)}% confidence</div></div></div><textarea id="reply-text" ${draft.status === "QUEUED_TO_SEND" ? "disabled" : ""}>${esc(draft.replyText)}</textarea><div class="draft-actions">${draft.status === "QUEUED_TO_SEND" ? '<span class="human-badge">Queued to send</span>' : `<button class="support-button support-button-danger" id="reject-draft">Escalate</button><button class="support-button" id="approve-draft">Approve & send</button>`}</div></section>` : `<section class="draft-card"><div class="draft-head"><div><strong>No draft yet</strong><div class="draft-reason">Generate a grounded reply from this thread and Shopify order data.</div></div></div><div class="draft-actions"><button class="support-button" id="generate-draft">Generate reply</button></div></section>`}`;
    workspace.classList.add("has-selection");
    panel.querySelector(".conversation-top")?.addEventListener("click", event => {
      if (window.innerWidth <= 760 && event.target === event.currentTarget) workspace.classList.remove("has-selection");
    });
    document.getElementById("generate-draft")?.addEventListener("click", () => generateDraft(id));
    document.getElementById("approve-draft")?.addEventListener("click", () => approveDraft(draft.id));
    document.getElementById("reject-draft")?.addEventListener("click", () => rejectDraft(draft.id));
  }

  async function generateDraft(id) {
    const button = document.getElementById("generate-draft");
    button.disabled = true;
    button.textContent = "Checking order & drafting…";
    try { await API.post(`/api/support/conversations/${encodeURIComponent(id)}/draft`, {}); notify("Reply draft created"); await selectConversation(id); await overview(); }
    catch (error) { notify(error.message); button.disabled = false; button.textContent = "Generate reply"; }
  }

  async function approveDraft(id) {
    const replyText = document.getElementById("reply-text").value.trim();
    if (!replyText) return notify("Write a reply before approving it");
    await API.post(`/api/support/drafts/${encodeURIComponent(id)}/approve`, { replyText });
    notify("Reply queued for the Namecheap mail connector");
    await selectConversation(state.selectedId);
    await overview();
  }

  async function rejectDraft(id) {
    await API.post(`/api/support/drafts/${encodeURIComponent(id)}/reject`, { reason: "Escalated by owner from Support Inbox." });
    notify("Conversation kept for human handling");
    await selectConversation(state.selectedId);
    await overview();
  }

  document.querySelectorAll(".support-filters button").forEach(button => button.addEventListener("click", async () => {
    document.querySelectorAll(".support-filters button").forEach(item => item.classList.toggle("active", item === button));
    state.status = button.dataset.status;
    state.selectedId = null;
    workspace.classList.remove("has-selection");
    await conversations();
  }));
  document.getElementById("refresh").addEventListener("click", async () => { await Promise.all([overview(), conversations()]); notify("Inbox refreshed"); });
  document.getElementById("save-settings").addEventListener("click", async () => {
    if (!state.mailbox) return;
    await API.patch(`/api/support/mailboxes/${encodeURIComponent(state.mailbox.id)}`, { automationMode: document.getElementById("automation-mode").value, replyDelayMinutes: Number(document.getElementById("reply-delay").value) });
    notify("Support automation settings saved");
    await overview();
  });

  Promise.all([overview(), conversations()]).catch(error => { list.innerHTML = `<div class="support-empty">${esc(error.message)}</div>`; });
})();
