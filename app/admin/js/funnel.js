document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const funnelId = urlParams.get("id");

  if (!funnelId) {
    window.location.href = "index.html";
    return;
  }

  let currentFunnel = null;
  let selectedStepId = null;
  let draggedStepId = null;

  // DOM Elements
  const topFunnelName = document.getElementById("top-funnel-name");
  const topFunnelStatus = document.getElementById("top-funnel-status");
  const stepFlowContainer = document.getElementById("step-flow");
  const stepTitle = document.getElementById("step-title");
  const stepKindBadge = document.getElementById("step-kind-badge");
  const variantList = document.getElementById("variant-list");
  const btnAnalytics = document.getElementById("btn-analytics");
  const btnPublishFunnel = document.getElementById("btn-publish-funnel");
  const btnDraftFunnel = document.getElementById("btn-draft-funnel");
  const btnAddStep = document.getElementById("btn-add-step");
  const btnAddStepSidebar = document.getElementById("btn-add-step-sidebar");
  const btnDeleteStep = document.getElementById("btn-delete-step");
  const btnMoveUp = document.getElementById("btn-move-up");
  const btnMoveDown = document.getElementById("btn-move-down");
  const btnAddVariant = document.getElementById("btn-add-variant");
  const btnStartAb = document.getElementById("btn-start-ab");

  // Inline Step Telemetry Elements
  const stepInlineAnalytics = document.getElementById("step-inline-analytics");
  const stepValEntries = document.getElementById("step-val-entries");
  const stepValViews = document.getElementById("step-val-views");
  const stepValCtas = document.getElementById("step-val-ctas");
  const stepValRate = document.getElementById("step-val-rate");
  const stepValRevenue = document.getElementById("step-val-revenue");

  // Modals
  const modalAddStep = document.getElementById("modal-add-step");
  const formAddStep = document.getElementById("form-add-step");
  const btnCancelStepModal = document.getElementById("btn-cancel-step-modal");

  const modalAddVariant = document.getElementById("modal-add-variant");
  const formAddVariant = document.getElementById("form-add-variant");
  const btnCancelVariantModal = document.getElementById("btn-cancel-variant-modal");
  const selectDuplicateFrom = document.getElementById("select-duplicate-from");

  btnAnalytics.addEventListener("click", () => {
    window.location.href = `analytics.html?funnelId=${funnelId}`;
  });

  btnPublishFunnel.addEventListener("click", async () => {
    btnPublishFunnel.disabled = true;
    try {
      await API.patch(`/api/funnels/${funnelId}`, { status: "PUBLISHED" });
      await loadFunnel();
      alert("Funnel is now PUBLISHED!");
    } catch (err) {
      alert("Error publishing funnel: " + err.message);
    } finally {
      btnPublishFunnel.disabled = false;
    }
  });

  btnDraftFunnel.addEventListener("click", async () => {
    btnDraftFunnel.disabled = true;
    try {
      await API.patch(`/api/funnels/${funnelId}`, { status: "DRAFT" });
      await loadFunnel();
      alert("Funnel reverted to DRAFT.");
    } catch (err) {
      alert("Error setting status: " + err.message);
    } finally {
      btnDraftFunnel.disabled = false;
    }
  });

  function openAddStepModal() {
    formAddStep.reset();
    modalAddStep.style.display = "flex";
  }
  function closeAddStepModal() {
    modalAddStep.style.display = "none";
  }
  btnAddStep?.addEventListener("click", openAddStepModal);
  btnAddStepSidebar?.addEventListener("click", openAddStepModal);
  btnCancelStepModal?.addEventListener("click", closeAddStepModal);

  function openAddVariantModal() {
    formAddVariant.reset();
    const currentStep = currentFunnel?.steps?.find(s => s.id === selectedStepId);
    selectDuplicateFrom.innerHTML = `<option value="">Start from scratch (blank HTML)</option>` +
      (currentStep?.variants || []).map(v => `<option value="${v.id}">Duplicate "${v.name}"</option>`).join("");
    modalAddVariant.style.display = "flex";
  }
  function closeAddVariantModal() {
    modalAddVariant.style.display = "none";
  }
  btnAddVariant?.addEventListener("click", openAddVariantModal);
  btnCancelVariantModal?.addEventListener("click", closeAddVariantModal);

  formAddStep?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(formAddStep);
    try {
      const step = await API.post(`/api/funnels/${funnelId}/steps`, {
        name: data.get("name"),
        kind: data.get("kind"),
      });
      closeAddStepModal();
      selectedStepId = step.id;
      loadFunnel();
    } catch (err) {
      alert("Failed to add step: " + err.message);
    }
  });

  formAddVariant?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(formAddVariant);
    try {
      await API.post(`/api/steps/${selectedStepId}/variants`, {
        name: data.get("name"),
        duplicateFrom: data.get("duplicateFrom") || undefined,
      });
      closeAddVariantModal();
      loadFunnel();
    } catch (err) {
      alert("Failed to add variant: " + err.message);
    }
  });

  btnDeleteStep?.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to delete this step?")) return;
    try {
      await API.del(`/api/steps/${selectedStepId}`);
      selectedStepId = null;
      loadFunnel();
    } catch (err) {
      alert("Failed to delete step: " + err.message);
    }
  });

  btnMoveUp?.addEventListener("click", async () => {
    const steps = currentFunnel?.steps || [];
    const idx = steps.findIndex(s => s.id === selectedStepId);
    if (idx <= 0) return;
    const reordered = [...steps];
    const temp = reordered[idx];
    reordered[idx] = reordered[idx - 1];
    reordered[idx - 1] = temp;
    await saveBatchReorder(reordered.map(s => s.id));
  });

  btnMoveDown?.addEventListener("click", async () => {
    const steps = currentFunnel?.steps || [];
    const idx = steps.findIndex(s => s.id === selectedStepId);
    if (idx < 0 || idx >= steps.length - 1) return;
    const reordered = [...steps];
    const temp = reordered[idx];
    reordered[idx] = reordered[idx + 1];
    reordered[idx + 1] = temp;
    await saveBatchReorder(reordered.map(s => s.id));
  });

  async function saveBatchReorder(stepIds) {
    try {
      await API.patch(`/api/funnels/${funnelId}/steps/reorder`, { stepIds });
      await loadFunnel();
    } catch (err) {
      alert("Failed to reorder steps: " + err.message);
    }
  }

  btnStartAb?.addEventListener("click", async () => {
    try {
      await API.post(`/api/steps/${selectedStepId}/experiments`, {});
      loadFunnel();
    } catch (err) {
      alert("Failed to start A/B test: " + err.message);
    }
  });

  async function loadFunnel() {
    try {
      currentFunnel = await API.get(`/api/funnels/${funnelId}`);
      renderHeader();
      renderStepFlow();
      renderStepDetail();
      loadInlineStepTelemetry();
    } catch (err) {
      console.error("Error loading funnel:", err);
    }
  }

  function renderHeader() {
    topFunnelName.textContent = currentFunnel.name;
    topFunnelStatus.textContent = currentFunnel.status;
    const isPublished = currentFunnel.status === 'PUBLISHED';
    topFunnelStatus.className = `badge ${isPublished ? 'badge-published' : 'badge-draft'}`;

    if (isPublished) {
      btnPublishFunnel.style.display = "none";
      btnDraftFunnel.style.display = "inline-block";
    } else {
      btnPublishFunnel.style.display = "inline-block";
      btnDraftFunnel.style.display = "none";
    }
  }

  function renderStepFlow() {
    const steps = currentFunnel.steps || [];
    if (!selectedStepId && steps.length > 0) {
      selectedStepId = steps[0].id;
    }

    if (steps.length === 0) {
      stepFlowContainer.innerHTML = "<p class='muted' style='text-align:center; padding:16px;'>No steps yet. Click + Add Step below.</p>";
      return;
    }

    stepFlowContainer.innerHTML = steps.map((step, idx) => {
      const isActive = step.id === selectedStepId;
      return `
        <div class="step-node ${isActive ? 'active' : ''}" draggable="true" data-id="${step.id}" data-index="${idx}">
          <div class="step-node-icon">${step.position}</div>
          <div class="step-node-info">
            <span class="step-node-name">${escapeHtml(step.name)}</span>
            <span class="badge badge-kind" style="font-size:9px;">${step.kind}</span>
          </div>
        </div>
        ${idx < steps.length - 1 ? '<div class="step-connector"></div>' : ''}
      `;
    }).join("");

    attachDragAndDropHandlers();
  }

  function attachDragAndDropHandlers() {
    const nodes = stepFlowContainer.querySelectorAll(".step-node");
    nodes.forEach(node => {
      node.addEventListener("dragstart", (e) => {
        draggedStepId = node.dataset.id;
        node.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });

      node.addEventListener("dragend", () => {
        node.classList.remove("dragging");
        nodes.forEach(n => n.classList.remove("drag-over"));
      });

      node.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (node.dataset.id !== draggedStepId) {
          node.classList.add("drag-over");
        }
      });

      node.addEventListener("dragleave", () => {
        node.classList.remove("drag-over");
      });

      node.addEventListener("drop", async (e) => {
        e.preventDefault();
        node.classList.remove("drag-over");
        const targetId = node.dataset.id;
        if (!draggedStepId || draggedStepId === targetId) return;

        const steps = currentFunnel.steps || [];
        const fromIdx = steps.findIndex(s => s.id === draggedStepId);
        const toIdx = steps.findIndex(s => s.id === targetId);

        if (fromIdx >= 0 && toIdx >= 0) {
          const reordered = [...steps];
          const [moved] = reordered.splice(fromIdx, 1);
          reordered.splice(toIdx, 0, moved);

          await saveBatchReorder(reordered.map(s => s.id));
        }
      });

      node.addEventListener("click", () => {
        selectStep(node.dataset.id);
      });
    });
  }

  window.selectStep = function(id) {
    selectedStepId = id;
    renderStepFlow();
    renderStepDetail();
    loadInlineStepTelemetry();
  };

  function renderStepDetail() {
    const steps = currentFunnel?.steps || [];
    const step = steps.find(s => s.id === selectedStepId);
    if (!step) {
      stepTitle.textContent = "Select or Add a Step";
      variantList.innerHTML = "<p class='muted'>No step selected.</p>";
      return;
    }

    stepTitle.textContent = step.name;
    stepKindBadge.textContent = step.kind;

    const idx = steps.findIndex(s => s.id === selectedStepId);
    btnMoveUp.disabled = idx <= 0;
    btnMoveDown.disabled = idx >= steps.length - 1;

    const variants = step.variants || [];
    const isCheckout = step.kind === "CHECKOUT";
    const experiment = step.experiment;

    // A/B Test Banner UI
    const abBanner = document.getElementById("ab-status-banner");
    const abControls = document.getElementById("ab-weight-controls");

    if (experiment && experiment.status === "RUNNING") {
      abBanner.style.display = "block";
      const allocations = experiment.allocations || [];

      window.weightState[experiment.id] = {};
      allocations.forEach(a => {
        const percent = Math.round((a.weightBasisPoints / 10000) * 100);
        window.weightState[experiment.id][a.variantId] = percent;
      });

      abControls.innerHTML = allocations.map(a => {
        const v = variants.find(varItem => varItem.id === a.variantId);
        const percent = window.weightState[experiment.id][a.variantId];
        return `
          <div style="flex:1; min-width:180px;">
            <label class="eyebrow">${escapeHtml(v?.name || 'Variant')}: <span id="weight-label-${a.variantId}">${percent}%</span></label>
            <input type="range" min="0" max="100" value="${percent}" oninput="updateWeightLabel('${experiment.id}', '${a.variantId}', this.value)" style="width:100%;">
          </div>
        `;
      }).join("") + `<button class="btn btn-sm btn-primary" onclick="saveWeights('${experiment.id}')">Save Splits</button>`;

      updateTotalWeightLabel(experiment.id);
    } else {
      abBanner.style.display = "none";
    }

    if (!isCheckout && variants.length >= 2 && (!experiment || experiment.status !== "RUNNING")) {
      btnStartAb.style.display = "inline-block";
    } else {
      btnStartAb.style.display = "none";
    }

    if (isCheckout) {
      variantList.innerHTML = `
        <div class="panel" style="grid-column: 1 / -1; padding:20px; text-align:center;">
          <p class="muted">Checkout steps hand off payment directly to Shopify checkout. Checkout pages cannot have custom HTML variants.</p>
        </div>
      `;
      return;
    }

    variantList.innerHTML = variants.map(v => {
      const isPublished = v.versions && v.versions.some(ver => ver.state === "PUBLISHED");
      return `
        <div class="panel">
          <div class="panel-header">
            <h4>${escapeHtml(v.name)}</h4>
            <span class="badge ${isPublished ? 'badge-published' : 'badge-draft'}">${isPublished ? 'PUBLISHED' : 'DRAFT'}</span>
          </div>
          <div class="panel-body">
            <p class="eyebrow" style="margin-bottom:12px;">Revisions: ${v.versions?.length || 0}</p>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <a href="editor.html?variantId=${v.id}&funnelId=${funnelId}" class="btn btn-sm btn-primary">Edit HTML</a>
              <a href="/f/${currentFunnel.slug}/${step.position}?vid=preview" target="_blank" class="btn btn-sm">Live View</a>
              ${experiment?.status === 'RUNNING' ? `<button class="btn btn-sm" onclick="promoteVariant('${experiment.id}', '${v.id}')">Promote Winner</button>` : ''}
              ${variants.length > 1 ? `<button class="btn btn-sm btn-danger" onclick="deleteVariant('${v.id}')">Delete</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  async function loadInlineStepTelemetry() {
    if (!selectedStepId) {
      stepInlineAnalytics.style.display = "none";
      return;
    }

    try {
      const report = await API.get(`/api/analytics/${funnelId}`);
      const stepData = report.steps?.find(s => s.stepId === selectedStepId);

      if (stepData) {
        stepInlineAnalytics.style.display = "block";
        stepValEntries.textContent = (stepData.entries || 0).toLocaleString();
        stepValViews.textContent = (stepData.views || 0).toLocaleString();
        stepValCtas.textContent = (stepData.ctas || 0).toLocaleString();
        stepValRate.textContent = `${stepData.ctaRate || 0}%`;
        stepValRevenue.textContent = `$${(stepData.revenue || 0).toFixed(2)}`;
      } else {
        stepInlineAnalytics.style.display = "none";
      }
    } catch {
      stepInlineAnalytics.style.display = "none";
    }
  }

  window.promoteVariant = async function(expId, varId) {
    if (!confirm("Promote this variant to 100% traffic and finish A/B test?")) return;
    try {
      await API.post(`/api/experiments/${expId}/promote/${varId}`, {});
      loadFunnel();
    } catch (err) {
      alert("Failed to promote variant: " + err.message);
    }
  };

  window.deleteVariant = async function(varId) {
    if (!confirm("Are you sure you want to delete this variant?")) return;
    try {
      await API.del(`/api/variants/${varId}`);
      loadFunnel();
    } catch (err) {
      alert("Failed to delete variant: " + err.message);
    }
  };

  window.weightState = {};
  window.updateWeightLabel = function(expId, varId, val) {
    if (!window.weightState[expId]) window.weightState[expId] = {};
    window.weightState[expId][varId] = Number(val);
    const label = document.getElementById(`weight-label-${varId}`);
    if (label) label.textContent = `${val}%`;
    updateTotalWeightLabel(expId);
  };

  function updateTotalWeightLabel(expId) {
    const weights = window.weightState[expId] || {};
    const sum = Object.values(weights).reduce((a, b) => a + Number(b), 0);
    const label = document.getElementById("ab-total-weight-label");
    if (label) {
      label.textContent = `${sum}%`;
      label.style.color = sum === 100 ? "var(--green)" : "var(--red)";
    }
  }

  window.saveWeights = async function(expId) {
    const weights = window.weightState[expId] || {};
    const sum = Object.values(weights).reduce((a, b) => a + Number(b), 0);
    if (sum !== 100) {
      alert(`Traffic split weights must total 100%. Currently total ${sum}%.`);
      return;
    }

    const allocations = Object.keys(weights).map(vId => ({
      variantId: vId,
      weightBasisPoints: Math.round(weights[vId] * 100),
    }));

    try {
      await API.patch(`/api/experiments/${expId}/allocations`, { allocations });
      loadFunnel();
      alert("Traffic splits updated successfully!");
    } catch (err) {
      alert("Failed to update weights: " + err.message);
    }
  };

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  }

  loadFunnel();
});
