(() => {
  const state = { status: "ALL", view: "inbox", conversations: [], selectedId: null, mailbox: null, voiceExamples: [] };
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
    document.getElementById("count-sent").textContent = data.counts.sentReplies;
    document.getElementById("count-failed").textContent = data.counts.failedReplies;
    document.getElementById("count-voice-review").textContent = data.counts.voicePendingReview;
    document.getElementById("voice-tab-count").textContent = data.counts.voicePendingReview;
    const failureAlert = document.getElementById("delivery-failure-alert");
    failureAlert.hidden = data.counts.failedReplies === 0;
    document.getElementById("delivery-failure-title").textContent = data.counts.failedReplies === 1
      ? "1 reply needs delivery attention"
      : `${data.counts.failedReplies} replies need delivery attention`;
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

  function percent(value) {
    return `${Math.round(Number(value || 0) * 100)}%`;
  }

  function durationMinutes(value) {
    if (value == null) return "Not enough data";
    const minutes = Math.max(0, Math.round(Number(value)));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }

  function renderPolicy(policy) {
    const groups = [
      ["Automatic", "Only after factual checks pass", policy.automatic || [], "safe"],
      ["Needs review", "The AI may draft, but cannot send", policy.reviewRequired || [], "review"],
      ["Always escalated", "A person must make the decision", policy.alwaysEscalate || [], "blocked"],
    ];
    document.getElementById("support-policy-grid").innerHTML = groups.map(([title, note, items, tone]) => `<article class="policy-column ${tone}"><strong>${esc(title)}</strong><span>${esc(note)}</span><ul>${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul></article>`).join("");
  }

  function renderVoiceExamples() {
    const container = document.getElementById("voice-example-list");
    document.getElementById("pending-voice-count").textContent = `${state.voiceExamples.length} pending`;
    if (!state.voiceExamples.length) {
      container.innerHTML = '<div class="support-empty"><strong>You are caught up.</strong><br>No reply examples are waiting for review.</div>';
      return;
    }
    container.innerHTML = state.voiceExamples.map(example => `<article class="voice-example" data-example-id="${esc(example.id)}">
      <div class="voice-example-meta"><span class="human-badge">${esc(example.topic.replaceAll("_", " "))}</span><span>${esc(when(example.createdAt))}</span></div>
      <div class="voice-pair"><div><small>Customer asked</small><p dir="auto">${esc(example.customerMessage)}</p></div><div><small>You replied</small><p dir="auto">${esc(example.ownerReply)}</p></div></div>
      <div class="voice-actions"><button class="support-button support-button-danger" data-voice-action="REJECTED">Do not learn this</button><button class="support-button" data-voice-action="APPROVED">Approve as an example</button></div>
    </article>`).join("");
  }

  async function learning() {
    const [knowledge, examples] = await Promise.all([
      API.get("/api/support/knowledge"),
      API.get("/api/support/voice-examples?status=PENDING_REVIEW"),
    ]);
    state.voiceExamples = examples.examples || [];
    document.getElementById("approved-voice-count").textContent = knowledge.voice.approved;
    document.getElementById("knowledge-fact-count").textContent = `${knowledge.approvedStoreFacts.length} facts`;
    document.getElementById("knowledge-list").innerHTML = knowledge.approvedStoreFacts.map(fact => `<li>${esc(fact)}</li>`).join("");
    renderPolicy(knowledge.policy);
    renderVoiceExamples();
  }

  async function quality() {
    const days = document.getElementById("quality-range").value;
    const data = await API.get(`/api/support/analytics?days=${encodeURIComponent(days)}`);
    const metrics = data.metrics;
    document.getElementById("quality-conversations").textContent = metrics.conversations;
    document.getElementById("quality-response").textContent = durationMinutes(metrics.medianFirstResponseMinutes);
    document.getElementById("quality-escalation").textContent = percent(metrics.escalationRate);
    document.getElementById("quality-repeat").textContent = metrics.repeatCustomers;
    document.getElementById("quality-ai-sent").textContent = metrics.aiRepliesSent;
    document.getElementById("quality-auto-sent").textContent = metrics.automaticAiRepliesSent;
    document.getElementById("quality-owner-sent").textContent = metrics.ownerApprovedAiRepliesSent;
    document.getElementById("quality-agent-sent").textContent = metrics.agentApprovedAiRepliesSent;
    document.getElementById("quality-failed").textContent = metrics.deliveryFailures;
    document.getElementById("quality-delivery").textContent = metrics.verifiedSentCopies;
    document.getElementById("quality-coverage").textContent = data.quality.coverage === "COMPLETE_FOR_RANGE" ? "Complete range" : "First 500 threads";
    document.getElementById("quality-source").textContent = data.quality.source;
    document.getElementById("quality-note").textContent = data.quality.note;
    const topics = document.getElementById("quality-topics");
    topics.innerHTML = data.topTopics.length ? data.topTopics.map(row => `<div class="topic-row"><strong>${esc(row.topic.replaceAll("_", " "))}</strong><div class="topic-bar" aria-label="${esc(percent(row.share))} of conversations"><span style="width:${Math.max(4, Math.round(row.share * 100))}%"></span></div><small>${row.count}</small></div>`).join("") : '<div class="support-empty">No inbound support topics were recorded in this range.</div>';
  }

  async function reviewVoiceExample(id, qualityStatus) {
    await API.patch(`/api/support/voice-examples/${encodeURIComponent(id)}`, { qualityStatus });
    state.voiceExamples = state.voiceExamples.filter(example => example.id !== id);
    renderVoiceExamples();
    await overview();
    document.getElementById("approved-voice-count").textContent = Number(document.getElementById("approved-voice-count").textContent || 0) + (qualityStatus === "APPROVED" ? 1 : 0);
    notify(qualityStatus === "APPROVED" ? "Reply approved for future AI drafts" : "Reply excluded from AI learning");
  }

  async function setView(view) {
    state.view = view;
    document.querySelectorAll(".support-view-tabs button").forEach(button => button.classList.toggle("active", button.dataset.view === view));
    document.getElementById("inbox-view").hidden = view !== "inbox";
    document.getElementById("learning-view").hidden = view !== "learning";
    document.getElementById("quality-view").hidden = view !== "quality";
    if (view === "learning") await learning();
    if (view === "quality") await quality();
  }

  async function deliverability() {
    const container = document.getElementById("delivery-health");
    const title = document.getElementById("delivery-health-title");
    const summary = document.getElementById("delivery-health-summary");
    const checks = document.getElementById("delivery-checks");
    try {
      const data = await API.get("/api/support/deliverability");
      const report = data.deliverability;
      container.classList.toggle("needs-attention", report.status !== "HEALTHY");
      title.textContent = report.status === "HEALTHY" ? "Sender authentication is healthy" : "Sender authentication needs attention";
      summary.textContent = report.summary;
      checks.innerHTML = report.checks.map(check => `<div class="delivery-check ${esc(check.status.toLowerCase())}" title="${esc(check.detail)}"><strong>${esc(check.key)} · ${esc(check.status === "PASS" ? "Ready" : check.status === "WARN" ? "Review" : "Fix")}</strong><span>${esc(check.detail)}</span></div>`).join("");
    } catch (error) {
      container.classList.add("needs-attention");
      title.textContent = "Delivery check is temporarily unavailable";
      summary.textContent = error.message;
      checks.innerHTML = "";
    }
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

  function renderDraft(row, draft) {
    if (!draft) return `<section class="draft-card"><div class="draft-head"><div><strong>No draft yet</strong><div class="draft-reason">Generate a grounded reply from this thread and Shopify order data.</div></div></div><div class="draft-actions"><button class="support-button" id="generate-draft">Generate reply</button></div></section>`;
    const sentCopyVerified = row.evidence?.some(event => event.kind === "OUTBOUND_DELIVERY_VERIFIED");
    if (draft.status === "SENT") {
      return `<section class="draft-card"><div class="draft-head"><div><strong>AI reply sent</strong><div class="draft-reason">${esc(when(draft.sentAt))}</div></div></div><div class="draft-receipt"><strong>${sentCopyVerified ? "SMTP accepted · Sent-folder copy verified" : "SMTP accepted by Namecheap"}</strong><span>${sentCopyVerified ? "The exact message is recorded in the mailbox Sent folder and in the support evidence ledger. Recipient inbox placement is controlled by the receiving provider." : "This earlier reply was accepted by Namecheap. Sent-folder verification was not recorded for this historical send."}</span></div></section>`;
    }
    const queued = ["QUEUED_TO_SEND", "SENDING"].includes(draft.status);
    const failed = draft.status === "FAILED";
    return `<section class="draft-card ${failed ? "delivery-failed" : ""}"><div class="draft-head"><div><strong>${failed ? "Delivery failed" : draft.status === "ESCALATED" ? "Needs your decision" : "AI reply draft"}</strong><div class="draft-reason">${esc(failed ? (draft.lastDeliveryError || draft.reason) : draft.reason)} · ${Math.round(draft.confidence * 100)}% confidence</div></div></div><textarea id="reply-text" ${queued ? "disabled" : ""}>${esc(draft.replyText)}</textarea><div class="draft-actions">${queued ? '<span class="human-badge">Queued for the Namecheap connector</span>' : `<button class="support-button support-button-danger" id="reject-draft">Escalate</button><button class="support-button" id="approve-draft">${failed ? "Retry sending" : "Approve & send"}</button>`}</div></section>`;
  }

  async function selectConversation(id) {
    state.selectedId = id;
    renderList();
    const data = await API.get(`/api/support/conversations/${encodeURIComponent(id)}`);
    const row = data.conversation;
    const draft = row.drafts[0] || null;
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
    <section class="message-thread">${row.messages.map(message => `<article class="message ${message.direction.toLowerCase()}"><div class="message-head"><strong>${message.direction === "INBOUND" ? "Customer" : "Tiger Brands"}${message.direction === "OUTBOUND" ? `<span class="delivery-state">${esc(message.deliveryStatus === "SENT_COPY_VERIFIED" ? "Sent copy verified" : "Sent")}</span>` : ""}</strong><span>${esc(when(message.sentAt))}</span></div><div class="message-body">${esc(message.textBody)}</div></article>`).join("")}</section>
    ${renderDraft(row, draft)}`;
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

  async function applyStatusFilter(button) {
    document.querySelectorAll(".support-filters button").forEach(item => item.classList.toggle("active", item === button));
    state.status = button.dataset.status;
    state.selectedId = null;
    workspace.classList.remove("has-selection");
    await setView("inbox");
    await conversations();
  }

  document.querySelectorAll(".support-filters button").forEach(button => button.addEventListener("click", () => applyStatusFilter(button)));
  document.getElementById("show-delivery-failures").addEventListener("click", () => applyStatusFilter(document.querySelector('[data-status="DELIVERY_FAILED"]')));
  document.querySelectorAll(".support-view-tabs button").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
  document.getElementById("voice-example-list").addEventListener("click", event => {
    const action = event.target.closest("[data-voice-action]");
    const row = action?.closest("[data-example-id]");
    if (!action || !row) return;
    action.disabled = true;
    reviewVoiceExample(row.dataset.exampleId, action.dataset.voiceAction).catch(error => { action.disabled = false; notify(error.message); });
  });
  document.getElementById("quality-range").addEventListener("change", () => quality().catch(error => notify(error.message)));
  document.getElementById("refresh").addEventListener("click", async () => { await Promise.all([overview(), conversations(), deliverability(), state.view === "learning" ? learning() : Promise.resolve(), state.view === "quality" ? quality() : Promise.resolve()]); notify("Support workspace refreshed"); });
  document.getElementById("save-settings").addEventListener("click", async () => {
    if (!state.mailbox) return;
    await API.patch(`/api/support/mailboxes/${encodeURIComponent(state.mailbox.id)}`, { automationMode: document.getElementById("automation-mode").value, replyDelayMinutes: Number(document.getElementById("reply-delay").value) });
    notify("Support automation settings saved");
    await overview();
  });

  Promise.all([overview(), conversations(), deliverability()]).catch(error => { list.innerHTML = `<div class="support-empty">${esc(error.message)}</div>`; });
})();
