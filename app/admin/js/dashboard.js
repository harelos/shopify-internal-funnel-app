document.addEventListener("DOMContentLoaded", () => {
  const funnelList = document.getElementById("funnel-list");
  const emptyState = document.getElementById("empty-state");
  const modalNewFunnel = document.getElementById("modal-new-funnel");
  const formNewFunnel = document.getElementById("form-new-funnel");
  const btnNewFunnel = document.getElementById("btn-new-funnel");
  const btnEmptyCreate = document.getElementById("btn-empty-create");
  const btnCancelModal = document.getElementById("btn-cancel-modal");
  const slugInput = document.querySelector('[name="slug"]');
  const nameInput = document.querySelector('[name="name"]');
  const slugPreview = document.getElementById("slug-preview");
  const connectionStatus = document.getElementById("shopify-connection-status");

  async function loadShopifyStatus() {
    if (!connectionStatus) return;
    try {
      const status = await API.get("/api/shopify/status");
      connectionStatus.textContent = status.ok
        ? `Shopify connected: ${status.shopDomain}`
        : `Local mode: ${status.note}`;
      connectionStatus.style.color = status.ok ? "#197b5b" : "#8a6a1f";
    } catch {
      connectionStatus.textContent = "Shopify status unavailable. The local funnel panel is still usable.";
    }
  }

  function openModal() {
    formNewFunnel.reset();
    slugPreview.textContent = "summer-sale";
    modalNewFunnel.style.display = "flex";
    nameInput.focus();
  }

  function closeModal() {
    modalNewFunnel.style.display = "none";
  }

  btnNewFunnel?.addEventListener("click", openModal);
  btnEmptyCreate?.addEventListener("click", openModal);
  btnCancelModal?.addEventListener("click", closeModal);

  nameInput?.addEventListener("input", (e) => {
    const slug = e.target.value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    slugInput.value = slug;
    slugPreview.textContent = slug || "your-funnel";
  });

  async function loadFunnels() {
    try {
      const funnels = await API.get("/api/funnels");
      renderFunnels(funnels);
    } catch (err) {
      console.error("Failed to load funnels:", err);
    }
  }

  function renderFunnels(funnels) {
    if (!funnels || funnels.length === 0) {
      funnelList.style.display = "none";
      emptyState.style.display = "block";
      return;
    }

    emptyState.style.display = "none";
    funnelList.style.display = "grid";

    funnelList.innerHTML = funnels.map(f => {
      const statusClass = f.status === "PUBLISHED" ? "badge-published" : f.status === "ARCHIVED" ? "badge-archived" : "badge-draft";
      return `
        <div class="panel" style="cursor:pointer;" onclick="window.location.href='funnel.html?id=${f.id}'">
          <div class="panel-header">
            <h3>${escapeHtml(f.name)}</h3>
            <span class="badge ${statusClass}">${f.status}</span>
          </div>
          <div class="panel-body">
            <p class="eyebrow" style="margin-bottom:8px;">Path: /apps/funnels/${escapeHtml(f.slug)}</p>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px;">
              <span class="muted" style="font-size:12px;">${f._count?.steps || f.steps?.length || 0} Steps</span>
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); archiveFunnel('${f.id}')">Archive</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  window.archiveFunnel = async function(id) {
    if (!confirm("Are you sure you want to archive this funnel?")) return;
    try {
      await API.del(`/api/funnels/${id}`);
      loadFunnels();
    } catch (err) {
      alert("Error archiving funnel: " + err.message);
    }
  };

  formNewFunnel?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(formNewFunnel);
    try {
      const created = await API.post("/api/funnels", {
        name: formData.get("name"),
        slug: formData.get("slug"),
      });
      closeModal();
      window.location.href = `funnel.html?id=${created.id}`;
    } catch (err) {
      alert("Failed to create funnel: " + err.message);
    }
  });

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  }

  loadFunnels();
  loadShopifyStatus();
});
