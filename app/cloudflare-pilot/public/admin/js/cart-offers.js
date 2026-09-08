(function () {
  "use strict";

  var state = null;
  var activePicker = null;
  var searchTimer = 0;
  var itemTemplate = document.getElementById("offer-item-template");
  var status = document.getElementById("status");
  var picker = document.getElementById("product-picker");
  var search = document.getElementById("product-search");
  var results = document.getElementById("picker-results");

  function setStatus(message, error) {
    status.textContent = message || "";
    status.classList.toggle("error", Boolean(error));
  }

  function escapeText(value) {
    return String(value == null ? "" : value);
  }

  function newId(kind) {
    var suffix = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID().slice(0, 8)
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return kind + "-" + suffix;
  }

  function blankItem(kind) {
    return {
      id: newId(kind), kind: kind, enabled: true, position: 0,
      productId: "", variantId: "", productTitle: "", variantTitle: "",
      title: "", priceIls: "", compareAtIls: "", anchorText: kind === "carousel" ? "מחיר בהוספה" : "",
      buttonText: kind === "carousel" ? "הוספה" : "הוסיפי להזמנה",
      imageUrl: "", imageAlt: "", storefrontPriceIls: "", discountNodeId: ""
    };
  }

  function listFor(kind) {
    return kind === "carousel" ? state.carousel : state.bumps;
  }

  function itemAt(kind, id) {
    return listFor(kind).find(function (item) { return item.id === id; });
  }

  function updatePositions(list) {
    list.forEach(function (item, index) { item.position = index; });
  }

  function renderItem(item, index, total) {
    var node = itemTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.kind = item.kind;
    node.dataset.id = item.id;
    var image = node.querySelector(".offer-image");
    if (item.imageUrl) image.src = item.imageUrl;
    image.alt = item.imageAlt || item.title || "";
    node.querySelector(".selected-product").textContent = item.productTitle || "לא נבחר מוצר";
    node.querySelector(".selected-variant").textContent = item.variantTitle || "";
    node.querySelector(".shopify-price").textContent = item.storefrontPriceIls
      ? "מחיר נוכחי בחנות: ₪" + item.storefrontPriceIls
      : "";
    node.querySelector(".move-up").disabled = index === 0;
    node.querySelector(".move-down").disabled = index === total - 1;
    node.querySelectorAll("[data-field]").forEach(function (input) {
      var field = input.dataset.field;
      if (input.type === "checkbox") input.checked = item[field] !== false;
      else input.value = item[field] || "";
      input.addEventListener("input", function () {
        item[field] = input.type === "checkbox" ? input.checked : input.value;
        setStatus("יש שינויים שעדיין לא נשמרו.", false);
      });
    });
    node.querySelector(".choose-product").addEventListener("click", function () { openPicker(item.kind, item.id); });
    node.querySelector(".remove-item").addEventListener("click", function () {
      var list = listFor(item.kind);
      list.splice(list.indexOf(item), 1);
      updatePositions(list);
      render();
      setStatus("הפריט הוסר מהטיוטה.", false);
    });
    node.querySelector(".move-up").addEventListener("click", function () { moveItem(item.kind, item.id, -1); });
    node.querySelector(".move-down").addEventListener("click", function () { moveItem(item.kind, item.id, 1); });
    return node;
  }

  function renderList(kind, targetId) {
    var list = listFor(kind);
    var target = document.getElementById(targetId);
    target.replaceChildren.apply(target, list.map(function (item, index) { return renderItem(item, index, list.length); }));
  }

  function render() {
    if (!state) return;
    document.getElementById("carousel-title").value = state.carouselTitle || "";
    renderList("carousel", "carousel-list");
    renderList("bump", "bump-list");
  }

  function moveItem(kind, id, delta) {
    var list = listFor(kind);
    var index = list.findIndex(function (item) { return item.id === id; });
    var next = index + delta;
    if (index < 0 || next < 0 || next >= list.length) return;
    var moved = list.splice(index, 1)[0];
    list.splice(next, 0, moved);
    updatePositions(list);
    render();
    setStatus("סדר הפריטים השתנה בטיוטה.", false);
  }

  function addItem(kind) {
    var max = kind === "carousel" ? 12 : 8;
    var list = listFor(kind);
    if (list.length >= max) return setStatus("הגעת למספר הפריטים המרבי באזור הזה.", true);
    list.push(blankItem(kind));
    updatePositions(list);
    render();
    openPicker(kind, list[list.length - 1].id);
  }

  function openPicker(kind, id) {
    activePicker = { kind: kind, id: id };
    picker.hidden = false;
    search.value = "";
    results.innerHTML = '<p class="muted">טוען מוצרים...</p>';
    search.focus();
    loadProducts("");
  }

  function closePicker() {
    picker.hidden = true;
    activePicker = null;
  }

  function productResult(product) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "picker-result";
    button.setAttribute("role", "listitem");
    var img = document.createElement("img");
    if (product.imageUrl) img.src = product.imageUrl;
    img.alt = product.imageAlt || "";
    var copy = document.createElement("span");
    var title = document.createElement("strong");
    title.textContent = product.productTitle;
    var variant = document.createElement("span");
    variant.className = "muted";
    variant.textContent = product.variantTitle + (product.availableForSale ? "" : " · לא זמין");
    copy.append(title, variant);
    var price = document.createElement("bdi");
    price.className = "picker-result-price";
    price.textContent = product.currency === "ILS" ? "₪" + product.priceIls : product.priceIls + " " + product.currency;
    button.append(img, copy, price);
    button.disabled = !product.availableForSale || product.currency !== "ILS";
    button.addEventListener("click", function () { chooseProduct(product); });
    return button;
  }

  async function loadProducts(query) {
    results.innerHTML = '<p class="muted">מחפש בחנות...</p>';
    try {
      var data = await API.get("/api/cart-offers/products?query=" + encodeURIComponent(query || ""));
      if (!data.products.length) {
        results.innerHTML = '<p class="muted">לא נמצאו מוצרים.</p>';
        return;
      }
      results.replaceChildren.apply(results, data.products.map(productResult));
    } catch (error) {
      results.innerHTML = '<p class="error-msg">לא ניתן לטעון מוצרים כרגע.</p>';
    }
  }

  function chooseProduct(product) {
    if (!activePicker) return;
    var item = itemAt(activePicker.kind, activePicker.id);
    if (!item) return closePicker();
    item.productId = product.productId;
    item.variantId = product.variantId;
    item.productTitle = product.productTitle;
    item.variantTitle = product.variantTitle;
    item.title = item.title || product.productTitle;
    item.priceIls = item.priceIls || product.priceIls;
    item.compareAtIls = item.compareAtIls || product.compareAtIls || product.priceIls;
    item.imageUrl = product.imageUrl;
    item.imageAlt = product.imageAlt || product.productTitle;
    item.storefrontPriceIls = product.priceIls;
    item.discountNodeId = "";
    closePicker();
    render();
    setStatus("המוצר נבחר. השינוי נמצא בטיוטה בלבד.", false);
  }

  function configFromForm() {
    state.carouselTitle = document.getElementById("carousel-title").value.trim();
    updatePositions(state.carousel);
    updatePositions(state.bumps);
    return state;
  }

  function setBusy(busy) {
    document.getElementById("save-draft").disabled = busy;
    document.getElementById("publish").disabled = busy;
  }

  async function saveDraft() {
    setBusy(true);
    setStatus("שומר טיוטה...", false);
    try {
      var data = await API.put("/api/cart-offers/draft", { config: configFromForm() });
      state = data.draft;
      document.getElementById("revision-copy").textContent = "טיוטה " + data.draftRevision + " · גרסה מפורסמת " + data.publishedRevision;
      render();
      setStatus("הטיוטה נשמרה. החנות לא השתנתה.", false);
    } catch (error) {
      setStatus(error.message || "שמירת הטיוטה נכשלה.", true);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setStatus("שומר, מאמת מול Shopify ומפרסם לחנות...", false);
    try {
      var data = await API.post("/api/cart-offers/publish", { config: configFromForm() });
      state = data.draft;
      document.getElementById("revision-copy").textContent = "טיוטה " + data.draftRevision + " · גרסה מפורסמת " + data.publishedRevision;
      render();
      setStatus(data.cleanupErrors && data.cleanupErrors.length
        ? "פורסם, אך נותרה הנחה ישנה לניקוי ידני."
        : "פורסם בהצלחה לחנות · גרסה " + data.publishedRevision + ".", Boolean(data.cleanupErrors && data.cleanupErrors.length));
    } catch (error) {
      setStatus(error.message || "הפרסום נכשל. החנות נשארה בגרסה הקודמת.", true);
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    setBusy(true);
    try {
      var data = await API.get("/api/cart-offers");
      state = data.draft;
      document.getElementById("revision-copy").textContent = "טיוטה " + data.draftRevision + " · גרסה מפורסמת " + data.publishedRevision;
      render();
      setStatus("שינויים נשמרים כטיוטה עד לחיצה על פרסום לחנות.", false);
    } catch (error) {
      setStatus(error.message || "לא ניתן לטעון את ההצעות.", true);
    } finally {
      setBusy(false);
    }
  }

  document.getElementById("carousel-title").addEventListener("input", function () { setStatus("יש שינויים שעדיין לא נשמרו.", false); });
  document.getElementById("add-carousel").addEventListener("click", function () { addItem("carousel"); });
  document.getElementById("add-bump").addEventListener("click", function () { addItem("bump"); });
  document.getElementById("save-draft").addEventListener("click", saveDraft);
  document.getElementById("publish").addEventListener("click", publish);
  document.getElementById("close-picker").addEventListener("click", closePicker);
  picker.addEventListener("click", function (event) { if (event.target === picker) closePicker(); });
  search.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { loadProducts(search.value.trim()); }, 280);
  });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape" && !picker.hidden) closePicker(); });

  init();
})();


