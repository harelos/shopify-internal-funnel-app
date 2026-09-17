/**
 * One reporting-window definition for every dashboard.
 *
 * Each page used to compute its own day boundaries, so the same question asked
 * on two screens could return two answers. This owns the timezone maths, the
 * presets and the custom range, and hands every caller the identical
 * { from, to } pair it sends to the API.
 */
(() => {
  const TIMEZONE = "Asia/Jerusalem";

  const PRESETS = [
    { id: "today", label: "Today", days: 1 },
    { id: "yesterday", label: "Yesterday", days: 1, offset: 1 },
    { id: "last_7_days", label: "Last 7 days", days: 7 },
    { id: "last_30_days", label: "Last 30 days", days: 30 },
    { id: "last_90_days", label: "Last 90 days", days: 90 },
    { id: "month_to_date", label: "This month", monthToDate: true },
  ];

  function zoneParts(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  }

  // Converts a wall-clock time in the reporting timezone into a real instant.
  function zonedToUtc(parts) {
    const expected = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
    let timestamp = expected;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const seen = zoneParts(new Date(timestamp));
      const seenTimestamp = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
      timestamp -= seenTimestamp - expected;
    }
    return new Date(timestamp);
  }

  const startOfLocalDay = label => {
    const [year, month, day] = label.split("-").map(Number);
    return zonedToUtc({ year, month, day, hour: 0, minute: 0, second: 0 });
  };
  const endOfLocalDay = label => {
    const [year, month, day] = label.split("-").map(Number);
    return zonedToUtc({ year, month, day, hour: 23, minute: 59, second: 59 });
  };
  const localDayLabel = (date = new Date()) => {
    const parts = zoneParts(date);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  };
  const shiftDays = (label, delta) => {
    const [year, month, day] = label.split("-").map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + delta));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
  };

  function resolve(selection) {
    const today = localDayLabel();
    if (selection.id === "custom") {
      const fromLabel = selection.fromLabel;
      const toLabel = selection.toLabel;
      if (!fromLabel || !toLabel || fromLabel > toLabel) return null;
      return { fromLabel, toLabel, label: fromLabel === toLabel ? fromLabel : `${fromLabel} → ${toLabel}` };
    }
    const preset = PRESETS.find(entry => entry.id === selection.id) || PRESETS[0];
    if (preset.monthToDate) {
      const parts = zoneParts(new Date());
      const first = `${parts.year}-${String(parts.month).padStart(2, "0")}-01`;
      return { fromLabel: first, toLabel: today, label: preset.label };
    }
    const toLabel = preset.offset ? shiftDays(today, -preset.offset) : today;
    const fromLabel = shiftDays(toLabel, -(preset.days - 1));
    return { fromLabel, toLabel, label: preset.label };
  }

  function windowFor(selection) {
    const resolved = resolve(selection) || resolve({ id: "today" });
    const now = new Date();
    const end = endOfLocalDay(resolved.toLabel);
    return {
      ...resolved,
      timezone: TIMEZONE,
      from: startOfLocalDay(resolved.fromLabel).toISOString(),
      // Never claim coverage past the present moment for a window that includes today.
      to: (end > now ? now : end).toISOString(),
    };
  }

  function readStored(storageKey) {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (stored && (stored.id === "custom" || PRESETS.some(entry => entry.id === stored.id))) return stored;
    } catch { /* fall through to the default */ }
    return null;
  }

  function mount(container, options = {}) {
    const storageKey = options.storageKey || "fc.reportingWindow";
    let selection = readStored(storageKey) || { id: options.defaultPreset || "today" };

    container.classList.add("range-picker");
    container.innerHTML = `
      <div class="range-picker__presets" role="group" aria-label="Reporting window">
        ${PRESETS.map(preset => `<button class="range-button" type="button" data-preset="${preset.id}">${preset.label}</button>`).join("")}
        <button class="range-button" type="button" data-preset="custom">Custom</button>
      </div>
      <div class="range-picker__custom" hidden>
        <label>From <input type="date" data-role="from"></label>
        <label>To <input type="date" data-role="to"></label>
        <button class="range-button range-button--apply" type="button" data-role="apply">Apply</button>
        <span class="range-picker__error" data-role="error" hidden>Choose a start date on or before the end date.</span>
      </div>`;

    const customPanel = container.querySelector(".range-picker__custom");
    const fromInput = container.querySelector('[data-role="from"]');
    const toInput = container.querySelector('[data-role="to"]');
    const errorNote = container.querySelector('[data-role="error"]');

    function paint() {
      container.querySelectorAll("[data-preset]").forEach(button => {
        button.classList.toggle("active", button.dataset.preset === selection.id);
      });
      customPanel.hidden = selection.id !== "custom";
      const today = localDayLabel();
      fromInput.max = today;
      toInput.max = today;
      if (selection.id === "custom") {
        fromInput.value = selection.fromLabel || "";
        toInput.value = selection.toLabel || "";
      }
    }

    function emit() {
      try { localStorage.setItem(storageKey, JSON.stringify(selection)); } catch { /* preference only */ }
      paint();
      options.onChange?.(windowFor(selection));
    }

    container.querySelectorAll("[data-preset]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.preset;
        if (id === "custom") {
          const today = localDayLabel();
          selection = { id: "custom", fromLabel: selection.fromLabel || shiftDays(today, -6), toLabel: selection.toLabel || today };
          errorNote.hidden = true;
          paint();
          return;
        }
        selection = { id };
        emit();
      });
    });

    container.querySelector('[data-role="apply"]').addEventListener("click", () => {
      const fromLabel = fromInput.value;
      const toLabel = toInput.value;
      if (!fromLabel || !toLabel || fromLabel > toLabel) { errorNote.hidden = false; return; }
      errorNote.hidden = true;
      selection = { id: "custom", fromLabel, toLabel };
      emit();
    });

    paint();
    return { current: () => windowFor(selection), refresh: () => options.onChange?.(windowFor(selection)) };
  }

  window.RangePicker = { mount, windowFor, localDayLabel, timezone: TIMEZONE };
})();
