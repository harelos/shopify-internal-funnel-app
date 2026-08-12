document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const funnelId = urlParams.get("id");

  if (!funnelId) {
    window.location.href = "index.html";
    return;
  }

  let currentFunnel = null;
  let selectedStepId = null;

  // DOM Elements
  const topFunnelName = document.getElementById("top-funnel-name");
  const topFunnelStatus = document.getElementById("top-funnel-status");
  const stepFlowContainer = document.getElementById("step-flow");
  const stepTitle = document.getElementById("step-title");
  const stepKindBadge = document.getElementById("step-kind-badge");
  const variantList = document.getElementById("variant-list");
  const btnAnalytics = document.getElementById("btn-analytics");
  const btnPublishFunnel = document.getElementById("btn-publish-funnel");
  const btnAddStep = document.getElementById("btn-add-step");
  const btnAddStepSidebar = document.getElementById("btn-add-step-sidebar");
  const btnDeleteStep = document.getElementById("btn-delete-step");
  const btnAddVariant = document.getElementById("btn-add-variant");
  const btnStartAb = document.getElementById("btn-start-ab");

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
    try {
      await API.patch(`/api/funnels/${funnelId}`, { status: "PUBLISHED" });
      loadFunnel();
      alert("Funnel is now PUBLISHED!");
    } catch (err) {
      alert("Error publishing funnel: " + err.message);
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
    } catch (err) {
      console.error("Error loading funnel:", err);
    }
  }

  function renderHeader() {
    topFunnelName.textContent = currentFunnel.name;
    topFunnelStatus.textContent = currentFunnel.status;
    topFunnelStatus.className = `badge ${currentFunnel.status === 'PUBLISHED' ? 'badge-published' : 'badge-draft'}`;
  }

  function renderStepFlow() {
    const steps = currentFunnel.steps || [];
    if (!selectedStepId && steps.length > 0) {
      selectedStepId = steps[0].id;
    }

    stepFlowContainer.innerHTML = steps.map((step, idx) => {
      const isActive = step.id === selectedStepId;
      return `
        <div class="step-node ${isActive ? 'active' : ''}" onclick="selectStep('${step.id}')">
          <div class="step-node-icon">${step.position}</div>
          <div class="step-node-info">
            <span class="step-node-name">${escapeHtml(step.name)}</span>
            <span class="badge badge-kind" style="font-size:9px;">${step.kind}</span>
          </div>
        </div>
        ${idx < steps.length - 1 ? '<div class="step-connector"></div>' : ''}
      `;
    }).join("");
  }

  window.selectStep = function(id) {
    selectedStepId = id;
    renderStepFlow();
    renderStepDetail();
  };

  function renderStepDetail() {
    const step = currentFunnel?.steps?.find(s => s.id === selectedStepId);
    if (!step) {
      stepTitle.textContent = "Select a Step";
      variantList.innerHTML = "<p class='muted'>No step selected.</p>";
      return;
    }

    stepTitle.textContent = step.name;
    stepKindBadge.textContent = step.kind;

    const variants = step.variants || [];
    const isCheckout = step.kind === "CHECKOUT";
    const experiment = step.experiment;

    // A/B Test Banner UI
    const abBanner = document.getElementById("ab-status-banner");
    const abControls = document.getElementById("ab-weight-controls");

    if (experiment && experiment.status === "RUNNING") {
      abBanner.style.display = "block";
      const allocations = experiment.allocations || [];
      abControls.innerHTML = allocations.map(a => {
        const v = variants.find(varItem => varItem.id === a.variantId);
        const percent = Math.round((a.weightBasisPoints / 10000) * 100);
        return `
          <div style="flex:1;">
            <label class="eyebrow">${escapeHtml(v?.name || 'Variant')}: ${percent}%</label>
            <input type="range" min="0" max="100" value="${percent}" onchange="updateWeight('${experiment.id}', '${a.variantId}', this.value)" style="width:100%;">
          </div>
        `;
      }).join("") + `<button class="btn btn-sm btn-primary" onclick="saveWeights('${experiment.id}')">Save Splits</button>`;
    } else {
      abBanner.style.display = "none";
    }

    // Show "Start A/B Test" button if step has 2+ variants and no active experiment
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
      const hasDraft = v.versions && v.versions.length > 0;
      return `
        <div class="panel">
          <div class="panel-header">
            <h4>${escapeHtml(v.name)}</h4>
            <span class="badge ${isPublished ? 'badge-published' : 'badge-draft'}">${isPublished ? 'PUBLISHED' : 'DRAFT'}</span>
          </div>
          <div class="panel-body">
            <p class="eyebrow" style="margin-bottom:12px;">Revisions: ${v.versions?.length || 0}</p>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <a href="editor.html?variantId=${v.id}&funnelId=${funnelId}" class="btn btn-sm btn-primary">✏ Edit HTML</a>
              <a href="/f/${currentFunnel.slug}/${step.position}?vid=preview" target="_blank" class="btn btn-sm">👁 Live View</a>
              ${experiment?.status === 'RUNNING' ? `<button class="btn btn-sm" onclick="promoteVariant('${experiment.id}', '${v.id}')">🏆 Promote</button>` : ''}
              ${variants.length > 1 ? `<button class="btn btn-sm btn-danger" onclick="deleteVariant('${v.id}')">Delete</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join("");
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
  window.updateWeight = function(expId, varId, val) {
    if (!window.weightState[expId]) window.weightState[expId] = {};
    window.weightState[expId][varId] = Number(val);
  };

  window.saveWeights = async function(expId) {
    const weights = window.weightState[expId];
    if (!weights) return;
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
