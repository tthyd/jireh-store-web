// ============================================================
//  JIREH STORE — Pedidos (hoja "Ordenes"), stock y costo de envío
//  Pegar en: Hoja de cálculo > Extensiones > Apps Script
//  Implementar > Nueva implementación > Aplicación web
//    Ejecutar como: Yo · Quién tiene acceso: Cualquier persona
//
//  La dirección de tu casa (punto de partida de los envíos) NO va en el
//  código: se guarda en Configuración del proyecto (⚙️) > Propiedades del
//  script, con el nombre HOME. Puede ser una dirección o "lat,lng".
// ============================================================
const SHEET_NAME = "Ordenes";
const PRODUCTS_SHEET = "Productos";
const HEADERS = [
  "Fecha", "Pedido N°", "Nombre", "Entrega", "Dirección", "Notas",
  "Cant. productos", "Detalle", "Total", "Estado", "Stock descontado", "Items", "Ref",
  "Día entrega", "Km", "Envío", "Mapa",
];
const COL = { num: 2, estado: 10, descontado: 11, items: 12, ref: 13, dia: 14, mapa: 17 };

// Tarifa de envío: base + km por calle (solo ida) desde HOME
const ENVIO = {
  base: 2000,       // $ fijo por envío
  porKm: 350,       // $ por km
  redondeo: 100,    // el total se redondea hacia arriba a múltiplos de esto
  zonas: ["Capital", "Valle Viejo"], // departamentos donde se entrega
};

// Ejecutalo desde el editor (botón ▶ Ejecutar) para autorizar Google Maps y
// probar la tarifa con una dirección de ejemplo. Mirá el resultado en el registro.
function probarEnvio() {
  console.log(JSON.stringify(quote({ address: "Esquiú 500, San Fernando del Valle de Catamarca" })));
  console.log(JSON.stringify(quote({ address: "Av. Presidente Castillo 1000, Valle Viejo" })));
}

function doPost(e) {
  try {
    const o = JSON.parse(e.postData.contents);
    if (o.action === "quote") return json(quote(o));
    return json(saveOrder(o));
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ------------------------------------------------------------
//  Pedidos
// ------------------------------------------------------------
function saveOrder(o) {
  if (!o.ref || !Array.isArray(o.items) || !o.items.length) return { ok: false, error: "pedido inválido" };

  // El costo del envío se recalcula acá: el que manda la web es solo de referencia
  let envio = null;
  if (o.envio) {
    const q = quote(o.envio.lat != null ? o.envio : { address: o.direccion });
    envio = q.ok ? q : { km: o.envio.km, costo: o.envio.costo, lat: o.envio.lat, lng: o.envio.lng };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet();
    const qty = o.items.reduce((s, i) => s + Number(i.qty || 0), 0);
    const subtotal = o.items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
    const detail = o.items.map((i) =>
      `${i.qty} x ${i.name}${i.options ? ` (${i.options})` : ""} — $${Number(i.subtotal).toLocaleString("es-AR")}`
    ).join("\n");
    const items = JSON.stringify(o.items.map((i) => ({ id: String(i.id), qty: Number(i.qty) })));
    const total = subtotal + (envio ? Number(envio.costo) || 0 : 0);
    const fields = [o.nombre || "", o.entrega || "", o.direccion || "", o.notas || "", qty, detail, total];
    const ship = [
      envio ? o.envio.dia || "" : "",
      envio ? envio.km : "",
      envio ? envio.costo : "",
      envio && envio.lat != null ? `https://www.google.com/maps?q=${envio.lat},${envio.lng}` : "",
    ];

    // Si el cliente reenvía el mismo carrito, se reusa su número y se actualiza la fila
    const last = sheet.getLastRow();
    const refs = last > 1 ? sheet.getRange(2, COL.ref, last - 1, 1).getValues().flat() : [];
    const idx = refs.indexOf(o.ref);
    if (idx >= 0) {
      const r = idx + 2;
      const num = sheet.getRange(r, COL.num).getDisplayValue();
      // Un pedido ya confirmado no se pisa: el stock ya se descontó con esos items
      if (sheet.getRange(r, COL.descontado).getValue() !== true) {
        sheet.getRange(r, 3, 1, fields.length).setValues([fields]);
        sheet.getRange(r, COL.items).setValue(items);
        sheet.getRange(r, COL.dia, 1, ship.length).setValues([ship]);
      }
      return { ok: true, num, envio };
    }

    const num = nextNumber();
    sheet.appendRow([new Date(), num, ...fields, "Nuevo", false, items, o.ref, ...ship]);
    return { ok: true, num, envio };
  } finally {
    lock.releaseLock();
  }
}

// Número correlativo: 0001, 0002… Se guarda en las propiedades del script,
// así borrar filas no hace que se repitan números.
function nextNumber() {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty("lastOrder") || 0) + 1;
  props.setProperty("lastOrder", String(n));
  return String(n).padStart(4, "0");
}

// Para volver a empezar la numeración desde 0001 (ejecutar desde el editor)
function resetNumbering() {
  PropertiesService.getScriptProperties().deleteProperty("lastOrder");
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.getRange("A:A").setNumberFormat("dd/mm/yyyy hh:mm");
    sheet.getRange("I:I").setNumberFormat("$ #,##0");
    sheet.getRange("H:H").setWrap(true);
    sheet.setColumnWidth(8, 360);
    sheet.hideColumns(COL.items, 2);
    sheet.getRange("J2:J").setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(["Nuevo", "Confirmado", "Enviado", "Entregado", "Cancelado"], true)
        .build()
    );
  }
  // Hojas creadas con versiones anteriores: agregar las columnas que falten
  const head = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (head[COL.ref - 1] !== "Ref") {
    sheet.getRange(1, COL.ref).setValue("Ref").setFontWeight("bold");
    sheet.hideColumns(COL.ref);
  }
  if (head[COL.dia - 1] !== "Día entrega") {
    sheet.getRange(1, COL.dia, 1, 4).setValues([HEADERS.slice(COL.dia - 1)]).setFontWeight("bold");
    sheet.getRange(1, COL.dia + 2, sheet.getMaxRows(), 1).setNumberFormat("$ #,##0");
  }
  // Texto, para que se vea 0001 y no 1
  sheet.getRange(1, COL.num, sheet.getMaxRows(), 1).setNumberFormat("@");
  return sheet;
}

