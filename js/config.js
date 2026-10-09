// ============================================================
//  CONFIGURACIÓN DE JIREH STORE — editá solo este archivo
// ============================================================
window.JIREH_CONFIG = {
  // Nombre que aparece en la web y en el mensaje de WhatsApp
  storeName: "Jireh Store",

  // Número de WhatsApp que recibe los pedidos.
  // Formato internacional, solo dígitos, sin "+" ni espacios.
  // Ej. Argentina: 54 9 11 1234-5678  ->  "5491112345678"
  whatsappNumber: "5493834967079",

  // URL de la hoja de Google publicada como CSV.
  // En Google Sheets: Archivo > Compartir > Publicar en la web >
  // elegí la hoja de productos y el formato "Valores separados por comas (.csv)".
  // Si lo dejás vacío, se usa el archivo local data/productos.csv
  sheetCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQkzX6pSXmkPoy7k_sDXH-WRXDeR4fA4ekYvkmks1q76kXd5Ioun2riqxOng2F_JKQRFF9HE7Weo_CQ/pub?gid=358716461&single=true&output=csv",

  // Moneda y formato de precios
  currency: "ARS",
  locale: "es-AR",

  // Opciones de entrega que se muestran en el checkout
  deliveryOptions: ["Retiro en el local", "Envío a domicilio"],

  // Imagen que se muestra si un producto no tiene foto
  placeholderImage: "img/placeholder.svg",
};
