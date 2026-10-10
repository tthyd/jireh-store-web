# Jireh Store

Tienda online estática: catálogo con precios, descripciones y stock, carrito de compras y envío del pedido por WhatsApp. Los productos se administran desde una hoja de Google Sheets.

## Estructura

```
index.html          Página principal
404.html            Página de error (Netlify, Vercel y GitHub Pages la usan solas)
privacidad.html     Política de privacidad (Ley 25.326), enlazada desde el pie y el checkout
css/styles.css      Estilos
js/config.js        ⚙️  Configuración (WhatsApp, hoja de cálculo, moneda)
js/app.js           Lógica (catálogo, carrito, WhatsApp)
data/productos.csv  Productos de ejemplo (se usa si no hay hoja conectada)
img/placeholder.svg Imagen por defecto
```

## 1. Configurar WhatsApp

En `js/config.js`, cambiá `whatsappNumber` por el número que recibe los pedidos, en formato internacional y solo dígitos:

- Argentina: `549` + código de área sin 0 + número sin 15 → `5491112345678`

Cuando el cliente toca **Enviar pedido por WhatsApp**, se abre WhatsApp con el mensaje ya armado:

```
🛍️ *Nuevo pedido — Jireh Store*
🧾 Pedido N° *0001*

• 2 x Remera Oversize Negra — $ 37.000
• 1 x Taza Cerámica 350ml — $ 9.500

*Total: $ 46.500*

👤 Nombre: Juan Pérez
🚚 Entrega: Envío a domicilio
📍 Dirección: Av. Siempreviva 742
```

Cada pedido lleva un **número correlativo** (`0001`, `0002`, …) que asigna la hoja *Ordenes* (ver 2b), así el número del WhatsApp es el mismo que el de la hoja. Si el cliente vuelve a tocar el botón con el mismo carrito, se reusa el mismo número; si cambia algo del carrito, se genera uno nuevo. Para reiniciar la numeración, ejecutá `resetNumbering` desde el editor de Apps Script.

## 2. Conectar la hoja de cálculo (precios y stock)

1. Creá una hoja en Google Sheets con estas columnas en la fila 1 (podés importar `data/productos.csv` como punto de partida: *Archivo → Importar*):

   | id | nombre | descripcion | precio | stock | categoria | imagen | activo | opciones |
   |----|--------|-------------|--------|-------|-----------|--------|--------|----------|
   | 1  | Remera | Algodón…    | 18500  | 12    | Ropa      | https://… | si  | Talle: S, M, L |

   - **precio**: número (`18500` o `18.500` sirven).
   - **stock**: si es `0` el producto aparece como *Agotado*. Si lo dejás vacío, no se controla stock. Con 3 o menos muestra "Quedan N".
   - **imagen**: URL pública de la foto. Si está vacía se usa una imagen genérica.
   - **activo**: casilla (check). Tildada = el producto se ve en la web; sin tildar = oculto, sin borrarlo. También se acepta `si`/`no` escrito a mano.
   - **id**: un identificador único que no cambie (el carrito del cliente se guarda por id).
   - **opciones** (opcional): variantes que el cliente elige antes de agregar al carrito. Cada grupo es `Nombre: valor, valor, …` y los grupos se separan con `|`:

     ```
     Talle: S, M, L, XL (+2000) | Color: Negro, Blanco
     ```

     - `(+2000)` o `(-500)` después de un valor suma o resta ese monto al precio.
     - Si no ponés nombre (`Chico, Grande`), el grupo se llama "Opción".
     - El stock es del producto en total, no por opción.
     - La opción elegida se ve en el carrito y en el mensaje de WhatsApp: `• 1 x Remera (Talle: XL, Color: Negro) — $ 20.500`.

2. En Google Sheets: **Archivo → Compartir → Publicar en la web**.
3. Elegí la hoja de productos y el formato **Valores separados por comas (.csv)** → **Publicar**.
4. Copiá el link y pegalo en `sheetCsvUrl` dentro de `js/config.js`.

