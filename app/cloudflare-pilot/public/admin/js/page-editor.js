/**
 * Page editor.
 *
 * The page body from Shopify is parsed once into an editing document. The
 * sidebar reorders, hides and adds sections in that document; clicks in the
 * preview select elements in it; text and images are edited in place. The
 * preview is the real storefront shell (its own CSS) with the edited body
 * dropped in and every script removed, so nothing can buy anything from
 * inside the editor. Publishing sends the serialised body back; the Worker
 * keeps a backup first.
 */
document.addEventListener("DOMContentLoaded", () => {
  const byId = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const when = iso => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const EDIT_ID = "data-nh-edit-id";
  const BLOCK_ATTR = "data-nh-editor-block";
  // ids the page's scripts depend on: those sections can be moved and edited, not deleted or hidden
  const LOCKED = new Set(["buy", "stickyBuyBar"]);
  const TEXT_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "SPAN", "LI", "A", "BUTTON", "STRONG", "B", "EM", "SMALL", "LABEL", "DIV", "TD", "TH", "SUMMARY", "FIGCAPTION", "BLOCKQUOTE"]);
  const SECTION_NAMES = {
    buy: "Buy box (gallery, shades, packages)", "proof-bar": "Trust bar", "before-after": "Before / after", mechanism: "How it works",
    formula: "Ingredients", "how-to-use": "How to use", "social-proof": "Reviews", comparison: "Comparison", "offer-reentry": "Offer again",
    "beard-use": "Beard use", guarantee: "Guarantee", faq: "FAQ", "transition-banner": "Banner", "reviews-full": "All reviews", stickyBuyBar: "Sticky buy bar",
  };

  const state = {
    handle: "", page: null, doc: null, root: null, shell: null, selectedId: null, dirty: false, nextId: 1, frameWidth: 390, draftNote: "",
  };
  const frame = byId("editor-frame");
  const status = byId("editor-status");
  const setStatus = (text, cls = "badge-draft") => { status.textContent = text; status.className = `badge ${cls}`; };
  const markDirty = () => { state.dirty = true; setStatus("UNSAVED EDITS", "badge-draft"); };

  /* ------------------------------------------------------------------ loading */

  async function loadPages() {
    const select = byId("editor-page");
    try {
      const { pages } = await API.get("/api/page-editor/pages");
      select.innerHTML = pages.map(p => `<option value="${escape(p.handle)}">${escape(p.title)} — /pages/${escape(p.handle)}</option>`).join("") || '<option value="">No editable pages</option>';
      const wanted = new URLSearchParams(location.search).get("handle") || (pages.find(p => p.handle === "novahair-sales-staging") ? "novahair-sales-staging" : pages[0]?.handle);
      if (wanted) { select.value = wanted; await loadPage(wanted); }
    } catch (error) { setStatus("ERROR", "badge-draft"); Dialogs.alert(error.message); }
  }

  async function loadPage(handle, { preferDraft = true } = {}) {
    setStatus("LOADING…");
    const data = await API.get(`/api/page-editor/pages/${encodeURIComponent(handle)}`);
    state.handle = handle; state.page = data.page; state.dirty = false; state.selectedId = null;
    const useDraft = Boolean(preferDraft && data.draft)
      && await Dialogs.confirm(`There is a saved draft from ${when(data.draft.updatedAt)}. Continue editing it, or load what is live on Shopify?`, { title: "Saved draft found", okLabel: "Continue the draft", cancelLabel: "Load the live page" });
    parseBody(useDraft ? data.draft.body : data.page.body);
    renderBackups(data.backups);
    try { state.shell = await fetchShell(handle); } catch { state.shell = null; }
    renderAll();
    setStatus(useDraft ? "DRAFT LOADED" : "LIVE PAGE LOADED", "badge-active");
  }

  async function fetchShell(handle) {
    const headers = await (async () => { try { return window.shopify?.idToken ? { Authorization: `Bearer ${await window.shopify.idToken()}` } : {}; } catch { return {}; } })();
    const response = await fetch(`/api/page-editor/pages/${encodeURIComponent(handle)}/shell`, { headers });
    if (!response.ok) throw new Error("shell unavailable");
    return await response.text();
  }

  function parseBody(html) {
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
    state.doc = doc;
    state.root = doc.querySelector(".nova") || doc.body;
    state.nextId = 1;
    doc.body.querySelectorAll("*").forEach(el => el.setAttribute(EDIT_ID, String(state.nextId++)));
  }

  function serialize() {
    const clone = state.doc.body.cloneNode(true);
    clone.querySelectorAll(`[${EDIT_ID}]`).forEach(el => { el.removeAttribute(EDIT_ID); el.removeAttribute("contenteditable"); el.removeAttribute("spellcheck"); });
    return clone.innerHTML;
  }

  /* ------------------------------------------------------------------ sections */

  function sections() { return [...state.root.children].filter(el => !["SCRIPT", "STYLE", "TEMPLATE", "LINK"].includes(el.tagName)); }
  function sectionName(el) {
    if (el.hasAttribute(BLOCK_ATTR)) return { name: "Custom HTML block", detail: (el.textContent || "").trim().slice(0, 40) };
    const id = el.id || "";
    if (SECTION_NAMES[id]) return { name: SECTION_NAMES[id], detail: `#${id}` };
    const heading = el.querySelector("h1,h2,h3");
    if (heading && heading.textContent.trim()) return { name: heading.textContent.trim().slice(0, 48), detail: id ? `#${id}` : el.className.split(" ")[0] || el.tagName.toLowerCase() };
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return { name: text || el.tagName.toLowerCase(), detail: id ? `#${id}` : el.className.split(" ").slice(0, 2).join(" ") };
  }
  function renderSections() {
    const list = byId("editor-sections");
    const items = sections();
    list.innerHTML = items.map(el => {
      const { name, detail } = sectionName(el);
      const id = el.getAttribute(EDIT_ID);
      const hidden = el.hasAttribute("hidden");
      const locked = LOCKED.has(el.id);
      const custom = el.hasAttribute(BLOCK_ATTR);
      return `<li class="editor-section ${hidden ? "is-hidden" : ""} ${state.selectedId === id ? "is-selected" : ""} ${locked ? "is-locked" : ""}" draggable="true" data-id="${id}">
        <span class="editor-section__grip" aria-hidden="true">⋮⋮</span>
        <span class="editor-section__name">${escape(name)}<small>${escape(detail)}</small></span>
        <span class="editor-section__tools">
          <button type="button" data-tool="up" title="Move up" aria-label="Move up">▲</button><button type="button" data-tool="down" title="Move down" aria-label="Move down">▼</button>
          ${locked ? '<span class="muted" title="The page\'s scripts need this section">🔒</span>' : `<button type="button" data-tool="hide" title="${hidden ? "Show" : "Hide"}">${hidden ? "🙈" : "👁"}</button>`}
          ${custom ? '<button type="button" data-tool="delete" class="is-danger" title="Delete this block">✕</button>' : ""}
        </span></li>`;
    }).join("") || '<li class="muted">No sections found in this page.</li>';
    wireSections();
  }
  function wireSections() {
    const list = byId("editor-sections");
    let dragging = null;
    list.querySelectorAll(".editor-section").forEach(item => {
      item.addEventListener("click", event => { if (event.target.closest("[data-tool]")) return; select(item.dataset.id, true); });
      item.addEventListener("dragstart", () => { dragging = item; item.classList.add("is-dragging"); });
      item.addEventListener("dragend", () => { item.classList.remove("is-dragging"); list.querySelectorAll(".is-over").forEach(n => n.classList.remove("is-over")); });
      item.addEventListener("dragover", event => { event.preventDefault(); if (item !== dragging) item.classList.add("is-over"); });
      item.addEventListener("dragleave", () => item.classList.remove("is-over"));
      item.addEventListener("drop", event => {
        event.preventDefault();
        if (!dragging || dragging === item) return;
        const from = byEditId(dragging.dataset.id), to = byEditId(item.dataset.id);
        to.parentNode.insertBefore(from, to);
        markDirty(); renderAll();
      });
      item.querySelector('[data-tool="hide"]')?.addEventListener("click", () => {
        const el = byEditId(item.dataset.id);
        if (el.hasAttribute("hidden")) el.removeAttribute("hidden"); else el.setAttribute("hidden", "");
        markDirty(); renderAll();
      });
      item.querySelector('[data-tool="up"]')?.addEventListener("click", () => moveSection(item.dataset.id, -1));
      item.querySelector('[data-tool="down"]')?.addEventListener("click", () => moveSection(item.dataset.id, 1));
      item.querySelector('[data-tool="delete"]')?.addEventListener("click", async () => {
        if (!await Dialogs.confirm("Delete this HTML block?", { title: "Delete block", okLabel: "Delete" })) return;
        byEditId(item.dataset.id).remove(); markDirty(); renderAll();
      });
    });
  }
  function byEditId(id) { return state.doc.querySelector(`[${EDIT_ID}="${id}"]`); }
  // the ▲▼ buttons: the same move as a drag, for touch screens and keyboards
  function moveSection(id, direction) {
    const list = sections();
    const el = byEditId(id);
    const target = list[list.indexOf(el) + direction];
    if (!el || !target) return;
    if (direction < 0) target.parentNode.insertBefore(el, target); else target.parentNode.insertBefore(el, target.nextSibling);
    markDirty(); state.selectedId = id; renderAll();
  }

  function addBlock(html) {
    const clean = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
    if (!clean.trim()) return;
    const section = state.doc.createElement("section");
    section.className = "sec sec-white nh-editor-block";
    section.setAttribute(BLOCK_ATTR, Date.now().toString(36));
    section.setAttribute(EDIT_ID, String(state.nextId++));
    section.innerHTML = `<div class="wrap" style="max-width:720px;margin:0 auto;padding:24px 16px;">${clean}</div>`;
    section.querySelectorAll("*").forEach(el => el.setAttribute(EDIT_ID, String(state.nextId++)));
    const selected = state.selectedId ? byEditId(state.selectedId) : null;
    const anchor = selected ? sections().find(s => s === selected || s.contains(selected)) : null;
    if (anchor && anchor.nextSibling) anchor.parentNode.insertBefore(section, anchor.nextSibling); else state.root.appendChild(section);
    markDirty(); select(section.getAttribute(EDIT_ID), true); renderAll();
  }

  /* ------------------------------------------------------------------ preview */

  function renderPreview() {
    const body = serializeWithIds();
    let html;
    if (state.shell) {
      const shell = new DOMParser().parseFromString(state.shell, "text/html");
      const target = shell.querySelector(".nova") || shell.querySelector("main") || shell.body;
      const wrapper = shell.createElement("div");
      wrapper.innerHTML = body;
      const nova = wrapper.querySelector(".nova");
      if (nova && shell.querySelector(".nova")) target.replaceWith(nova); else target.innerHTML = body;
      shell.querySelectorAll("script").forEach(s => s.remove());
      html = "<!doctype html>" + shell.documentElement.outerHTML;
    } else {
      html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>body{font-family:'Open Sans',Arial,sans-serif;margin:0;padding:12px}</style></head><body>${body.replace(/<script\b[\s\S]*?<\/script>/gi, "")}</body></html>`;
    }
    html += `<style id="nh-editor-style">[${EDIT_ID}]:hover{outline:2px dashed rgba(216,83,54,.55);outline-offset:-2px;cursor:pointer}[${EDIT_ID}].nh-editor-selected{outline:3px solid #d85336 !important;outline-offset:-3px}[hidden][${EDIT_ID}]{display:none !important}#stickyBuyBar{position:sticky !important}</style>`;
    frame.srcdoc = html;
    frame.onload = wirePreview;
  }
  function serializeWithIds() { return state.doc.body.innerHTML; }
  // the .nova root alone, for "Preview on phone": the Worker drops it into the live page's shell
  function serializeNova() {
    const nova = state.doc.querySelector(".nova");
    if (!nova) return null;
    const clone = nova.cloneNode(true);
    [clone, ...clone.querySelectorAll(`[${EDIT_ID}]`)].forEach(el => { el.removeAttribute(EDIT_ID); el.removeAttribute("contenteditable"); el.removeAttribute("spellcheck"); });
    return clone.outerHTML;
  }

  function wirePreview() {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.addEventListener("click", event => {
      const target = event.target.closest(`[${EDIT_ID}]`);
      if (!target) return;
      event.preventDefault();
      if (doc.activeElement && doc.activeElement.isContentEditable && doc.activeElement !== target) commitEdit(doc.activeElement);
      const editable = pickEditable(target);
      select(editable.getAttribute(EDIT_ID), false);
    }, true);
    doc.addEventListener("dblclick", event => {
      const target = event.target.closest(`[${EDIT_ID}]`);
      if (!target) return;
      const editable = pickEditable(target);
      if (editable.tagName === "IMG" || editable.querySelector("img,section,article")) return;
      editable.setAttribute("contenteditable", "true"); editable.setAttribute("spellcheck", "false"); editable.focus();
    }, true);
    doc.addEventListener("focusout", event => { if (event.target.isContentEditable) commitEdit(event.target); }, true);
    doc.addEventListener("keydown", event => { if (event.key === "Escape" && event.target.isContentEditable) { event.target.blur(); } }, true);
    highlight();
  }
  function pickEditable(el) {
    if (el.tagName === "IMG") return el;
    let node = el;
    while (node && node.getAttribute && node.getAttribute(EDIT_ID)) {
      if (TEXT_TAGS.has(node.tagName) && node.querySelectorAll("img,section,article,ul,ol,table").length === 0) return node;
      node = node.parentElement;
    }
    return el;
  }
  function commitEdit(previewEl) {
    const id = previewEl.getAttribute(EDIT_ID);
    const source = id && byEditId(id);
    previewEl.removeAttribute("contenteditable"); previewEl.removeAttribute("spellcheck");
    if (!source) return;
    const html = previewEl.innerHTML.replace(/<script\b[\s\S]*?<\/script>/gi, "");
    if (source.innerHTML !== html) { source.innerHTML = html; markDirty(); renderInspector(); renderSections(); }
  }
  function highlight() {
    const doc = frame.contentDocument; if (!doc) return;
    doc.querySelectorAll(".nh-editor-selected").forEach(n => n.classList.remove("nh-editor-selected"));
    if (!state.selectedId) return;
    const el = doc.querySelector(`[${EDIT_ID}="${state.selectedId}"]`);
    if (el) { el.classList.add("nh-editor-selected"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }

  /* ------------------------------------------------------------------ inspector */

  function select(id, scrollPreview) {
    state.selectedId = id;
    renderSections(); renderInspector();
    if (scrollPreview) highlight(); else { const doc = frame.contentDocument; doc?.querySelectorAll(".nh-editor-selected").forEach(n => n.classList.remove("nh-editor-selected")); doc?.querySelector(`[${EDIT_ID}="${id}"]`)?.classList.add("nh-editor-selected"); }
  }
  function renderInspector() {
    const box = byId("editor-inspector");
    const kind = byId("editor-selected-kind");
    const el = state.selectedId && byEditId(state.selectedId);
    if (!el) { kind.textContent = "CLICK ANYTHING IN THE PREVIEW"; box.innerHTML = '<p class="muted">Click a text or an image in the preview. Double-click text to type straight into the page.</p>'; return; }
    const path = [el.tagName.toLowerCase(), el.id ? `#${el.id}` : "", el.className ? `.${String(el.className).trim().split(/\s+/).slice(0, 2).join(".")}` : ""].join("");
    if (el.tagName === "IMG") {
      kind.textContent = "IMAGE";
      box.innerHTML = `<div class="editor-inspector">
        <img src="${escape(el.getAttribute("src") || "")}" alt="">
        <label>Image URL<input id="insp-src" value="${escape(el.getAttribute("src") || "")}" placeholder="https://cdn.shopify.com/…"></label>
        <label>Alt text<input id="insp-alt" value="${escape(el.getAttribute("alt") || "")}"></label>
        <p class="muted" style="font-size:12px;">Upload the picture in Shopify → Content → Files, copy its link, paste it here. A new URL replaces every size variant of this image.</p>
        <div class="editor-path">${escape(path)}</div></div>`;
      byId("insp-src").addEventListener("change", event => {
        const url = event.target.value.trim(); if (!/^https?:\/\//.test(url)) return;
        el.setAttribute("src", url); el.removeAttribute("srcset"); el.removeAttribute("sizes"); el.removeAttribute("data-full-src");
        const picture = el.closest("picture"); picture?.querySelectorAll("source").forEach(s => s.remove());
        markDirty(); renderPreview();
      });
      byId("insp-alt").addEventListener("change", event => { el.setAttribute("alt", event.target.value); markDirty(); });
      return;
    }
    kind.textContent = TEXT_TAGS.has(el.tagName) ? "TEXT" : "ELEMENT";
    const linkField = el.tagName === "A" ? `<label>Link<input id="insp-href" value="${escape(el.getAttribute("href") || "")}"></label>` : "";
    box.innerHTML = `<div class="editor-inspector">
      <label>Text<textarea id="insp-text">${escape(el.innerText || el.textContent || "")}</textarea></label>
      ${linkField}
      <p class="muted" style="font-size:12px;">Editing here replaces the text only. Double-click in the preview to keep bold and links.</p>
      <div class="editor-path">${escape(path)}</div></div>`;
    byId("insp-text").addEventListener("change", event => { el.textContent = event.target.value; markDirty(); renderPreview(); renderSections(); });
    byId("insp-href")?.addEventListener("change", event => { el.setAttribute("href", event.target.value.trim()); markDirty(); });
  }

  /* ------------------------------------------------------------------ backups */

  function renderBackups(backups) {
    const box = byId("editor-backups");
    if (!backups?.length) { box.innerHTML = '<p class="muted">None yet. The first publish creates one.</p>'; return; }
    box.innerHTML = backups.map(b => `<div class="editor-backup"><div><strong>${escape(when(b.createdAt))}</strong><span>${escape(b.note || "")} · ${Math.round(b.bytes / 1024)} KB</span></div><button class="btn btn-sm" type="button" data-restore="${escape(b.id)}">Restore</button></div>`).join("");
    box.querySelectorAll("[data-restore]").forEach(button => button.addEventListener("click", async () => {
      if (!await Dialogs.confirm("Put this backup live now? The page as it is now is backed up first.", { title: "Restore this backup", okLabel: "Put it live" })) return;
      button.disabled = true;
      try { await API.post(`/api/page-editor/pages/${encodeURIComponent(state.handle)}/restore/${button.dataset.restore}`, {}); await loadPage(state.handle, { preferDraft: false }); Dialogs.alert("Restored. The live page is back to that version.", { title: "Restored" }); }
      catch (error) { Dialogs.alert(error.message); button.disabled = false; }
    }));
  }

  /* ------------------------------------------------------------------ actions */

  function renderAll() { renderSections(); renderInspector(); renderPreview(); }

  byId("editor-page").addEventListener("change", async event => {
    const select = event.target;
    if (state.dirty && !await Dialogs.confirm("You have unsaved edits. Switch page and lose them?", { okLabel: "Switch page" })) { select.value = state.handle; return; }
    try { await loadPage(select.value); } catch (error) { Dialogs.alert(error.message); }
  });
  byId("editor-reload").addEventListener("click", async () => {
    if (state.dirty && !await Dialogs.confirm("Throw away unsaved edits and reload from Shopify?", { okLabel: "Reload" })) return;
    try { await loadPage(state.handle, { preferDraft: false }); } catch (error) { Dialogs.alert(error.message); }
  });
  // event.currentTarget is null once a handler has awaited, so every handler keeps its button first
  byId("editor-save").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true; setStatus("SAVING DRAFT…");
    try { const r = await API.put(`/api/page-editor/pages/${encodeURIComponent(state.handle)}/draft`, { body: serialize(), note: state.draftNote }); state.dirty = false; setStatus(`DRAFT SAVED ${when(r.updatedAt)}`, "badge-active"); }
    catch (error) { setStatus("SAVE FAILED"); Dialogs.alert(error.message); }
    finally { button.disabled = false; }
  });
  byId("editor-preview").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true; setStatus("WRITING PREVIEW…");
    try {
      const r = await API.post(`/api/page-editor/pages/${encodeURIComponent(state.handle)}/preview`, { body: serialize(), nova: serializeNova() });
      setStatus("PREVIEW READY", "badge-active");
      byId("editor-hint").innerHTML = `Preview ready: <a href="${escape(r.url)}" target="_blank" rel="noopener">open it here</a> or send the link to your phone. It runs the draft with real buttons and scripts; the live page is untouched.`;
      window.open(r.url, "_blank", "noopener");
    } catch (error) { setStatus("PREVIEW FAILED"); Dialogs.alert(error.message); }
    finally { button.disabled = false; }
  });
  byId("editor-publish").addEventListener("click", async event => {
    const button = event.currentTarget;
    const note = await Dialogs.prompt("This replaces the page shoppers see. One line for the backup note: what did you change?", "", { title: "Publish to the live page", okLabel: "Publish now" });
    if (note === null) return;
    button.disabled = true; setStatus("PUBLISHING…");
    try {
      const r = await API.post(`/api/page-editor/pages/${encodeURIComponent(state.handle)}/publish`, { body: serialize(), note });
      state.dirty = false;
      setStatus(r.unchanged ? "NOTHING TO PUBLISH" : "PUBLISHED", "badge-active");
      await loadPage(state.handle, { preferDraft: false });
      if (!r.unchanged) Dialogs.alert("Published. The previous version is in Backups if you need it back.", { title: "Published" });
    } catch (error) { setStatus("PUBLISH FAILED"); Dialogs.alert(error.message); }
    finally { button.disabled = false; }
  });
  byId("editor-add-block").addEventListener("click", () => { byId("editor-modal-html").value = ""; byId("editor-modal").hidden = false; byId("editor-modal-html").focus(); });
  byId("editor-modal-cancel").addEventListener("click", () => { byId("editor-modal").hidden = true; });
  byId("editor-modal-ok").addEventListener("click", () => { addBlock(byId("editor-modal-html").value); byId("editor-modal").hidden = true; });
  document.querySelectorAll(".editor-device-toggle button").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".editor-device-toggle button").forEach(b => { b.setAttribute("aria-pressed", "false"); b.classList.remove("btn-primary"); });
    button.setAttribute("aria-pressed", "true"); button.classList.add("btn-primary");
    byId("editor-frame-wrap").style.setProperty("--frame-width", `${button.dataset.width}px`);
  }));
  window.addEventListener("beforeunload", event => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });

  loadPages();
});
