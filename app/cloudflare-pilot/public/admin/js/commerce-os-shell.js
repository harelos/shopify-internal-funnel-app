/**
 * The shared shell: one header and one row of tabs on every admin page.
 *
 * Older pages carried their own top bar ("Funnel Control · Element A/B Lab")
 * and the Overview carried a different one ("Commerce OS"), each with its own
 * list of tabs, so moving between pages felt like moving between apps. This
 * script removes whatever header the page shipped with, keeps any working
 * controls that lived in it (publish buttons, connection pill) and mounts the
 * same header and tabs everywhere. Styling lives in css/os-base.css.
 */
(function () {
  "use strict";
  var path = String(window.location.pathname || "").split("/").pop() || "index.html";
  var PRIMARY = [
    ["index.html", "Overview"],
    ["growth-cockpit.html", "Insights"],
    ["journeys.html", "Journeys"],
    ["live.html", "Live"],
    ["ai-concierge.html", "Experiences"],
    ["element-experiments.html", "Experiments"],
    ["support.html", "Support"],
    ["operations.html", "Operations"],
    ["shipment-control.html", "Shipments"],
  ];
  var TOOLS = [
    ["funnel-stats.html", "Funnels"],
    ["cart-offers.html", "Cart offers"],
    ["popup-analytics.html", "Popup analytics"],
    ["page-editor.html", "Page editor"],
    ["analytics.html", "Analytics"],
  ];
  // pages reached from a tab but not listed themselves light up their parent tab
  var PARENT = { "funnel.html": "funnel-stats.html", "editor.html": "page-editor.html" };
  var current = PARENT[path] || path;

  function link(route, tool) {
    var a = document.createElement("a");
    a.href = route[0];
    a.textContent = route[1];
    if (tool) a.className = "os-tabs__tool";
    if (route[0] === current) a.setAttribute("aria-current", "page");
    return a;
  }

  function buildHeader() {
    var header = document.createElement("header");
    header.className = "os-top";
    var row = document.createElement("div");
    row.className = "os-top__row";
    var brand = document.createElement("a");
    brand.className = "os-brand";
    brand.href = "index.html";
    brand.innerHTML = '<span class="os-brand__mark" aria-hidden="true">FC</span><span class="os-brand__name">Funnel Control</span><span class="os-brand__sub">Tiger Brands</span>';
    var actions = document.createElement("div");
    actions.className = "os-top__actions";
    actions.id = "os-top-actions";
    row.appendChild(brand);
    row.appendChild(actions);
    header.appendChild(row);
    return { header: header, actions: actions };
  }

  function buildTabs() {
    var nav = document.createElement("nav");
    nav.className = "os-tabs";
    nav.setAttribute("aria-label", "Funnel Control sections");
    PRIMARY.forEach(function (route) { nav.appendChild(link(route, false)); });
    var sep = document.createElement("span");
    sep.className = "os-tabs__sep";
    sep.setAttribute("aria-hidden", "true");
    nav.appendChild(sep);
    TOOLS.forEach(function (route) { nav.appendChild(link(route, true)); });
    return nav;
  }

  /* Keep working controls from the page's own header, drop the rest. */
  function salvage(actions) {
    var moved = [];
    var topBar = document.querySelector(".top-bar");
    if (topBar) {
      // the page's own brand link goes; anything else in the brand area is a
      // working control (the funnel name and status on the builder page) and stays
      var brandName = topBar.querySelector("a.brand-name");
      Array.prototype.slice.call(topBar.querySelectorAll(".brand > *, .top-actions > *")).forEach(function (node) {
        if (node === brandName) return;
        if (node.classList && node.classList.contains("eyebrow")) return; // the page name; the tab says it
        moved.push(node);
      });
      moved.forEach(function (node) { actions.appendChild(node); });
      topBar.parentNode.removeChild(topBar);
    }
    var osHeader = document.querySelector(".os-header");
    if (osHeader) {
      var pill = osHeader.querySelector(".connection-pill");
      if (pill) actions.appendChild(pill);
      osHeader.parentNode.removeChild(osHeader);
    }
    var osNav = document.querySelector("nav.os-nav");
    if (osNav) osNav.parentNode.removeChild(osNav);
    var oldNav = document.querySelector(".commerce-os-nav");
    if (oldNav) oldNav.parentNode.removeChild(oldNav);
  }

  function mount() {
    if (document.querySelector(".os-tabs")) return;
    document.body.classList.add("commerce-os-page", "os-page");
    var built = buildHeader();
    salvage(built.actions);
    var tabs = buildTabs();
    var first = document.body.firstChild;
    document.body.insertBefore(tabs, first);
    document.body.insertBefore(built.header, tabs);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}());
