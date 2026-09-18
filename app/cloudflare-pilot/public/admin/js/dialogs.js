/**
 * In-page replacements for alert(), confirm() and prompt().
 *
 * The admin runs inside Shopify's embedded-app iframe, where native browser
 * dialogs are unreliable: Chrome has been removing them from cross-origin
 * frames, and a blocked prompt() returns null so a "Publish" click would do
 * nothing. Every question the admin asks goes through here instead. Each call
 * returns a promise: alert → undefined, confirm → true/false, prompt → the
 * text or null when cancelled. Escape cancels, Enter confirms.
 */
(function () {
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  let styled = false;
  function ensureStyle() {
    if (styled) return; styled = true;
    const style = document.createElement("style");
    style.textContent = `
      .app-dialog { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; background: rgba(23,35,30,.55); backdrop-filter: blur(2px); padding: 16px; }
      .app-dialog__box { background: var(--card, #fff); color: var(--ink, #1a1a1a); border: 1px solid var(--ink, #1a1a1a); border-radius: var(--radius, 10px); padding: 22px 24px; width: 100%; max-width: 460px; box-shadow: 0 16px 40px rgba(0,0,0,.25); font: inherit; }
      .app-dialog__box h2 { margin: 0 0 10px; font-size: 17px; font-weight: 800; }
      .app-dialog__text { margin: 0 0 8px; font-size: 14px; line-height: 1.5; color: var(--ink, #1a1a1a); overflow-wrap: anywhere; }
      .app-dialog__input { width: 100%; box-sizing: border-box; margin-top: 8px; padding: 9px 11px; border: 1px solid var(--line, #ddd); border-radius: var(--radius, 8px); font: inherit; font-size: 14px; }
      .app-dialog__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
      .app-dialog__actions .btn { min-width: 84px; }
    `;
    document.head.appendChild(style);
  }

  function open({ kind, title, text, defaultValue, okLabel, cancelLabel }) {
    ensureStyle();
    return new Promise(resolve => {
      const root = document.createElement("div");
      root.className = "app-dialog";
      root.setAttribute("data-dialog-kind", kind);
      const paragraphs = String(text ?? "").split(/\n+/).filter(Boolean).map(line => `<p class="app-dialog__text">${escape(line)}</p>`).join("");
      root.innerHTML = `
        <div class="app-dialog__box" role="${kind === "alert" ? "alertdialog" : "dialog"}" aria-modal="true" aria-label="${escape(title || text || "")}">
          ${title ? `<h2>${escape(title)}</h2>` : ""}
          ${paragraphs}
          ${kind === "prompt" ? `<input class="app-dialog__input" type="text" value="${escape(defaultValue)}" autocomplete="off">` : ""}
          <div class="app-dialog__actions">
            ${kind === "alert" ? "" : `<button class="btn" type="button" data-dialog="cancel">${escape(cancelLabel)}</button>`}
            <button class="btn btn-primary" type="button" data-dialog="ok">${escape(okLabel)}</button>
          </div>
        </div>`;
      const input = root.querySelector(".app-dialog__input");
      const previous = document.activeElement;
      const finish = value => {
        document.removeEventListener("keydown", onKey, true);
        root.remove();
        if (previous && typeof previous.focus === "function") { try { previous.focus(); } catch (_) { /* element gone */ } }
        resolve(value);
      };
      const ok = () => finish(kind === "prompt" ? input.value : kind === "confirm" ? true : undefined);
      const cancel = () => finish(kind === "prompt" ? null : kind === "confirm" ? false : undefined);
      const onKey = event => {
        if (event.key === "Escape") { event.preventDefault(); cancel(); }
        else if (event.key === "Enter" && (kind !== "prompt" || event.target === input)) { event.preventDefault(); ok(); }
      };
      root.querySelector('[data-dialog="ok"]').addEventListener("click", ok);
      root.querySelector('[data-dialog="cancel"]')?.addEventListener("click", cancel);
      root.addEventListener("click", event => { if (event.target === root) cancel(); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(root);
      (input || root.querySelector('[data-dialog="ok"]')).focus();
      if (input) input.select();
    });
  }

  window.Dialogs = {
    alert: (text, options = {}) => open({ kind: "alert", title: options.title || "", text, okLabel: options.okLabel || "OK" }),
    confirm: (text, options = {}) => open({ kind: "confirm", title: options.title || "Please confirm", text, okLabel: options.okLabel || "Yes", cancelLabel: options.cancelLabel || "Cancel" }),
    prompt: (text, defaultValue = "", options = {}) => open({ kind: "prompt", title: options.title || "", text, defaultValue, okLabel: options.okLabel || "Continue", cancelLabel: options.cancelLabel || "Cancel" }),
  };
})();
