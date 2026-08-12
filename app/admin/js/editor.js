document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const variantId = urlParams.get("variantId");
  const funnelId = urlParams.get("funnelId");

  if (!variantId) {
    window.location.href = "index.html";
    return;
  }

  const backLink = document.getElementById("back-link");
  backLink.href = funnelId ? `funnel.html?id=${funnelId}` : "index.html";

  const variantTitle = document.getElementById("variant-title");
  const variantBadge = document.getElementById("variant-badge");
  const portStatus = document.getElementById("port-status");
  const portReport = document.getElementById("port-report");
  const btnSave = document.getElementById("btn-save");
  const btnPublish = document.getElementById("btn-publish");
  const btnPreviewTab = document.getElementById("btn-preview-tab");
  const editorLoader = document.getElementById("editor-loader");

  let editor = null;
  let currentVersionId = null;

  require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' } });

  require(['vs/editor/editor.main'], async () => {
    try {
      const variantData = await API.get(`/api/variants/${variantId}`);
      variantTitle.textContent = `${variantData.step?.name || 'Step'} — ${variantData.name}`;
      
      const versions = variantData.versions || [];
      const latestVersion = versions[0];
      currentVersionId = latestVersion?.id;

      const isPublished = versions.some(v => v.state === "PUBLISHED");
      variantBadge.textContent = isPublished ? "PUBLISHED" : "DRAFT";
      variantBadge.className = `badge ${isPublished ? 'badge-published' : 'badge-draft'}`;

      const initialHtml = latestVersion?.rawHtml || `<main>\n  <h1>Special Offer Page</h1>\n  <p>Customize this high-converting landing page HTML</p>\n  <button class="cta-btn">Claim Offer Now</button>\n</main>`;

      if (editorLoader) editorLoader.style.display = "none";

      editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: initialHtml,
        language: 'html',
        theme: 'vs-dark',
        fontSize: 14,
        minimap: { enabled: false },
        automaticLayout: true,
        wordWrap: 'on',
      });

      portStatus.textContent = "Monaco Editor Ready";

      // Ctrl+S key binding
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveContent();
      });

    } catch (err) {
      if (editorLoader) editorLoader.textContent = "Failed to load editor: " + err.message;
      alert("Failed to load variant: " + err.message);
    }
  });

  async function saveContent() {
    if (!editor) return;
    const html = editor.getValue();
    portStatus.textContent = "Saving content...";
    btnSave.disabled = true;
    try {
      const result = await API.put(`/api/variants/${variantId}/content`, { html });
      currentVersionId = result.version.id;
      portStatus.textContent = `Saved Revision #${result.version.revision}`;
      if (result.portReport) {
        portReport.textContent = `Scripts Removed: ${result.portReport.scriptsRemoved || 0} | Iframes Removed: ${result.portReport.iframesRemoved || 0}`;
      }
    } catch (err) {
      portStatus.textContent = "Error saving: " + err.message;
    } finally {
      btnSave.disabled = false;
    }
  }

  btnSave?.addEventListener("click", saveContent);

  btnPublish?.addEventListener("click", async () => {
    btnPublish.disabled = true;
    await saveContent();
    try {
      const pub = await API.post(`/api/variants/${variantId}/publish`, {});
      variantBadge.textContent = "PUBLISHED";
      variantBadge.className = "badge badge-published";
      alert(`Revision #${pub.revision} Published to Live Storefront!`);
    } catch (err) {
      alert("Failed to publish: " + err.message);
    } finally {
      btnPublish.disabled = false;
    }
  });

  btnPreviewTab?.addEventListener("click", async () => {
    if (!currentVersionId) {
      await saveContent();
    }
    if (currentVersionId) {
      window.open(`/preview/${currentVersionId}`, "_blank");
    }
  });
});
