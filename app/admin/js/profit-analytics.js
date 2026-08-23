document.addEventListener("DOMContentLoaded", () => {
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const panels = [...document.querySelectorAll("[data-panel]")];
  const money = value => value == null ? "—" : `₪${Number(value).toLocaleString(undefined,{maximumFractionDigits:2})}`;
  const pct = value => value == null ? "—" : `${Number(value).toFixed(1)}%`;
  const ratio = value => value == null ? "—" : `${Number(value).toFixed(2)}x`;
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

  function setTab(name) {
    tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.tab === name));
    panels.forEach(panel => panel.classList.toggle("hidden", panel.dataset.panel !== name));
    if (name === "health") loadHealth();
  }
  tabs.forEach(tab => tab.addEventListener("click", () => setTab(tab.dataset.tab)));

  async function loadOverview() {
    try {
      const data = await API.get("/api/profit-os/overview");
      document.getElementById("kpi-revenue").textContent = money(data.contributionRevenueIls);
      document.getElementById("kpi-orders").textContent = data.orders == null ? "—" : Number(data.orders).toLocaleString();
      document.getElementById("kpi-meta").textContent = money(data.metaSpendIls);
      document.getElementById("kpi-cm2").textContent = money(data.cm2);
      document.getElementById("kpi-cj").textContent = money(data.cjTotalVariableCostIls);
      document.getElementById("kpi-fees").textContent = money(data.paymentFeesIls);
      document.getElementById("kpi-margin").textContent = pct(data.marginPct);
      document.getElementById("kpi-poas").textContent = ratio(data.poas);
      document.getElementById("profit-completeness").innerHTML = data.profitComplete
        ? `<strong>COMPLETE</strong><p class="muted">All required sources are present for this range.</p>`
        : `<strong>INCOMPLETE</strong><p class="muted">Missing values remain null rather than being treated as zero.</p>`;
    } catch (error) {
      document.getElementById("profit-completeness").innerHTML = `<strong>BACKEND NOT WIRED ON THIS BRANCH</strong><p class="muted">${escapeHtml(error.message || String(error))}</p>`;
    }
  }

  async function loadHealth() {
    const node = document.getElementById("data-health");
    try {
      const data = await API.get("/api/profit-os/data-health");
      node.innerHTML = Object.entries(data).map(([source, value]) => {
        const quality = String(value?.quality || value?.status || "MISSING");
        const cls = quality === "ACTUAL" || quality === "READY" ? "actual" : quality === "MISSING" ? "missing" : "stale";
        return `<div class="health-row"><strong>${escapeHtml(source)}</strong><span class="quality ${cls}">${escapeHtml(quality)}</span></div>`;
      }).join("");
    } catch (error) {
      node.innerHTML = `<p class="muted">Data-health backend is not wired on the stale Git master yet. ${escapeHtml(error.message || String(error))}</p>`;
    }
  }

  const modal = document.getElementById("modal-meta");
  document.getElementById("btn-meta-settings").addEventListener("click", () => { modal.style.display = "flex"; });
  document.getElementById("btn-meta-cancel").addEventListener("click", () => { modal.style.display = "none"; });
  document.getElementById("btn-meta-save").addEventListener("click", async () => {
    const token = document.getElementById("meta-token").value.trim();
    const adAccountIds = document.getElementById("meta-accounts").value.split(",").map(v => v.trim()).filter(Boolean);
    if (!token || !adAccountIds.length) return alert("Token and at least one ad account are required.");
    try {
      await API.post("/api/profit-os/meta/token", { token, adAccountIds });
      document.getElementById("meta-token").value = "";
      modal.style.display = "none";
      await loadOverview();
    } catch (error) {
      alert(`Meta validation/refresh is not available on this branch yet: ${error.message || error}`);
    }
  });
  document.getElementById("btn-refresh").addEventListener("click", async () => {
    await loadOverview();
    const healthPanel = document.querySelector('[data-panel="health"]');
    if (healthPanel && !healthPanel.classList.contains("hidden")) await loadHealth();
  });

  loadOverview();
});
