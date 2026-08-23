'use strict';

/* ==========================================================================
   CONFIG — punto único de configuración de toda la aplicación (sitio de
   invitados Y panel de administración). Cambiar aquí la fecha, textos,
   categorías, límites o la URL del backend. No la repitas en otros archivos.
   ========================================================================== */
const CONFIG = {
  COUPLE_NAMES: { hector: 'Héctor', raquel: 'Raquel' },

  // Fecha de la boda: mientras no se confirme, se deja en null y la interfaz
  // muestra un texto editable en su lugar (nunca se inventa una fecha).
  WEDDING_DATE: '2026-12-14',

  HERO_TAGLINE: '“Ponme como un sello sobre tu corazón, como un sello sobre tu brazo, porque el amor es tan fuerte como la muerte”',
  HERO_TAGLINE_CITA: 'Cantares 8:6',
  HERO_SUBTITLE: 'Comparte con nosotros esos momentos que hicieron inolvidable este día.',

  // Momentos de "Cómo llegamos hasta aquí". Textos de ejemplo, editables aquí
  // con la historia real de la pareja — no se muestran fechas ni datos que no
  // se hayan confirmado.
  COUPLE_STORY: [
    {
      title: 'Un encuentro que no esperaban',
      text: 'Dos caminos distintos que se cruzaron sin planearlo, y que desde entonces no han dejado de andar juntos.',
    },
    {
      title: 'La decisión de construir algo juntos',
      text: 'Entre risas, mudanzas, viajes y días comunes, fueron eligiéndose una y otra vez hasta que ya no hubo vuelta atrás.',
    },
    {
      title: 'El día que se dijeron que sí',
      text: 'Y llegó el momento de convertir esa historia compartida en una promesa para toda la vida.',
    },
  ],

  // URL de la aplicación web de Apps Script (ver apps-script/README_SETUP.md).
  API_URL: 'https://script.google.com/macros/s/AKfycbzD2xibvPVRqSj-UkI-bgs1RfmlstCirwMWXlx4VXIxlGXw9v-pE2OC-Wn5SxbyjMo22Q/exec',
  API_TIMEOUT_MS: 15000,
  API_MAX_RETRIES: 2,

  // URL canónica del sitio publicado. Se deja vacía hasta que exista un dominio real.
  SITE_URL: '',

  // Categorías del álbum — identificadores internos estables + etiquetas visibles.
  CATEGORIES: [
    { id: 'todos', label: 'Todos nuestros recuerdos' },
    { id: 'pareja', label: 'Héctor & Raquel' },
    { id: 'celebracion', label: 'La gran celebración' },
    { id: 'gente-favorita', label: 'Nuestra gente favorita' },
    { id: 'primer-baile', label: 'Nuestro primer baile' },
    { id: 'fiesta', label: 'Que siga la fiesta' },
    { id: 'espontaneos', label: 'Momentos espontáneos' },
    { id: 'detalles', label: 'Pequeños grandes detalles' },
  ],

  // Rutas centralizadas de fotografías propias. Si el archivo no existe todavía,
  // se sustituye automáticamente por un marcador elegante (nunca un ícono roto).
  PHOTOS: {
    hero: 'assets/photos/hero.jpg',
    historiaPrincipal: 'assets/photos/historia-principal.jpg',
    historiaSecundaria: 'assets/photos/historia-secundaria.jpg',
    cierre: 'assets/photos/cierre.jpg',
  },

  UPLOAD: {
    maxFileMB: 12,          // tamaño máximo por archivo, ya optimizado
    maxDimension: 2400,     // lado más largo, en píxeles
    quality: 0.86,          // calidad JPEG inicial
    maxBatch: 20,           // máximo de archivos por lote seleccionado
    concurrency: 3,         // subidas simultáneas
    maxRetries: 3,          // reintentos automáticos por archivo
    // Límite suave por dispositivo (no es seguridad real, solo evita que un
    // envío accidental o un script sencillo inunde el álbum). Se cuenta en
    // este navegador con localStorage; un invitado normal nunca lo alcanza.
    maxPerDevice: 60,
  },

  PAGE_SIZE: 16,

  FEATURES: {
    allowDownload: true,
    allowFavorites: true,
    moderationEnabled: false,   // si el backend modera, las fotos nuevas tardan en publicarse
    hideGuestName: false,       // oculta el nombre del invitado en la interfaz pública
    // El código de evento se verifica en el servidor; aquí solo se activa o
    // desactiva la pantalla de acceso. Nunca se guarda un código real en el cliente.
    accessCodeEnabled: false,
  },

  PRIVACY_NOTE: 'Las fotografías que compartas en este álbum serán visibles para las personas con acceso a este enlace.',
};

/**
 * Agranda una miniatura de Drive (".../thumbnail?id=...&sz=w480") al ancho
 * pedido. El endpoint "uc?export=view" de Drive frecuentemente falla al
 * usarse embebido fuera de Drive (por eso el visor terminaba mostrando el
 * marcador); la miniatura, en cambio, es confiable — solo hace falta pedirla
 * más grande. Se usa tanto en script.js (lightbox, destacadas) como en admin.js.
 */
function agrandarMiniaturaDrive(thumbUrl, ancho) {
  if (!thumbUrl) return null;
  return thumbUrl.replace(/sz=w\d+/, `sz=w${ancho}`);
}
