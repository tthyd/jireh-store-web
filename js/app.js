(() => {
  "use strict";

  const CFG = window.JIREH_CONFIG;
  const CART_KEY = "jireh-cart-v1";
  const ORDER_KEY = "jireh-order-v2";
  const $ = (sel) => document.querySelector(sel);

  const state = {
    products: [],
    byId: new Map(),
    cart: loadCart(), // { [lineKey]: { id, opts: { [grupo]: valor }, qty } }
    category: "Todos",
    query: "",
    sort: "default",
    limit: CFG.pageSize || 20, // cuántos productos se ven ahora ("Ver más" suma otra página)
    filtered: [],
    modalProduct: null,
    modalQty: 1,
    modalOpts: {},
    // Envío: status idle | loading | ok | error. km/costo los calcula la hoja.
    ship: { status: "idle", seq: 0, pending: null },
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
      options: parseOptions(row.opciones || row.options || row.variantes || ""),
      image: row.imagen || row.image || row.foto || `img/productos/${String(row.id || index + 1)}.jpg`,
      // activo es una casilla en el Sheet (TRUE/FALSE). También se acepta si/no.
      // Una celda vacía (casilla sin tildar) cuenta como oculto.
      active: /^(true|si|sí|yes|y|s|1|x)$/i.test(String(row.activo ?? row.active ?? "").trim()),
    };
  }

  // "Talle: S, M, L | Color: Negro, Blanco (+1500)"
  //  -> [{ name: "Talle", values: [{ label: "S", delta: 0 }, …] }, …]
  // Los grupos se separan con "|" o salto de línea; "(+1500)" o "(-500)" ajusta el precio.
  function parseOptions(raw) {
    return String(raw)
      .split(/[|\n]/)
      .map((part, i) => {
        const colon = part.indexOf(":");
        const name = (colon > -1 ? part.slice(0, colon) : "").trim() || (i ? `Opción ${i + 1}` : "Opción");
        const values = (colon > -1 ? part.slice(colon + 1) : part)
          .split(",")
          .map((v) => {
            const m = v.match(/\(\s*([+-])\s*([^)]*)\)/);
            const label = v.replace(/\([^)]*\)/, "").trim();
            const delta = m ? (m[1] === "-" ? -1 : 1) * parsePrice(m[2]) : 0;
            return { label, delta };
          })
          .filter((v) => v.label);
        return { name, values };
      })
      .filter((g) => g.values.length);
  }

  function optionsDelta(p, opts) {
    return p.options.reduce((sum, g) => {
      const v = g.values.find((v) => v.label === opts[g.name]);
      return sum + (v ? v.delta : 0);
    }, 0);
  }

  // Precio mínimo y máximo posibles según las opciones
  function priceRange(p) {
    let min = p.price, max = p.price;
    for (const g of p.options) {
      const deltas = g.values.map((v) => v.delta);
      min += Math.min(...deltas);
      max += Math.max(...deltas);
    }
    return { min, max };
  }

  const optsText = (opts) => Object.entries(opts).map(([k, v]) => `${k}: ${v}`).join(", ");

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
      b.onclick = () => { state.category = c; renderCategories(); resetList(); };
      wrap.appendChild(b);
    }
  }

  const SORTERS = {
    "price-asc": (a, b) => priceRange(a).min - priceRange(b).min,
    "price-desc": (a, b) => priceRange(b).min - priceRange(a).min,
    name: (a, b) => a.name.localeCompare(b.name, CFG.locale),
  };

  // Al cambiar filtro, búsqueda u orden se vuelve a la primera página
  function resetList() {
    state.limit = CFG.pageSize || 20;
    renderProducts();
  }

  function renderProducts() {
    const q = normalizeKey(state.query);
    const list = state.products.filter((p) =>
      (state.category === "Todos" || p.category === state.category) &&
      (!q || normalizeKey(p.name + " " + p.description + " " + p.category).includes(q))
    );
    // "Destacados" respeta el orden de la hoja
    if (SORTERS[state.sort]) list.sort(SORTERS[state.sort]);
    state.filtered = list;

    $("#status").innerHTML = list.length ? "" : `
      <p>No encontramos productos${state.query ? ` para “${esc(state.query)}”` : ""}.</p>
      <button class="btn btn-outline" data-reset>Ver todos los productos</button>`;
    $("#products").removeAttribute("aria-busy");
    $("#products").innerHTML = list.slice(0, state.limit).map(cardHTML).join("");
    renderMore();
  }

  // Agrega la siguiente página sin volver a dibujar las tarjetas que ya están
  function showMore() {
    const from = state.limit;
    state.limit += CFG.pageSize || 20;
    $("#products").insertAdjacentHTML("beforeend", state.filtered.slice(from, state.limit).map(cardHTML).join(""));
    renderMore();
  }

  // Collage del hero: los primeros 3 productos con stock, en el orden de la hoja
  function renderHeroArt() {
    const picks = state.products.filter((p) => p.stock > 0).slice(0, 3);
    if (!picks.length) return;
    $("#heroArt").innerHTML = picks.map((p) => `
      <button data-open="${esc(p.id)}" tabindex="-1">
        <img src="${esc(p.image || CFG.placeholderImage)}" alt="" onerror="this.onerror=null;this.src='${CFG.placeholderImage}'" />
      </button>`).join("");
  }

  function renderMore() {
    const total = state.filtered.length;
    const shown = Math.min(state.limit, total);
    $("#more").hidden = shown >= total;
    $("#moreCount").textContent = `Mostrando ${shown} de ${total} productos`;
  }

  // i = posición dentro de la tanda, para escalonar la animación de entrada
  function cardHTML(p, i = 0) {
    const out = p.stock <= 0;
    const low = !out && p.stock <= 3;
    const hasOpts = p.options.length > 0;
    const range = priceRange(p);
    const priceLabel = range.min === range.max ? fmt(range.min) : `<small>desde</small> ${fmt(range.min)}`;
    const badge = out
      ? '<span class="badge out">Sin stock</span>'
      : low ? `<span class="badge low">Quedan ${p.stock}</span>` : "";
    return `
      <article class="card ${out ? "soldout" : ""}" style="--i:${Math.min(i, 11)}">
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
            <span class="card-price">${priceLabel}</span>
            <button class="btn btn-primary btn-small" ${hasOpts ? "data-open" : "data-add"}="${esc(p.id)}" ${out ? "disabled" : ""}>
              ${out ? "Agotado" : hasOpts ? "Elegir" : "Agregar"}
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
    // Si un grupo tiene una sola opción, se elige sola
    state.modalOpts = Object.fromEntries(
      p.options.filter((g) => g.values.length === 1).map((g) => [g.name, g.values[0].label])
    );
    const img = $("#pmImage");
    img.src = p.image || CFG.placeholderImage;
    img.alt = p.name;
    img.onerror = () => { img.onerror = null; img.src = CFG.placeholderImage; };
    $("#pmCategory").textContent = p.category;
    $("#pmTitle").textContent = p.name;
    $("#pmDesc").textContent = p.description;
    renderModalOptions();
    $("#pmStock").textContent =
      p.stock === Infinity ? "" : p.stock <= 0 ? "Sin stock por el momento" : `Stock disponible: ${p.stock}`;
    updateModalQty();
    openOverlay("#productOverlay");
  }

  function renderModalOptions() {
    const p = state.modalProduct;
    $("#pmOptions").innerHTML = p.options.map((g) => `
      <div class="opt-group" role="radiogroup" aria-label="${esc(g.name)}">
        <span class="opt-name">${esc(g.name)}</span>
        <div class="opt-values">
          ${g.values.map((v) => `
            <button type="button" class="chip" role="radio" data-group="${esc(g.name)}" data-value="${esc(v.label)}"
                    aria-checked="${state.modalOpts[g.name] === v.label}">
              ${esc(v.label)}${v.delta ? ` <small>${v.delta > 0 ? "+" : "−"}${fmt(Math.abs(v.delta))}</small>` : ""}
            </button>`).join("")}
        </div>
      </div>`).join("");
  }

  function updateModalQty() {
    const p = state.modalProduct;
    const available = p.stock - productQtyInCart(p.id);
    const missing = p.options.find((g) => !state.modalOpts[g.name]);
    const range = priceRange(p);
    $("#pmPrice").innerHTML = missing && range.min !== range.max
      ? `<small>desde</small> ${fmt(range.min)}`
      : fmt(p.price + optionsDelta(p, state.modalOpts));
    $("#pmQty").textContent = state.modalQty;
    $("#pmMinus").disabled = state.modalQty <= 1;
    $("#pmPlus").disabled = state.modalQty >= available;
    $("#pmAdd").disabled = available <= 0 || !!missing;
    $("#pmAdd").textContent = p.stock <= 0 ? "Agotado"
      : available <= 0 ? "Ya tenés todo el stock"
      : missing ? `Elegí ${missing.name.toLowerCase()}`
      : "Agregar al carrito";
  }

  // ------------------------------------------------------------
  //  Carrito
  // ------------------------------------------------------------
  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY)) || {};
      // Formato viejo { [productId]: qty } -> líneas sin opciones
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "number") raw[k] = { id: k, opts: {}, qty: v };
      }
      return raw;
    } catch { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch {}
  }

  const lineKey = (id, opts) => [id, ...Object.values(opts)].join("|");

  // El stock es por producto: se suma lo que hay en el carrito de todas sus opciones
  function productQtyInCart(id) {
    return Object.values(state.cart).reduce((s, l) => s + (l.id === id ? l.qty : 0), 0);
  }

  function addToCart(id, qty = 1, opts = {}) {
    const p = state.byId.get(id);
    if (!p) return;
    const add = Math.min(qty, p.stock - productQtyInCart(id));
    if (add <= 0) return toast("No hay más stock de este producto");
    const key = lineKey(id, opts);
    const line = state.cart[key] || { id, opts, qty: 0 };
    line.qty += add;
    state.cart[key] = line;
    saveCart();
    renderCart();
    const count = $("#cartCount");
    count.classList.remove("bump"); void count.offsetWidth; count.classList.add("bump");
    toast(`${p.name} agregado al carrito`);
  }

  function setQty(key, qty) {
    const line = state.cart[key];
    if (!line) return;
    const p = state.byId.get(line.id);
    if (qty <= 0) delete state.cart[key];
    else line.qty = p ? Math.min(qty, line.qty + p.stock - productQtyInCart(line.id)) : qty;
    saveCart();
    renderCart();
  }

  // Quita productos u opciones que ya no existen y ajusta cantidades al stock actual
  function reconcileCart() {
    const used = {};
    for (const [key, line] of Object.entries(state.cart)) {
      const p = state.byId.get(line.id);
      const validOpts = p && p.options.length === Object.keys(line.opts).length &&
        p.options.every((g) => g.values.some((v) => v.label === line.opts[g.name]));
      const left = p ? p.stock - (used[line.id] || 0) : 0;
      if (!validOpts || left <= 0) { delete state.cart[key]; continue; }
      line.qty = Math.min(line.qty, left);
      used[line.id] = (used[line.id] || 0) + line.qty;
    }
    saveCart();
  }

  function cartLines() {
    return Object.entries(state.cart)
      .map(([key, l]) => {
        const p = state.byId.get(l.id);
        return p && { key, p, opts: l.opts, qty: l.qty, price: p.price + optionsDelta(p, l.opts) };
      })
      .filter(Boolean);
  }

  function renderCart() {
    const lines = cartLines();
    const count = lines.reduce((s, l) => s + l.qty, 0);
    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

    $("#cartCount").textContent = count;
    $("#cartCount").hidden = count === 0;
    $("#cartTotal").textContent = fmt(total + shipCost());
    renderShip();
    $("#cartEmpty").hidden = lines.length > 0;
    $("#checkout").hidden = lines.length === 0;
    $("#cartFoot").hidden = lines.length === 0;

    $("#cartItems").innerHTML = lines.map(({ key, p, opts, qty, price }) => `
      <li class="cart-item">
        <img src="${esc(p.image || CFG.placeholderImage)}" alt="" onerror="this.onerror=null;this.src='${CFG.placeholderImage}'" />
        <div>
          <h4>${esc(p.name)}</h4>
          ${Object.keys(opts).length ? `<span class="opts">${esc(optsText(opts))}</span>` : ""}
          <span class="unit">${fmt(price)} c/u</span>
        </div>
        <div class="right">
          <span class="sub">${fmt(price * qty)}</span>
          <div class="qty small">
            <button data-dec="${esc(key)}" aria-label="Restar">−</button>
            <span>${qty}</span>
            <button data-inc="${esc(key)}" aria-label="Sumar" ${productQtyInCart(p.id) >= p.stock ? "disabled" : ""}>+</button>
          </div>
        </div>
      </li>`).join("");
  }

  // ------------------------------------------------------------
  //  Envío a domicilio
  // ------------------------------------------------------------
  const isDelivery = () => /env[ií]o|domicilio/i.test($("#deliverySelect").value);
  const shipCost = () => (isDelivery() && state.ship.status === "ok" ? state.ship.costo : 0);

  // Pide a la hoja km y costo desde tu casa. dest: { address } o { lat, lng }.
  // Si llegan respuestas viejas (el cliente siguió escribiendo) se descartan.
  function requestQuote(dest) {
    const seq = ++state.ship.seq;
    state.ship = { status: "loading", seq, dest };
    renderCart();
    const pending = (async () => {
      let r;
      try {
        const res = await fetch(CFG.ordersUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: "quote", ...dest }),
          signal: AbortSignal.timeout(15000),
        });
        r = await res.json();
      } catch {
        r = { ok: false, error: "No pudimos calcular el envío. Revisá tu conexión y probá de nuevo." };
      }
      if (seq !== state.ship.seq) return;
      state.ship = r.ok
        ? { status: "ok", seq, dest, km: r.km, costo: r.costo, direccion: r.direccion, lat: r.lat, lng: r.lng }
        : { status: "error", seq, dest, msg: r.error || "No pudimos calcular el envío." };
      renderCart();
    })();
    state.ship.pending = pending;
    return pending;
  }

  function renderShip() {
    const on = isDelivery();
    const { status, km, costo, msg } = state.ship;
    $("#shipBox").hidden = !on;
    $("#dayField").hidden = !on;
    $("#shipRow").hidden = !on;
    const q = $("#shipQuote");
    q.classList.toggle("error", status === "error");
    if (status === "loading") q.textContent = "Calculando envío…";
    else if (status === "error") q.textContent = msg;
    else if (status === "ok") q.innerHTML = `${String(km).replace(".", ",")} km · Envío <strong>${fmt(costo)}</strong>`;
    else q.textContent = "";
    $("#shipCost").textContent =
      status === "ok" ? fmt(costo) : status === "loading" ? "Calculando…" : "A calcular";
  }

  // Próximas fechas de entrega (nunca el mismo día del pedido)
  function deliveryDates() {
    const out = [];
    const d = new Date();
    while (out.length < (CFG.deliveryDatesShown || 4)) {
      d.setDate(d.getDate() + 1);
      if ((CFG.deliveryDays || []).includes(d.getDay())) {
        const day = d.toLocaleDateString(CFG.locale, { weekday: "long" });
        out.push(`${day[0].toUpperCase()}${day.slice(1)} ${d.getDate()}/${d.getMonth() + 1}`);
      }
    }
    return out;
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      state.ship = { ...state.ship, status: "error", msg: "Tu navegador no permite compartir la ubicación. Escribí la dirección." };
      return renderShip();
    }
    const btn = $("#gpsBtn");
    btn.disabled = true;
    state.ship = { ...state.ship, status: "loading", seq: ++state.ship.seq };
    renderShip();
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        await requestQuote({ lat: coords.latitude, lng: coords.longitude });
        btn.disabled = false;
        const input = $("#checkout").direccion;
        if (state.ship.status === "ok" && !input.value.trim()) {
          input.value = state.ship.direccion.replace(/, Argentina$/, "");
          setAddressError(false);
        }
      },
      () => {
        btn.disabled = false;
        state.ship = { ...state.ship, status: "error", msg: "No pudimos obtener tu ubicación. Escribí la dirección." };
        renderShip();
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  // ------------------------------------------------------------
  //  Número de pedido
  // ------------------------------------------------------------
  // El número correlativo (0001, 0002…) lo asigna la hoja "Ordenes". Cada carrito
  // lleva además una referencia al azar: si el cliente reenvía el mismo carrito
  // (ej. cerró WhatsApp sin mandar), la hoja devuelve el mismo número.
  function newRef() {
    const chars = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    const rnd = crypto.getRandomValues(new Uint32Array(6));
    return Array.from(rnd, (n) => chars[n % chars.length]).join("");
  }

  function orderRefFor(lines) {
    const sig = JSON.stringify(lines.map((l) => [l.key, l.qty]));
    try {
      const saved = JSON.parse(localStorage.getItem(ORDER_KEY));
      if (saved && saved.sig === sig) return saved.ref;
    } catch {}
    const ref = newRef();
    try { localStorage.setItem(ORDER_KEY, JSON.stringify({ ref, sig })); } catch {}
    return ref;
  }

  // Registra el pedido en la hoja vía Apps Script y devuelve su número.
  // text/plain evita el preflight CORS. Si la hoja no responde, se usa la
  // referencia como número para no frenar la venta.
  async function registerOrder(order) {
    if (!CFG.ordersUrl) return { num: order.ref };
    try {
      const res = await fetch(CFG.ordersUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(order),
        signal: AbortSignal.timeout(10000),
      });
      const json = await res.json();
      return json.ok && json.num ? json : { num: order.ref };
    } catch {
      return { num: order.ref };
    }
  }

  // ------------------------------------------------------------
  //  WhatsApp
  // ------------------------------------------------------------
  let sending = false;
  async function sendOrder(e) {
    e.preventDefault();
    if (sending) return;
    const lines = cartLines();
    if (!lines.length) return;
    const data = Object.fromEntries(new FormData(e.target));
    const needsAddress = isDelivery();
    if (needsAddress && !data.direccion?.trim()) {
      setAddressError(true);
      e.target.direccion.focus();
      return;
    }
    if (needsAddress && state.ship.status === "idle") requestQuote({ address: data.direccion.trim() });
    if (needsAddress && state.ship.status === "error") {
      e.target.direccion.focus();
      return;
    }

    // La pestaña se abre ya (dentro del clic) para que el navegador no la
    // bloquee; cuando la hoja devuelve el número se la manda a WhatsApp.
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    sending = true;
    toast("Generando tu pedido…");

    if (needsAddress && state.ship.status === "loading") await state.ship.pending;
    if (needsAddress && state.ship.status !== "ok") {
      sending = false;
      win?.close();
      e.target.direccion.focus();
      return;
    }

    const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
    const ship = needsAddress
      ? { dia: data.dia, km: state.ship.km, costo: state.ship.costo, lat: state.ship.lat, lng: state.ship.lng }
      : null;
    const saved = await registerOrder({
      ref: orderRefFor(lines),
      nombre: data.nombre.trim(),
      entrega: data.entrega,
      direccion: needsAddress ? data.direccion.trim() : "",
      notas: data.notas?.trim() || "",
      envio: ship,
      items: lines.map(({ p, opts, qty, price }) =>
        ({ id: p.id, name: p.name, options: optsText(opts), qty, price, subtotal: price * qty })),
    });
    sending = false;
    const orderId = saved.num;
    // Si la hoja recalculó el envío, manda su valor
    if (ship && saved.envio) Object.assign(ship, { km: saved.envio.km, costo: Number(saved.envio.costo) || ship.costo });
    const km = ship && String(ship.km).replace(".", ",");

    const msg = [
      `🛍️ *Nuevo pedido — ${CFG.storeName}*`,
      `🧾 Pedido N° *${orderId}*`,
      "",
      ...lines.map(({ p, opts, qty, price }) =>
        `• ${qty} x ${p.name}${Object.keys(opts).length ? ` (${optsText(opts)})` : ""} — ${fmt(price * qty)}`),
      "",
      ship ? `Subtotal: ${fmt(subtotal)}` : null,
      ship ? `Envío (${km} km): ${fmt(ship.costo)}` : null,
      `*Total: ${fmt(subtotal + (ship ? ship.costo : 0))}*`,
      "",
      `👤 Nombre: ${data.nombre.trim()}`,
      `🚚 Entrega: ${data.entrega}${ship ? ` — ${ship.dia}` : ""}`,
      needsAddress ? `📍 Dirección: ${data.direccion.trim()}` : null,
      ship && ship.lat != null ? `🗺️ https://www.google.com/maps?q=${ship.lat},${ship.lng}` : null,
      data.notas?.trim() ? `📝 Notas: ${data.notas.trim()}` : null,
    ].filter((l) => l !== null).join("\n");

    // Directo a api.whatsapp.com: la redirección de wa.me rompe los emojis (�)
    const url = `https://api.whatsapp.com/send?phone=${CFG.whatsappNumber}&text=${encodeURIComponent(msg)}`;
    if (win) win.location.href = url;
    else location.href = url;
    toast(`Pedido N° ${orderId}`);
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

  function setAddressError(on) {
    $("#addressError").hidden = !on;
    $("#checkout").direccion.setAttribute("aria-invalid", String(on));
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
    $("#heroArt").addEventListener("click", (e) => {
      const open = e.target.closest("[data-open]");
      if (open) openProduct(open.dataset.open);
    });

    $("#search").addEventListener("input", (e) => { state.query = e.target.value; resetList(); });
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; resetList(); });
    $("#moreBtn").addEventListener("click", showMore);
    $("#status").addEventListener("click", (e) => {
      if (!e.target.closest("[data-reset]")) return;
      state.query = ""; state.category = "Todos";
      $("#search").value = "";
      renderCategories(); resetList();
    });

    $("#pmMinus").onclick = () => { state.modalQty--; updateModalQty(); };
    $("#pmPlus").onclick = () => { state.modalQty++; updateModalQty(); };
    $("#pmAdd").onclick = () => {
      const p = state.modalProduct;
      // Orden fijo de grupos para que la misma combinación caiga en la misma línea
      const opts = Object.fromEntries(p.options.map((g) => [g.name, state.modalOpts[g.name]]));
      addToCart(p.id, state.modalQty, opts);
      closeOverlays();
    };
    $("#pmOptions").addEventListener("click", (e) => {
      const b = e.target.closest("[data-group]");
      if (!b) return;
      state.modalOpts[b.dataset.group] = b.dataset.value;
      renderModalOptions();
      updateModalQty();
    });

    $("#cartOpen").onclick = () => openOverlay("#cartOverlay");
    $("#cartItems").addEventListener("click", (e) => {
      const inc = e.target.closest("[data-inc]");
      const dec = e.target.closest("[data-dec]");
      if (inc) setQty(inc.dataset.inc, state.cart[inc.dataset.inc].qty + 1);
      if (dec) setQty(dec.dataset.dec, state.cart[dec.dataset.dec].qty - 1);
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
    $("#daySelect").innerHTML = deliveryDates().map((d) => `<option>${esc(d)}</option>`).join("");
    const address = $("#checkout").direccion;
    const syncAddress = () => {
      $("#addressField").hidden = !isDelivery();
      if (isDelivery() && state.ship.status === "idle" && address.value.trim()) requestQuote({ address: address.value.trim() });
      renderCart();
    };
    select.onchange = () => { syncAddress(); setAddressError(false); };

    // Cotiza cuando el cliente deja de escribir (o sale del campo)
    let quoteTimer;
    const quoteAddress = () => {
      clearTimeout(quoteTimer);
      const value = address.value.trim();
      // Solo si cambió lo escrito (el input deja el envío en "idle")
      if (!value || state.ship.status !== "idle") return;
      requestQuote({ address: value });
    };
    address.addEventListener("input", () => {
      setAddressError(false);
      clearTimeout(quoteTimer);
      // Si se usó el GPS y después se edita la dirección, manda lo escrito
      state.ship = { status: "idle", seq: ++state.ship.seq };
      renderCart();
      quoteTimer = setTimeout(quoteAddress, 1200);
    });
    address.addEventListener("blur", quoteAddress);
    $("#gpsBtn").onclick = useMyLocation;
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
      renderHeroArt();
      renderCart();
    } catch (err) {
      console.error(err);
      $("#products").innerHTML = "";
      $("#status").textContent = "No pudimos cargar los productos. Intentá de nuevo en unos minutos.";
    }
  }

  init();
})();
