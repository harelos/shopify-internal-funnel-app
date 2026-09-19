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
 *
 * Formatting (font, size, weight, colour, alignment, line height) is written
 * as inline style on the selected element in the editing document and
 * mirrored onto the same element in the preview, so the page never reloads
 * while the owner is tuning it. Bold / italic / underline wrap the current
 * selection in the preview (execCommand) and fall back to the whole element.
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

  // formatting toolbar choices; values are what ends up in the inline style
  const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48];
  const FONT_WEIGHTS = [["", "Inherit"], ["400", "Normal 400"], ["500", "Medium 500"], ["700", "Bold 700"], ["800", "Black 800"]];
  const LINE_HEIGHTS = [["", "Inherit"], ["1.15", "Tight 1.15"], ["1.4", "Normal 1.4"], ["1.7", "Loose 1.7"]];
  const ALIGNMENTS = [["right", "Right"], ["center", "Center"], ["left", "Left"]];
  const PALETTE = ["#000000", "#17231e", "#444444", "#666666", "#ffffff", "#d85336", "#197b5b", "#b88a18"];
  const FONTS = [
    { name: "Heebo", google: true }, { name: "Assistant", google: true }, { name: "Rubik", google: true }, { name: "Open Sans", google: true }, { name: "Noto Sans Hebrew", google: true },
    { name: "Arial", stack: "Arial, Helvetica, sans-serif" }, { name: "Georgia", stack: 'Georgia, "Times New Roman", serif' },
  ];
  const FORMAT_PROPS = ["font-size", "font-weight", "color", "text-align", "line-height", "font-family", "font-style", "text-decoration"];
  const INLINE_KEYS = { b: "bold", i: "italic", u: "underline" };
  const IMAGE_WIDTHS = [["", "Auto"], ["100%", "100%"], ["75%", "75%"], ["50%", "50%"], ["33%", "33%"], ["25%", "25%"]];
  const IMAGE_RADII = [["", "Theme default"], ["0px", "0 px"], ["8px", "8 px"], ["16px", "16 px"], ["24px", "24 px"]];
  const UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
  const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

  const state = {
    handle: "", page: null, doc: null, root: null, shell: null, selectedId: null, dirty: false, nextId: 1, frameWidth: 390, draftNote: "",
    lastRange: null, // the last text selection made in the preview, kept for the B / I / U buttons
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

  // App Bridge's token, for the two requests that bypass api.js (the shell is HTML, the upload is bytes)
  async function authHeaders() {
    try { return window.shopify?.idToken ? { Authorization: `Bearer ${await window.shopify.idToken()}` } : {}; } catch { return {}; }
  }

  async function fetchShell(handle) {
    const response = await fetch(`/api/page-editor/pages/${encodeURIComponent(handle)}/shell`, { headers: await authHeaders() });
    if (!response.ok) throw new Error("shell unavailable");
    return await response.text();
  }

  function parseBody(html) {
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
    state.doc = doc;
    state.root = doc.querySelector(".nova") || doc.body;
    state.nextId = 1;
    state.lastRange = null;
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
    state.lastRange = null;
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
    doc.addEventListener("keydown", event => {
      if (!event.target.isContentEditable) return;
      if (event.key === "Escape") { event.target.blur(); return; }
      // Ctrl/Cmd+B, I, U while typing: the same as the toolbar buttons
      const command = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey ? INLINE_KEYS[String(event.key).toLowerCase()] : null;
      if (!command) return;
      event.preventDefault();
      doc.execCommand(command, false);
      const host = event.target.closest(`[${EDIT_ID}]`);
      if (host) { syncSource(host); renderInspector(); }
    }, true);
    // remember the selection so the toolbar can still wrap it after the click on a button
    doc.addEventListener("selectionchange", () => {
      const sel = frame.contentWindow?.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const host = (node.nodeType === 1 ? node : node.parentElement)?.closest(`[${EDIT_ID}]`);
      if (host) state.lastRange = range.cloneRange();
    });
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
  // the preview element's markup back into the editing document, without ending the inline edit
  function syncSource(previewEl) {
    const id = previewEl.getAttribute(EDIT_ID);
    const source = id && byEditId(id);
    if (!source) return false;
    const html = previewEl.innerHTML.replace(/<script\b[\s\S]*?<\/script>/gi, "");
    if (source.innerHTML === html) return false;
    source.innerHTML = html; markDirty();
    return true;
  }
  function commitEdit(previewEl) {
    previewEl.removeAttribute("contenteditable"); previewEl.removeAttribute("spellcheck");
    if (syncSource(previewEl)) { renderInspector(); renderSections(); }
  }
  function highlight() {
    const doc = frame.contentDocument; if (!doc) return;
    doc.querySelectorAll(".nh-editor-selected").forEach(n => n.classList.remove("nh-editor-selected"));
    if (!state.selectedId) return;
    const el = doc.querySelector(`[${EDIT_ID}="${state.selectedId}"]`);
    if (el) { el.classList.add("nh-editor-selected"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }

  /* ------------------------------------------------------------------ formatting */

  function previewElement(id) { return frame.contentDocument?.querySelector(`[${EDIT_ID}="${id}"]`) || null; }
  // the source element's inline style, copied onto its twin in the preview: no reload, no scroll jump
  function syncPreviewStyle(el) {
    const twin = previewElement(el.getAttribute(EDIT_ID));
    if (!twin) return;
    const style = el.getAttribute("style");
    if (style) twin.setAttribute("style", style); else twin.removeAttribute("style");
  }
  function tidyStyle(el) { if (!el.getAttribute("style")) el.removeAttribute("style"); }
  function setStyle(el, prop, value) {
    if (value) el.style.setProperty(prop, value); else el.style.removeProperty(prop);
    tidyStyle(el); markDirty(); syncPreviewStyle(el);
  }
  function clearFormatting(el) {
    FORMAT_PROPS.forEach(prop => el.style.removeProperty(prop));
    tidyStyle(el); markDirty(); syncPreviewStyle(el);
  }
  function toHex(color) {
    const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color || "");
    if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map(n => Number(n).toString(16).padStart(2, "0")).join("")}`;
    return /^#[0-9a-f]{6}$/i.test(color || "") ? color.toLowerCase() : "";
  }
  function fontStack(font) { return font.stack || `"${font.name}", sans-serif`; }
  function currentFont(el) {
    const raw = el.style.getPropertyValue("font-family");
    if (!raw) return "";
    const first = raw.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
    return FONTS.find(f => f.name.toLowerCase() === first)?.name || raw;
  }
  function googleFontHref(name) { return `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, "+")}:wght@400;500;700;800&display=swap`; }
  // one stylesheet link per Google family inside the .nova root, so the live page loads the font too
  function ensureFontLink(font) {
    if (!font.google) return;
    const href = googleFontHref(font.name);
    const has = scope => [...scope.querySelectorAll("link[rel=stylesheet]")].some(link => link.getAttribute("href") === href);
    if (!has(state.root)) {
      const link = state.doc.createElement("link");
      link.setAttribute("rel", "stylesheet"); link.setAttribute("href", href); link.setAttribute(EDIT_ID, String(state.nextId++));
      state.root.insertBefore(link, state.root.firstChild);
    }
    const doc = frame.contentDocument;
    if (doc && !has(doc)) {
      const link = doc.createElement("link");
      link.rel = "stylesheet"; link.href = href;
      doc.head.appendChild(link);
    }
  }
  // a non-collapsed selection inside the element's preview twin: live if there is one, else the last one made
  function selectionInside(twin) {
    const win = frame.contentWindow;
    const sel = win?.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (twin.contains(range.commonAncestorContainer)) return range;
    }
    const kept = state.lastRange;
    if (kept && !kept.collapsed && kept.startContainer.isConnected && twin.contains(kept.commonAncestorContainer)) return kept;
    return null;
  }
  // bold / italic / underline on the selected words; false when nothing is selected
  function execInline(command, el) {
    const twin = previewElement(el.getAttribute(EDIT_ID));
    const doc = frame.contentDocument, win = frame.contentWindow;
    if (!twin || !doc || !win) return false;
    const range = selectionInside(twin);
    if (!range) return false;
    const wasEditing = twin.isContentEditable;
    if (!wasEditing) { twin.setAttribute("contenteditable", "true"); twin.setAttribute("spellcheck", "false"); }
    twin.focus({ preventScroll: true });
    const sel = win.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    doc.execCommand(command, false);
    if (wasEditing) syncSource(twin); else commitEdit(twin);
    return true;
  }
  // the same three, on the whole element, when no words are selected
  function toggleWhole(command, el) {
    const st = el.style;
    if (command === "bold") setStyle(el, "font-weight", /^(700|800|900|bold|bolder)$/.test(st.getPropertyValue("font-weight")) ? "" : "700");
    if (command === "italic") setStyle(el, "font-style", st.getPropertyValue("font-style") === "italic" ? "" : "italic");
    if (command === "underline") setStyle(el, "text-decoration", /underline/.test(st.getPropertyValue("text-decoration")) ? "" : "underline");
  }
  function alignIcon(kind) {
    const rows = kind === "center" ? [[3, 14], [1, 18], [4, 12], [1, 18]] : kind === "left" ? [[1, 14], [1, 18], [1, 12], [1, 18]] : [[5, 14], [1, 18], [7, 12], [1, 18]];
    return `<svg viewBox="0 0 20 16" width="16" height="13" aria-hidden="true">${rows.map(([x, w], i) => `<rect x="${x}" y="${1 + i * 4}" width="${w}" height="2" rx="1" fill="currentColor"/>`).join("")}</svg>`;
  }
  function formatToolbar(el) {
    const st = el.style;
    const twin = previewElement(el.getAttribute(EDIT_ID));
    const computed = twin && frame.contentWindow ? frame.contentWindow.getComputedStyle(twin) : null;
    const size = st.getPropertyValue("font-size").replace(/px$/, "");
    const weight = st.getPropertyValue("font-weight");
    const lineHeight = st.getPropertyValue("line-height");
    const align = st.getPropertyValue("text-align");
    const color = toHex(st.getPropertyValue("color")) || toHex(computed?.color) || "#000000";
    const font = currentFont(el);
    const bold = /^(700|800|900|bold|bolder)$/.test(weight), italic = st.getPropertyValue("font-style") === "italic", underline = /underline/.test(st.getPropertyValue("text-decoration"));
    const option = (value, label, current) => `<option value="${escape(value)}"${String(value) === String(current) ? " selected" : ""}>${escape(label)}</option>`;
    const fontOptions = [option("", "Inherit", font), ...FONTS.map(f => option(f.name, f.name, font))];
    if (font && !FONTS.some(f => f.name === font)) fontOptions.push(option("__current", `Current: ${font}`, "__current"));
    return `<div class="editor-format">
      <div class="editor-format__row" role="group" aria-label="Formatting">
        <button type="button" class="btn btn-sm editor-format__toggle" data-inline="bold" aria-pressed="${bold}" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" class="btn btn-sm editor-format__toggle" data-inline="italic" aria-pressed="${italic}" title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" class="btn btn-sm editor-format__toggle" data-inline="underline" aria-pressed="${underline}" title="Underline (Ctrl+U)"><u>U</u></button>
        <span class="editor-format__gap"></span>
        ${ALIGNMENTS.map(([value, label]) => `<button type="button" class="btn btn-sm editor-format__toggle" data-align="${value}" aria-pressed="${align === value}" title="Align ${label.toLowerCase()}" aria-label="Align ${label.toLowerCase()}">${alignIcon(value)}</button>`).join("")}
        <span class="editor-format__gap"></span>
        <button type="button" class="btn btn-sm btn-ghost" data-clear-format title="Remove the font, size, colour, alignment and line height set here">Clear</button>
      </div>
      <div class="editor-format__grid">
        <label>Font<select data-style="font-family">${fontOptions.join("")}</select></label>
        <label>Size${computed ? ` <small>now ${Math.round(parseFloat(computed.fontSize))}px</small>` : ""}<select data-style="font-size">${option("", "Inherit", size)}${FONT_SIZES.map(px => option(String(px), `${px} px`, size)).join("")}</select></label>
        <label>Weight<select data-style="font-weight">${FONT_WEIGHTS.map(([value, label]) => option(value, label, weight)).join("")}</select></label>
        <label>Line height<select data-style="line-height">${LINE_HEIGHTS.map(([value, label]) => option(value, label, lineHeight)).join("")}</select></label>
        <label class="editor-format__wide">Colour<span class="editor-format__color"><input type="color" data-style="color" value="${escape(color)}" title="Pick any colour">${PALETTE.map(c => `<button type="button" class="editor-swatch${c === color ? " is-current" : ""}" data-color="${c}" style="background:${c}" title="${c}" aria-label="Colour ${c}"></button>`).join("")}</span></label>
      </div>
    </div>`;
  }
  function wireFormatToolbar(box, el) {
    box.querySelectorAll("[data-inline]").forEach(button => {
      button.addEventListener("mousedown", event => event.preventDefault()); // keeps the preview's focus and selection
      button.addEventListener("click", () => { if (!execInline(button.dataset.inline, el)) toggleWhole(button.dataset.inline, el); renderInspector(); });
    });
    box.querySelectorAll("[data-align]").forEach(button => button.addEventListener("click", () => {
      setStyle(el, "text-align", el.style.getPropertyValue("text-align") === button.dataset.align ? "" : button.dataset.align); renderInspector();
    }));
    box.querySelector("[data-clear-format]")?.addEventListener("click", () => { clearFormatting(el); renderInspector(); });
    box.querySelectorAll("select[data-style]").forEach(select => select.addEventListener("change", event => {
      const prop = select.dataset.style;
      let value = event.target.value;
      if (prop === "font-family") {
        if (value === "__current") return;
        const font = FONTS.find(f => f.name === value);
        if (font) ensureFontLink(font);
        value = font ? fontStack(font) : "";
      }
      if (prop === "font-size" && value) value = `${value}px`;
      setStyle(el, prop, value); renderInspector();
    }));
    const colorInput = box.querySelector('input[type="color"][data-style="color"]');
    colorInput?.addEventListener("input", event => setStyle(el, "color", event.target.value));
    colorInput?.addEventListener("change", () => renderInspector());
    box.querySelectorAll("[data-color]").forEach(swatch => swatch.addEventListener("click", () => { setStyle(el, "color", swatch.dataset.color); renderInspector(); }));
  }

  /* ------------------------------------------------------------------ images */

  function applyImageUrl(el, url) {
    el.setAttribute("src", url); el.removeAttribute("srcset"); el.removeAttribute("sizes"); el.removeAttribute("data-full-src");
    const picture = el.closest("picture"); picture?.querySelectorAll("source").forEach(s => s.remove());
    markDirty();
  }
  // the bytes go straight to the Worker, which puts them in Shopify Files; XHR because fetch has no upload progress
  async function uploadPicture(file, alt, onState) {
    const headers = await authHeaders();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/page-editor/upload?filename=${encodeURIComponent(file.name)}&alt=${encodeURIComponent(alt)}`);
      Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.timeout = 90000;
      xhr.upload.addEventListener("progress", event => { if (event.lengthComputable) onState(`Uploading… ${Math.round(event.loaded / event.total * 100)}%`); });
      xhr.upload.addEventListener("load", () => onState("Processing… Shopify is preparing the picture."));
      xhr.addEventListener("error", () => reject(new Error("The upload did not reach the server. Check the connection and try again.")));
      xhr.addEventListener("timeout", () => reject(new Error("The upload took too long. Try a smaller picture.")));
      xhr.addEventListener("load", () => {
        let payload = {};
        try { payload = JSON.parse(xhr.responseText || "{}"); } catch { payload = {}; }
        if (xhr.status >= 200 && xhr.status < 300 && payload.url) resolve(payload);
        else reject(new Error(payload.error || `The server answered HTTP ${xhr.status}.`));
      });
      onState("Uploading… 0%");
      xhr.send(file);
    });
  }
  function wireImageInspector(box, el) {
    byId("insp-src").addEventListener("change", event => {
      const url = event.target.value.trim(); if (!/^https?:\/\//.test(url)) return;
      applyImageUrl(el, url); renderPreview(); renderInspector();
    });
    byId("insp-alt").addEventListener("change", event => { el.setAttribute("alt", event.target.value); markDirty(); });
    byId("insp-file").addEventListener("change", async event => {
      const input = event.currentTarget;
      const file = input.files && input.files[0];
      if (!file) return;
      const note = byId("insp-upload-state");
      if (!UPLOAD_TYPES.has(file.type)) { note.textContent = "Only PNG, JPG or WEBP pictures can be uploaded."; input.value = ""; return; }
      if (file.size > MAX_UPLOAD_BYTES) { note.textContent = `That file is ${(file.size / 1048576).toFixed(1)} MB; the limit is 8 MB.`; input.value = ""; return; }
      input.disabled = true; note.classList.add("is-busy");
      try {
        const result = await uploadPicture(file, byId("insp-alt").value.trim(), text => { note.textContent = text; });
        applyImageUrl(el, result.url);
        if (result.alt && !el.getAttribute("alt")) el.setAttribute("alt", result.alt);
        renderPreview(); renderInspector();
        const done = byId("insp-upload-state");
        if (done) done.textContent = `Done: ${file.name} is on the page${result.width && result.height ? ` (${result.width}×${result.height})` : ""}. Save a draft or publish to keep it.`;
      } catch (error) {
        note.classList.remove("is-busy"); note.textContent = `Upload failed: ${error.message}`;
        input.disabled = false; input.value = "";
      }
    });
    box.querySelectorAll("select[data-image]").forEach(select => select.addEventListener("change", event => {
      const prop = select.dataset.image, value = event.target.value;
      if (prop === "width") el.style.setProperty("height", value ? "auto" : ""); // keep the picture's proportions at the new width
      setStyle(el, prop, value);
    }));
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
    if (!el) { kind.textContent = "CLICK ANYTHING IN THE PREVIEW"; box.innerHTML = '<p class="muted">Click a text or an image in the preview. Double-click text to type straight into the page; font, size, colour and pictures change here.</p>'; return; }
    const path = [el.tagName.toLowerCase(), el.id ? `#${el.id}` : "", el.className ? `.${String(el.className).trim().split(/\s+/).slice(0, 2).join(".")}` : ""].join("");
    const option = (value, label, current) => `<option value="${escape(value)}"${String(value) === String(current) ? " selected" : ""}>${escape(label)}</option>`;
    if (el.tagName === "IMG") {
      kind.textContent = "IMAGE";
      const width = el.style.getPropertyValue("width"), radius = el.style.getPropertyValue("border-radius");
      box.innerHTML = `<div class="editor-inspector">
        <img src="${escape(el.getAttribute("src") || "")}" alt="">
        <label>Upload a picture<input type="file" id="insp-file" accept="image/png,image/jpeg,image/webp"></label>
        <p class="muted editor-upload-state" id="insp-upload-state">PNG, JPG or WEBP up to 8 MB. It goes to Shopify Files and replaces every size variant of this image.</p>
        <label>Image URL<input id="insp-src" value="${escape(el.getAttribute("src") || "")}" placeholder="https://cdn.shopify.com/…"></label>
        <label>Alt text<input id="insp-alt" value="${escape(el.getAttribute("alt") || "")}"></label>
        <div class="editor-format__grid">
          <label>Width<select data-image="width">${IMAGE_WIDTHS.map(([value, label]) => option(value, label, width)).join("")}</select></label>
          <label>Corners<select data-image="border-radius">${IMAGE_RADII.map(([value, label]) => option(value, label, radius)).join("")}</select></label>
        </div>
        <div class="editor-path">${escape(path)}</div></div>`;
      wireImageInspector(box, el);
      return;
    }
    const isText = TEXT_TAGS.has(el.tagName);
    kind.textContent = isText ? "TEXT" : "ELEMENT";
    const linkField = el.tagName === "A" ? `<label>Link<input id="insp-href" value="${escape(el.getAttribute("href") || "")}"></label>` : "";
    box.innerHTML = `<div class="editor-inspector">
      <label>Text<textarea id="insp-text">${escape(el.innerText || el.textContent || "")}</textarea></label>
      ${linkField}
      ${isText ? formatToolbar(el) : ""}
      <p class="muted" style="font-size:12px;">Editing the text here replaces it whole. Double-click in the preview to keep bold and links; select words there and press B, I or U to style just those.</p>
      <div class="editor-path">${escape(path)}</div></div>`;
    byId("insp-text").addEventListener("change", event => { el.textContent = event.target.value; markDirty(); renderPreview(); renderSections(); });
    byId("insp-href")?.addEventListener("change", event => { el.setAttribute("href", event.target.value.trim()); markDirty(); });
    if (isText) wireFormatToolbar(box, el);
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