Listo: cada vez que cambies un precio o el stock en la hoja, la web lo toma. Google puede tardar **hasta ~5 minutos** en reflejar los cambios en el CSV publicado.

## 2b. Registro de pedidos (hoja "Ordenes") y stock

Cada pedido enviado se guarda también en la pestaña **Ordenes** de la misma hoja, mediante el Apps Script de `apps-script/Ordenes.gs` (publicado como aplicación web; su URL va en `ordersUrl` de `js/config.js`).

Columnas: Fecha · Pedido N° · Nombre · Entrega · Dirección · Notas · Cant. productos · Detalle · Total · **Estado** · Stock descontado · Items (oculta).

- **Estado** es un desplegable: Nuevo → Confirmado → Enviado → Entregado / Cancelado.
- Al pasar un pedido a **Confirmado**, el stock de esos productos se descuenta en *Productos* (una sola vez; la columna *Stock descontado* queda en TRUE).
- Si después lo pasás a **Cancelado**, el stock se devuelve.
- Los pedidos que siguen en *Nuevo* no tocan el stock (el cliente puede no haber enviado el WhatsApp).
- Si cambiás el script, hay que volver a publicarlo: *Implementar → Gestionar implementaciones → editar → Nueva versión* (así la URL no cambia).

## 2c. Costo de envío (Valle Viejo y Capital)

Cuando el cliente elige **Envío a domicilio**, escribe su dirección (o toca *Usar mi ubicación actual*) y la web le muestra los km y el costo, que se suman al total. El cálculo lo hace el Apps Script con Google Maps: **km por calle desde tu casa**.

- **Tarifa**: en `apps-script/Ordenes.gs`, objeto `ENVIO` → `base` (fijo por envío) + `porKm`, redondeado hacia arriba a `redondeo`. Si la cambiás, volvé a publicar el script (Nueva versión).
- **Tu casa**: en el editor de Apps Script → ⚙️ *Configuración del proyecto* → *Propiedades del script* → propiedad `HOME` con tu dirección o `lat,lng`. No va en el código para que no quede pública.
- **Zonas**: solo se aceptan direcciones de los departamentos Capital y Valle Viejo (`ENVIO.zonas`). Fuera de eso se le sugiere al cliente elegir retiro.
- **Días de entrega**: `deliveryDays` en `js/config.js` (2 = martes, 5 = viernes). El cliente elige entre las próximas fechas.
- En *Ordenes* quedan el día, los km, el costo del envío y un link de Google Maps al punto de entrega. El *Total* incluye el envío.
- Para probar la tarifa sin la web: en el editor de Apps Script ejecutá `probarEnvio` y mirá el registro.

## 2d. Límites de uso y validación

El Apps Script limita cuántas consultas recibe (`LIMITS` en `apps-script/Ordenes.gs`), para proteger la cuota de Google Maps y que nadie llene la hoja de basura:

| | Global (todos juntos) | Por navegador |
|---|---|---|
| Cálculo de envío | 40/min · 400/hora | 10/min · 60/hora |
| Pedidos | 10/min · 60/hora | 5 cada 10 min · 20 cada 6 h |

- Apps Script no da la IP del visitante: el límite por navegador usa un id al azar que guarda la web. Se puede falsear, por eso también hay límite global.
- Si se pasa el límite de pedidos, la venta no se frena: el WhatsApp sale igual con un código provisorio en vez del número correlativo.
- Todo lo que llega se valida: largo máximo de cada campo, hasta 50 productos y 99 unidades por línea, y los textos que empiezan con `=`, `+`, `-` o `@` se guardan como texto para que la hoja no los ejecute como fórmula.

## 3. Probar localmente

Hace falta un servidor local (abrir el `index.html` con doble clic no permite leer el CSV):

```bash
python3 -m http.server 8080
# abrí http://localhost:8080
```

## 4. Publicar gratis

Cualquiera de estas opciones sirve, no hay build:

- **Netlify**: arrastrá la carpeta a https://app.netlify.com/drop
- **Vercel**: `npx vercel` dentro de la carpeta
- **GitHub Pages**: subí la carpeta a un repo y activá Pages en *Settings → Pages*
