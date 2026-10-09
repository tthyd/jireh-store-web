(() => {
  "use strict";

  const CFG = window.JIREH_CONFIG;
  const CART_KEY = "jireh-cart-v1";
  const $ = (sel) => document.querySelector(sel);

  const state = {
    products: [],
    byId: new Map(),
    cart: loadCart(), // { [productId]: qty }
    category: "Todos",
    query: "",
    modalProduct: null,
    modalQty: 1,
  };

  const money = new Intl.NumberFormat(CFG.locale, {
    style: "currency",
    currency: CFG.currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  const fmt = (n) => money.format(n);

  // ------------------------------------------------------------
  //  Carga de productos (Google Sheets CSV o archivo local)
  // ------------------------------------------------------------
  async function loadProducts() {
    const url = CFG.sheetCsvUrl
      ? CFG.sheetCsvUrl + (CFG.sheetCsvUrl.includes("?") ? "&" : "?") + "t=" + Date.now()
      : "data/productos.csv";

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const rows = parseCSV(await res.text());
    if (rows.length < 2) return [];

    const headers = rows[0].map(normalizeKey);
    return rows
      .slice(1)
      .map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()])))
      .map(toProduct)
      .filter((p) => p && p.active);
  }

  function toProduct(row, index) {
    const name = row.nombre || row.producto || row.name;
    if (!name) return null;
    const stockRaw = row.stock ?? "";
    return {
      id: String(row.id || index + 1),
      name,
      description: row.descripcion || row.description || "",
      price: parsePrice(row.precio || row.price),
      // Stock vacío = sin control de stock (ilimitado)
      stock: stockRaw === "" ? Infinity : Math.max(0, parseInt(stockRaw, 10) || 0),
      category: row.categoria || row.category || "Otros",
      image: row.imagen || row.image || row.foto || `img/productos/${String(row.id || index + 1)}.jpg`,
      active: !/^(no|false|0|n)$/i.test(row.activo ?? row.active ?? ""),
    };
  }

  // Acepta "18500", "18.500", "$ 18.500,50", "18,500.50"
  function parsePrice(value) {
    let s = String(value || "").replace(/[^\d.,-]/g, "");
    if (!s) return 0;
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot > -1 && lastComma > -1) {
      const dec = lastDot > lastComma ? "." : ",";
      const thou = dec === "." ? "," : ".";
      s = s.split(thou).join("").replace(dec, ".");
    } else if (lastComma > -1) {
      // "18,50" -> decimal ; "18,500" -> miles
      s = /,\d{1,2}$/.test(s) && s.split(",").length === 2 ? s.replace(",", ".") : s.split(",").join("");
    } else if (lastDot > -1) {
      s = /\.\d{1,2}$/.test(s) && s.split(".").length === 2 ? s : s.split(".").join("");
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeKey(k) {
    return k.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  // Parser CSV que soporta comillas, comas y saltos de línea dentro de celdas
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  // ------------------------------------------------------------
  //  Render de productos
  // ------------------------------------------------------------
  function renderCategories() {
    const cats = ["Todos", ...new Set(state.products.map((p) => p.category))];
    const wrap = $("#categories");
    wrap.innerHTML = "";
    if (cats.length <= 2) return; // no tiene sentido filtrar con una sola categoría
    for (const c of cats) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = c;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(c === state.category));
      b.onclick = () => { state.category = c; renderCategories(); renderProducts(); };
      wrap.appendChild(b);
    }
  }

  function renderProducts() {
    const q = normalizeKey(state.query);
    const list = state.products.filter((p) =>
      (state.category === "Todos" || p.category === state.category) &&
      (!q || normalizeKey(p.name + " " + p.description + " " + p.category).includes(q))
    );

    $("#status").textContent = list.length ? "" : "No encontramos productos.";
    const grid = $("#products");
    grid.innerHTML = list.map(cardHTML).join("");
  }

  function cardHTML(p) {
    const out = p.stock <= 0;
    const low = !out && p.stock <= 3;
    const badge = out
      ? '<span class="badge out">Sin stock</span>'
      : low ? `<span class="badge low">¡Últimas ${p.stock}!</span>` : "";
    return `
      <article class="card ${out ? "soldout" : ""}">
        <button class="card-media" data-open="${esc(p.id)}" aria-label="Ver ${esc(p.name)}">
          <img src="${esc(p.image || CFG.placeholderImage)}" alt="${esc(p.name)}" loading="lazy"
               onerror="this.onerror=null;this.src='${CFG.placeholderImage}'" />
          ${badge}
        </button>
        <div class="card-body">
          <span class="card-cat">${esc(p.category)}</span>
          <h3 class="card-title">${esc(p.name)}</h3>
          <p class="card-desc">${esc(p.description)}</p>
          <div class="card-foot">
            <span class="card-price">${fmt(p.price)}</span>
            <button class="btn btn-primary btn-small" data-add="${esc(p.id)}" ${out ? "disabled" : ""}>
              ${out ? "Agotado" : "Agregar"}
            </button>
          </div>
        </div>
      </article>`;
  }

  // ------------------------------------------------------------
  //  Modal de producto
  // ------------------------------------------------------------
  function openProduct(id) {
    const p = state.byId.get(id);
    if (!p) return;
    state.modalProduct = p;
    state.modalQty = 1;
    const img = $("#pmImage");
    img.src = p.image || CFG.placeholderImage;
    img.alt = p.name;
    img.onerror = () => { img.onerror = null; img.src = CFG.placeholderImage; };
    $("#pmCategory").textContent = p.category;
    $("#pmTitle").textContent = p.name;
    $("#pmPrice").textContent = fmt(p.price);
    $("#pmDesc").textContent = p.description;
    $("#pmStock").textContent =
      p.stock === Infinity ? "" : p.stock <= 0 ? "Sin stock por el momento" : `Stock disponible: ${p.stock}`;
    updateModalQty();
    openOverlay("#productOverlay");
  }

  function updateModalQty() {
    const p = state.modalProduct;
    const available = p.stock - (state.cart[p.id] || 0);
    $("#pmQty").textContent = state.modalQty;
    $("#pmMinus").disabled = state.modalQty <= 1;
    $("#pmPlus").disabled = state.modalQty >= available;
    $("#pmAdd").disabled = available <= 0;
    $("#pmAdd").textContent = p.stock <= 0 ? "Agotado" : available <= 0 ? "Ya tenés todo el stock" : "Agregar al carrito";
  }

  // ------------------------------------------------------------
  //  Carrito
  // ------------------------------------------------------------
  function loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; }
    catch { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch {}
  }

  function addToCart(id, qty = 1) {
    const p = state.byId.get(id);
    if (!p) return;
    const current = state.cart[id] || 0;
    const next = Math.min(current + qty, p.stock);
    if (next <= current) return toast("No hay más stock de este producto");
    state.cart[id] = next;
    saveCart();
    renderCart();
    const count = $("#cartCount");
    count.classList.remove("bump"); void count.offsetWidth; count.classList.add("bump");
    toast(`${p.name} agregado al carrito`);
  }

  function setQty(id, qty) {
    const p = state.byId.get(id);
    if (qty <= 0) delete state.cart[id];
    else state.cart[id] = Math.min(qty, p ? p.stock : qty);
    saveCart();
    renderCart();
  }

  // Quita productos que ya no existen y ajusta cantidades al stock actual
  function reconcileCart() {
    for (const [id, qty] of Object.entries(state.cart)) {
      const p = state.byId.get(id);
      if (!p || p.stock <= 0) delete state.cart[id];
      else if (qty > p.stock) state.cart[id] = p.stock;
    }
    saveCart();
  }

  function cartLines() {
    return Object.entries(state.cart)
      .map(([id, qty]) => ({ p: state.byId.get(id), qty }))
      .filter((l) => l.p);
  }

  function renderCart() {
    const lines = cartLines();
    const count = lines.reduce((s, l) => s + l.qty, 0);
    const total = lines.reduce((s, l) => s + l.qty * l.p.price, 0);

    $("#cartCount").textContent = count;
    $("#cartTotal").textContent = fmt(total);
    $("#cartEmpty").hidden = lines.length > 0;
    $("#checkout").hidden = lines.length === 0;
    $("#cartFoot").hidden = lines.length === 0;

    $("#cartItems").innerHTML = lines.map(({ p, qty }) => `
      <li class="cart-item">
        <img src="${esc(p.image || CFG.placeholderImage)}" alt="" onerror="this.onerror=null;this.src='${CFG.placeholderImage}'" />
        <div>
          <h4>${esc(p.name)}</h4>
          <span class="unit">${fmt(p.price)} c/u</span>
        </div>
        <div class="right">
          <span class="sub">${fmt(p.price * qty)}</span>
          <div class="qty small">
            <button data-dec="${esc(p.id)}" aria-label="Restar">−</button>
            <span>${qty}</span>
            <button data-inc="${esc(p.id)}" aria-label="Sumar" ${qty >= p.stock ? "disabled" : ""}>+</button>
          </div>
        </div>
      </li>`).join("");
  }

  // ------------------------------------------------------------
  //  WhatsApp
  // ------------------------------------------------------------
  function sendOrder(e) {
    e.preventDefault();
    const lines = cartLines();
    if (!lines.length) return;
    const data = Object.fromEntries(new FormData(e.target));
    const needsAddress = /env[ií]o|domicilio/i.test(data.entrega || "");
    if (needsAddress && !data.direccion?.trim()) {
      toast("Completá la dirección de envío");
      e.target.direccion.focus();
      return;
    }

    const total = lines.reduce((s, l) => s + l.qty * l.p.price, 0);
    const msg = [
      `🛍️ *Nuevo pedido — ${CFG.storeName}*`,
      "",
      ...lines.map(({ p, qty }) => `• ${qty} x ${p.name} — ${fmt(p.price * qty)}`),
      "",
      `*Total: ${fmt(total)}*`,
      "",
      `👤 Nombre: ${data.nombre.trim()}`,
      `🚚 Entrega: ${data.entrega}`,
      needsAddress ? `📍 Dirección: ${data.direccion.trim()}` : null,
      data.notas?.trim() ? `📝 Notas: ${data.notas.trim()}` : null,
    ].filter((l) => l !== null).join("\n");

    const url = `https://wa.me/${CFG.whatsappNumber}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener");
  }

  // ------------------------------------------------------------
  //  UI helpers
  // ------------------------------------------------------------
  function openOverlay(sel) {
    $(sel).hidden = false;
    document.body.classList.add("locked");
  }
  function closeOverlays() {
    document.querySelectorAll(".overlay").forEach((o) => (o.hidden = true));
    document.body.classList.remove("locked");
  }

  let toastTimer;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function bindEvents() {
    $("#products").addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      const open = e.target.closest("[data-open]");
      if (add) addToCart(add.dataset.add);
      else if (open) openProduct(open.dataset.open);
    });

    $("#search").addEventListener("input", (e) => { state.query = e.target.value; renderProducts(); });

    $("#pmMinus").onclick = () => { state.modalQty--; updateModalQty(); };
    $("#pmPlus").onclick = () => { state.modalQty++; updateModalQty(); };
    $("#pmAdd").onclick = () => { addToCart(state.modalProduct.id, state.modalQty); closeOverlays(); };

    $("#cartOpen").onclick = () => openOverlay("#cartOverlay");
    $("#cartItems").addEventListener("click", (e) => {
      const inc = e.target.closest("[data-inc]");
      const dec = e.target.closest("[data-dec]");
      if (inc) setQty(inc.dataset.inc, (state.cart[inc.dataset.inc] || 0) + 1);
      if (dec) setQty(dec.dataset.dec, (state.cart[dec.dataset.dec] || 0) - 1);
    });
    $("#cartClear").onclick = () => { state.cart = {}; saveCart(); renderCart(); };

    document.querySelectorAll(".overlay").forEach((o) =>
      o.addEventListener("click", (e) => {
        if (e.target === o || e.target.closest("[data-close]")) closeOverlays();
      })
    );
    document.addEventListener("keydown", (e) => e.key === "Escape" && closeOverlays());

    const select = $("#deliverySelect");
    select.innerHTML = CFG.deliveryOptions.map((o) => `<option>${esc(o)}</option>`).join("");
    const syncAddress = () => ($("#addressField").hidden = !/env[ií]o|domicilio/i.test(select.value));
    select.onchange = syncAddress;
    syncAddress();

    $("#checkout").addEventListener("submit", sendOrder);
  }

  // ------------------------------------------------------------
  //  Init
  // ------------------------------------------------------------
  async function init() {
    $("#year").textContent = new Date().getFullYear();
    document.title = CFG.storeName;
    bindEvents();
    renderCart();
    try {
      state.products = await loadProducts();
      state.byId = new Map(state.products.map((p) => [p.id, p]));
      reconcileCart();
      renderCategories();
      renderProducts();
      renderCart();
    } catch (err) {
      console.error(err);
      $("#status").textContent = "No pudimos cargar los productos. Intentá de nuevo en unos minutos.";
    }
  }

  init();
})();
