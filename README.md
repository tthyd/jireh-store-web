# Jireh Store

Tienda online estática: catálogo con precios, descripciones y stock, carrito de compras y envío del pedido por WhatsApp. Los productos se administran desde una hoja de Google Sheets.

## Estructura

```
index.html          Página principal
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

• 2 x Remera Oversize Negra — $ 37.000
• 1 x Taza Cerámica 350ml — $ 9.500

*Total: $ 46.500*

👤 Nombre: Juan Pérez
🚚 Entrega: Envío a domicilio
📍 Dirección: Av. Siempreviva 742
```

## 2. Conectar la hoja de cálculo (precios y stock)

1. Creá una hoja en Google Sheets con estas columnas en la fila 1 (podés importar `data/productos.csv` como punto de partida: *Archivo → Importar*):

   | id | nombre | descripcion | precio | stock | categoria | imagen | activo |
   |----|--------|-------------|--------|-------|-----------|--------|--------|
   | 1  | Remera | Algodón…    | 18500  | 12    | Ropa      | https://… | si  |

   - **precio**: número (`18500` o `18.500` sirven).
   - **stock**: si es `0` el producto aparece como *Agotado*. Si lo dejás vacío, no se controla stock. Con 3 o menos muestra "¡Últimas N!".
   - **imagen**: URL pública de la foto. Si está vacía se usa una imagen genérica.
   - **activo**: poné `no` para ocultar un producto sin borrarlo.
   - **id**: un identificador único que no cambie (el carrito del cliente se guarda por id).

2. En Google Sheets: **Archivo → Compartir → Publicar en la web**.
3. Elegí la hoja de productos y el formato **Valores separados por comas (.csv)** → **Publicar**.
4. Copiá el link y pegalo en `sheetCsvUrl` dentro de `js/config.js`.

Listo: cada vez que cambies un precio o el stock en la hoja, la web lo toma. Google puede tardar **hasta ~5 minutos** en reflejar los cambios en el CSV publicado.

> Ojo: el stock de la hoja no se descuenta solo al recibir un pedido (el pedido llega por WhatsApp, no hay pago online). Cuando confirmes una venta, actualizá el stock en la hoja.

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
