document.addEventListener("DOMContentLoaded", () => {
  const createForm = document.getElementById("create-slot-form");
  const slotList = document.getElementById("slot-list");
  const emptyDetail = document.getElementById("empty-detail");
  const detail = document.getElementById("slot-detail");
  const lines = document.getElementById("gallery-lines");
  const initialIndex = document.getElementById("initial-index");
  const showThumbnails = document.getElementById("show-thumbnails");
  const preview = document.getElementById("gallery-preview");
  const variantGrid = document.querySelector(".variant-grid");
  const saveMessage = document.getElementById("save-message");
  const weight = document.getElementById("variant-b-weight");
  const weightLabel = document.getElementById("variant-b-weight-label");
  let slots = [];
  let current = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function parseLines() {
    const items = lines.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
      const parts = line.split("|").map(part => part.trim());
      if (parts.length < 3) throw new Error(`Line ${index + 1} needs id, URL, and alt text.`);
      return { id: parts[0], src: parts[1], alt: parts[2], ...(parts[3] ? { caption: parts.slice(3).join(" | ") } : {}) };
    });
    return {
      preserveExisting: false,
      initialIndex: Math.max(0, Number(initialIndex.value || 1) - 1),
      showThumbnails: showThumbnails.checked,
      items,
    };
  }

  function variantB(slot = current) {
    return slot?.variants?.find(variant => !variant.isControl);
  }

  function latestVersion(variant) {
    return variant?.versions?.slice().sort((left, right) => right.revision - left.revision)[0];
  }

  function linesFromPayload(payload) {
    return (payload?.items || []).map(item => [item.id, item.src, item.alt, item.caption || ""].join(" | ").replace(/\s+\|\s*$/, "")).join("\n");
  }

  function renderPreview() {
    let payload;
    try {
      payload = parseLines();
    } catch (error) {
      preview.innerHTML = `<p class="danger-note">${escapeHtml(error.message)}</p>`;
      return;
    }
    if (!payload.items.length) {
      preview.innerHTML = '<p class="muted" style="padding:40px 12px;text-align:center;">Add image lines to preview Variant B.</p>';
      return;
    }
    const selected = Math.min(payload.items.length - 1, payload.initialIndex);
    const item = payload.items[selected];
    preview.innerHTML = `
      <div class="preview-stage"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}"></div>
      ${item.caption ? `<p style="margin-top:8px;font-size:13px;">${escapeHtml(item.caption)}</p>` : ""}
      ${payload.showThumbnails ? `<div class="preview-thumbs">${payload.items.map((entry, index) => `<button type="button" data-preview-index="${index}" aria-label="Preview image ${index + 1}" style="padding:0;border:0;background:transparent;cursor:pointer;"><img src="${escapeHtml(entry.src)}" alt=""></button>`).join("")}</div>` : ""}
    `;
    preview.querySelectorAll("[data-preview-index]").forEach(button => button.addEventListener("click", () => {
      initialIndex.value = String(Number(button.dataset.previewIndex) + 1);
      renderPreview();
    }));
  }

  function setPreviewDevice(device) {
    const desktop = device === "desktop";
    preview.dataset.device = desktop ? "desktop" : "mobile";
    variantGrid.classList.toggle("preview-desktop", desktop);
    document.getElementById("preview-title").textContent = desktop ? "760px preview" : "390px preview";
    ["mobile", "desktop"].forEach(name => {
      const button = document.getElementById(`preview-${name}`);
      const selected = name === device;
      button.classList.toggle("btn-primary", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function formatMoney(value, currency) {
    if (value === null || value === undefined) return "—";
    try { return new Intl.NumberFormat("he-IL", { style: "currency", currency: currency || "ILS" }).format(value); }
    catch (_) { return `${Number(value).toFixed(2)} ${currency || ""}`.trim(); }
  }

  function formatUplift(value) {
    if (value === null || value === undefined) return "—";
    const sign = value > 0 ? "+" : "";
    const className = value > 0 ? "uplift-positive" : value < 0 ? "uplift-negative" : "";
    return `<span class="${className}">${sign}${Number(value).toFixed(1)}%</span>`;
  }

  async function loadResults() {
    const container = document.getElementById("experiment-results");
    const status = document.getElementById("results-status");
    if (!current?.experiment?.id) return;
    container.innerHTML = '<p class="muted">Loading Shopify-attributed sales…</p>';
    try {
      const results = await API.get(`/api/element-experiments/${current.experiment.id}/results`);
      status.textContent = results.dataStatus.replaceAll("_", " ");
      status.className = `badge ${results.dataStatus === "DIRECTIONAL" ? "badge-active" : "badge-draft"}`;
      const currency = results.currency || "ILS";
      container.innerHTML = `
        ${results.mixedCurrencies ? '<div class="danger-note" style="margin-bottom:12px;">Revenue contains multiple currencies and is shown separately rather than summed.</div>' : ""}
        <div class="results-table-wrap">
          <table class="table">
            <thead><tr><th>Variant</th><th>Exposed visitors</th><th>Checkout sessions</th><th>Checkout CVR</th><th>Paid orders</th><th>Purchase CVR</th><th>Net revenue</th><th>Revenue / visitor</th><th>CVR uplift</th></tr></thead>
            <tbody>${results.variants.map(row => `
              <tr>
                <td><strong>${escapeHtml(row.variantName)}</strong>${row.isControl ? '<br><span class="eyebrow">CONTROL</span>' : ""}</td>
                <td>${row.exposedVisitors}</td><td>${row.checkouts}</td><td>${Number(row.checkoutRate).toFixed(2)}%</td><td>${row.orders}</td>
                <td>${Number(row.conversionRate).toFixed(2)}%</td>
                <td>${results.mixedCurrencies ? Object.entries(row.revenueByCurrency).map(([code, amount]) => formatMoney(amount, code)).join("<br>") || "—" : formatMoney(row.revenue, currency)}</td>
                <td>${formatMoney(row.revenuePerVisitor, currency)}</td>
                <td>${formatUplift(row.conversionUpliftPercent)}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>
        <div class="results-note"><strong>${escapeHtml(results.note)}</strong><br>Test orders and internal Theme Editor exposures are excluded. Refunds and cancellations reduce net revenue.</div>`;
    } catch (error) {
      status.textContent = "ERROR";
      container.innerHTML = `<p class="danger-note">${escapeHtml(error.message)}</p>`;
    }
  }

  function renderList() {
    if (!slots.length) {
      slotList.innerHTML = '<p class="muted">No element slots yet.</p>';
      return;
    }
    slotList.innerHTML = slots.map(slot => `
      <button class="slot-card ${current?.id === slot.id ? "active" : ""}" data-slot-id="${slot.id}">
        <strong>${escapeHtml(slot.name)}</strong><br>
        <span class="eyebrow">${escapeHtml(slot.pagePath)}</span><br>
        <span class="badge ${slot.status === "ACTIVE" ? "badge-active" : "badge-draft"}" style="margin-top:7px;">${escapeHtml(slot.experiment?.status || slot.status)}</span>
      </button>
    `).join("");
    slotList.querySelectorAll("[data-slot-id]").forEach(button => button.addEventListener("click", () => selectSlot(button.dataset.slotId)));
  }

  function renderDetail() {
    if (!current) {
      detail.hidden = true;
      emptyDetail.hidden = false;
      return;
    }
    detail.hidden = false;
    emptyDetail.hidden = true;
    document.getElementById("detail-name").textContent = current.name;
    document.getElementById("detail-path").textContent = `${current.pagePath} · ${current.slotKey}`;
    document.getElementById("detail-selector").textContent = `Integration wrapper: ${current.targetSelector}`;
    const status = current.experiment?.status || current.status;
    const statusNode = document.getElementById("detail-status");
    statusNode.textContent = status;
    statusNode.className = `badge ${status === "RUNNING" ? "badge-active" : "badge-draft"}`;

    const challenger = variantB();
    const latest = latestVersion(challenger);
    lines.value = linesFromPayload(latest?.payload);
    initialIndex.value = String((latest?.payload?.initialIndex ?? 0) + 1);
    showThumbnails.checked = latest?.payload?.showThumbnails !== false;
    const published = challenger?.publishedVersionId && challenger.publishedVersionId === latest?.id;
    const state = document.getElementById("variant-state");
    state.textContent = published ? "PUBLISHED" : "DRAFT";
    state.className = `badge ${published ? "badge-published" : "badge-draft"}`;

    const challengerAllocation = current.experiment?.allocations?.find(allocation => allocation.variantId === challenger?.id);
    const percent = Math.round((challengerAllocation?.weightBasisPoints ?? 5000) / 100);
    weight.value = String(percent);
    weightLabel.textContent = `${percent}%`;
    document.getElementById("save-weights").textContent = `Save ${100 - percent}/${percent} split`;
    document.getElementById("start-experiment").disabled = !["DRAFT", "PAUSED"].includes(status);
    document.getElementById("pause-experiment").disabled = status !== "RUNNING";
    saveMessage.textContent = "";
    renderPreview();
  }

  async function loadSlots(preferredId) {
    slots = await API.get("/api/element-slots");
    if (preferredId) current = slots.find(slot => slot.id === preferredId) || current;
    else if (current) current = slots.find(slot => slot.id === current.id) || null;
    renderList();
    renderDetail();
    if (current) await loadResults();
  }

  function selectSlot(id) {
    current = slots.find(slot => slot.id === id) || null;
    renderList();
    renderDetail();
    loadResults();
  }

  createForm.addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(createForm);
    try {
      const created = await API.post("/api/element-slots", {
        pagePath: form.get("pagePath"),
        slotKey: form.get("slotKey"),
        name: form.get("name"),
      });
      await loadSlots(created.id);
    } catch (error) {
      alert(error.message);
    }
  });

  weight.addEventListener("input", () => {
    const percent = Number(weight.value);
    weightLabel.textContent = `${percent}%`;
    document.getElementById("save-weights").textContent = `Save ${100 - percent}/${percent} split`;
  });

  document.getElementById("preview-variant").addEventListener("click", renderPreview);
  document.getElementById("preview-mobile").addEventListener("click", () => setPreviewDevice("mobile"));
  document.getElementById("preview-desktop").addEventListener("click", () => setPreviewDevice("desktop"));
  document.getElementById("refresh-results").addEventListener("click", loadResults);

  document.getElementById("save-variant").addEventListener("click", async () => {
    try {
      const challenger = variantB();
      if (!challenger) throw new Error("Variant B is missing.");
      await API.put(`/api/element-variants/${challenger.id}/content`, { payload: parseLines() });
      saveMessage.textContent = "Draft saved. It is not live.";
      await loadSlots(current.id);
    } catch (error) {
      saveMessage.textContent = error.message;
    }
  });

  document.getElementById("publish-variant").addEventListener("click", async () => {
    try {
      const challenger = variantB();
      if (!challenger) throw new Error("Variant B is missing.");
      await API.put(`/api/element-variants/${challenger.id}/content`, { payload: parseLines() });
      await API.post(`/api/element-variants/${challenger.id}/publish`, {});
      saveMessage.textContent = "Variant published. The experiment remains inactive until you start it.";
      await loadSlots(current.id);
    } catch (error) {
      saveMessage.textContent = error.message;
    }
  });

  document.getElementById("save-weights").addEventListener("click", async () => {
    try {
      const challenger = variantB();
      const control = current.variants.find(variant => variant.isControl);
      const challengerPercent = Number(weight.value);
      await API.patch(`/api/element-experiments/${current.experiment.id}/allocations`, {
        allocations: [
          { variantId: control.id, weightBasisPoints: (100 - challengerPercent) * 100 },
          { variantId: challenger.id, weightBasisPoints: challengerPercent * 100 },
        ],
      });
      await loadSlots(current.id);
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("start-experiment").addEventListener("click", async () => {
    if (!confirm("Start this experiment for eligible live visitors using the saved traffic split?")) return;
    try {
      await API.post(`/api/element-experiments/${current.experiment.id}/start`, {});
      await loadSlots(current.id);
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("pause-experiment").addEventListener("click", async () => {
    try {
      await API.post(`/api/element-experiments/${current.experiment.id}/pause`, {});
      await loadSlots(current.id);
    } catch (error) {
      alert(error.message);
    }
  });

  loadSlots().catch(error => {
    slotList.innerHTML = `<p class="danger-note">${escapeHtml(error.message)}</p>`;
  });
});