// ------------------------------------------------------------
//  Envíos
// ------------------------------------------------------------
// dest: { address } o { lat, lng }. Devuelve { ok, km, costo, direccion, lat, lng }
// o { ok: false, error } con un mensaje para mostrarle al cliente.
function quote(dest) {
  const home = PropertiesService.getScriptProperties().getProperty("HOME");
  if (!home) throw new Error("Falta configurar HOME en las propiedades del script");

  const byGps = dest.lat != null && dest.lng != null;
  // La tarifa va en la clave: si cambia, no se usan costos viejos del caché
  const key = `q:${ENVIO.base}/${ENVIO.porKm}/${ENVIO.redondeo}:` + (byGps
    ? `${Number(dest.lat).toFixed(5)},${Number(dest.lng).toFixed(5)}`
    : String(dest.address || "").trim().toLowerCase());
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key.slice(0, 250));
  if (hit) return JSON.parse(hit);

  if (!byGps && !String(dest.address || "").trim()) return { ok: false, error: "Escribí la dirección." };

  const geo = Maps.newGeocoder().setRegion("ar").setLanguage("es");
  const res = byGps
    ? geo.reverseGeocode(Number(dest.lat), Number(dest.lng))
    : geo.geocode(`${dest.address}, Catamarca, Argentina`);
  const place = res.results && res.results[0];
  // Si Google solo ubicó la ciudad o la provincia, la dirección no se encontró
  const vague = !place || place.types.every((t) => /^(political|locality|sublocality.*|administrative_area_level_\d|country|colloquial_area)$/.test(t));
  if (!place || (!byGps && vague)) {
    return { ok: false, error: "No encontramos esa dirección. Probá con calle y número, o usá tu ubicación." };
  }

  const dept = (place.address_components.find((c) => c.types.includes("administrative_area_level_2")) || {}).long_name || "";
  if (!ENVIO.zonas.some((z) => dept.toLowerCase().includes(z.toLowerCase()))) {
    return { ok: false, error: "Por ahora solo hacemos envíos en Valle Viejo y la Capital. Podés elegir retiro." };
  }

  const loc = byGps ? { lat: Number(dest.lat), lng: Number(dest.lng) } : place.geometry.location;
  const dir = Maps.newDirectionFinder()
    .setOrigin(home)
    .setDestination(loc.lat, loc.lng)
    .setMode(Maps.DirectionFinder.Mode.DRIVING)
    .getDirections();
  if (!dir.routes || !dir.routes.length) return { ok: false, error: "No pudimos calcular el recorrido a esa dirección." };

  const km = Math.round(dir.routes[0].legs[0].distance.value / 100) / 10;
  const costo = Math.ceil((ENVIO.base + km * ENVIO.porKm) / ENVIO.redondeo) * ENVIO.redondeo;
  const out = { ok: true, km, costo, direccion: place.formatted_address, lat: loc.lat, lng: loc.lng };
  cache.put(key.slice(0, 250), JSON.stringify(out), 21600);
  return out;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
//  Stock: al pasar un pedido a "Confirmado" se descuenta del stock en
//  Productos. Si después se pasa a "Cancelado", se devuelve.
// ------------------------------------------------------------
function onEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME || e.range.getColumn() !== COL.estado || e.range.getRow() < 2) return;

  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    for (let r = e.range.getRow(); r <= e.range.getLastRow(); r++) {
      const estado = sheet.getRange(r, COL.estado).getValue();
      const descontado = sheet.getRange(r, COL.descontado).getValue() === true;
      const items = JSON.parse(sheet.getRange(r, COL.items).getValue() || "[]");
      if (estado === "Confirmado" && !descontado) {
        adjustStock(items, -1);
        sheet.getRange(r, COL.descontado).setValue(true);
      } else if (estado === "Cancelado" && descontado) {
        adjustStock(items, 1);
        sheet.getRange(r, COL.descontado).setValue(false);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function adjustStock(items, sign) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const head = data[0].map((h) => String(h).trim().toLowerCase());
  const idCol = head.indexOf("id");
  const stockCol = head.indexOf("stock");
  if (idCol < 0 || stockCol < 0) throw new Error("Productos necesita columnas id y stock");

  items.forEach(({ id, qty }) => {
    const i = data.findIndex((row, n) => n > 0 && String(row[idCol]).trim() === id);
    if (i < 0) return;
    const current = data[i][stockCol];
    if (current === "" || current === null) return; // stock vacío = no se controla
    const next = Math.max(0, Number(current) + sign * qty);
    data[i][stockCol] = next;
    sheet.getRange(i + 1, stockCol + 1).setValue(next);
  });
}
