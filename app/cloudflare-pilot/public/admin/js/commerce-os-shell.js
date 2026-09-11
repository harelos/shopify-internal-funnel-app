(function () {
  "use strict";
  var path = String(window.location.pathname || "").split("/").pop() || "index.html";
  var routes = [
    ["index.html", "Overview"],
    ["growth-cockpit.html", "Growth"],
    ["journeys.html", "Journeys"],
    ["ai-concierge.html", "Experiences"],
    ["element-experiments.html", "Experiments"],
    ["support.html", "Support"],
    ["operations.html", "Operations"],
    ["shipment-control.html", "Shipments"],
  ];
  var utilities = [
    ["cart-offers.html", "Cart offers"],
    ["popup-analytics.html", "Popup analytics"],
    ["analytics.html", "Analytics"],
    ["funnel.html", "Funnels"],
  ];
  function link(route, utility) {
    var item = document.createElement("a");
    item.href = route[0];
    item.textContent = route[1];
    if (route[0] === path) item.setAttribute("aria-current", "page");
    if (utility) item.className = "commerce-os-utility";
    return item;
  }
  function createNav(standalone) {
    var nav = document.createElement("nav");
    nav.className = standalone ? "commerce-os-standalone commerce-os-nav" : "commerce-os-nav";
    nav.setAttribute("aria-label", "Commerce OS navigation");
    if (standalone) {
      var brand = document.createElement("a");
      brand.className = "commerce-os-wordmark";
      brand.href = "index.html";
      brand.textContent = "Commerce OS";
      nav.appendChild(brand);
    }
    routes.forEach(function (route) { nav.appendChild(link(route, false)); });
    utilities.forEach(function (route) { nav.appendChild(link(route, true)); });
    return nav;
  }
  function mount() {
    if (document.querySelector(".commerce-os-nav")) return;
    document.body.classList.add("commerce-os-page");
    var topBar = document.querySelector(".top-bar");
    if (topBar) { topBar.appendChild(createNav(false)); return; }
    var supportHeader = document.querySelector(".support-header");
    if (supportHeader) { supportHeader.insertAdjacentElement("afterend", createNav(true)); return; }
    var first = document.body.firstElementChild;
    document.body.insertBefore(createNav(true), first);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}());
