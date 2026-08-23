> **Nota de pivote (mismo día):** tras escribir este spec y una primera versión de `index.html`/`styles.css` con un "álbum interactivo" tipo libro con páginas que giran, el usuario reformuló el encargo explícitamente como una **landing page de una sola página sin metáfora de libro** (nav + hero + historia + galería masonry con filtros + destacadas editoriales + formulario de subida inline + cierre + footer). Ese pivote quedó registrado en `docs/superpowers/plans/2026-08-21-album-boda.md`. El backend (Apps Script + Drive + Sheets), la arquitectura de subida (compresión, cola, idempotencia) y la paleta/tipografía descritas abajo siguen vigentes tal cual; solo cambió la estructura visual del frontend y se eliminaron las secciones "El día que elegimos para siempre" como hero-only-título (ahora es la frase principal) y el componente `Album` de páginas 3D.

# Álbum digital de boda — Héctor & Raquel

**Fecha:** 2026-08-21
**Estado:** Aprobado por instrucción directa del usuario (brief exhaustivo ya constituye el diseño; el usuario pidió explícitamente no detenerse a pedir autorización en cada paso).

## Contexto

Carpeta de proyecto vacía (`FotosBD`). No existen fotografías reales de los novios ni backend ya desplegado y funcional: el endpoint de Apps Script (`.../exec?action=health`) responde HTTP 200 pero con la página de error genérica de Google, confirmando que el proyecto Apps Script vinculado a esa URL **no contiene todavía** el código que se va a escribir aquí. Esto se documentará como paso manual pendiente, no se simulará como funcional.

## Decisiones que cierran los huecos del brief

1. **Fotografías reales ausentes** → el brief ya lo contempla ("si todavía no existen, deja rutas centralizadas y placeholders elegantes"). Se crea `assets/photos/` con nombres de archivo esperados centralizados en `CONFIG.PHOTOS` (script.js). Mientras no existan los archivos, cada `<img>` usa `onerror` para sustituir por un placeholder editorial (SVG botánico + monograma, generado inline, sin iconos rotos).
2. **Fecha de la boda** → `CONFIG.WEDDING_DATE = null`; la UI muestra "Fecha por confirmar" en itálica dorada discreta, claramente editable en el objeto de configuración.
3. **Moderación** → configurable vía `PropertiesService` (`MODERATION_ENABLED`), por defecto `false` (publicación automática, álbum privado entre invitados). Si se activa, las fotos nuevas quedan `estado: pendiente` y `listPhotos` solo devuelve `publicado`.
4. **Descarga en lightbox** → configurable `CONFIG.ALLOW_DOWNLOAD = true` por defecto, usa el enlace directo de Drive.
5. **Favoritos** → `localStorage`, clave `wedding_favorites_v1`, array de IDs.
6. **Transporte de imagen al backend** → el cliente redimensiona/comprime en `<canvas>` y envía el blob como base64 dentro de un POST con `Content-Type: text/plain` (evita preflight CORS en Apps Script). El servidor decodifica y crea el archivo en Drive; **no se guarda base64 en las celdas de Sheets**, solo el ID de Drive y metadatos.
7. **Entorno de pruebas** → se sirve la carpeta con un servidor HTTP local (evita restricciones de `file://` sobre `fetch`) y se navega con Chrome DevTools (herramienta de navegador) en los viewports pedidos.

## Arquitectura

```
FotosBD/
├── index.html          # estructura semántica de las 6 secciones + álbum + galería + modal subida + lightbox
├── styles.css           # variables de diseño, mobile-first, animaciones
├── script.js            # CONFIG central, estado, render álbum, cola de subida, cliente API, favoritos, lightbox
├── assets/
│   ├── photos/          # fotos reales del usuario (a colocar) + este README
│   └── icons/           # (no se usa; los SVG van inline en el HTML/JS para poder controlar trazo/color)
└── apps-script/
    ├── Code.gs           # backend completo
    └── README_SETUP.md   # pasos manuales de despliegue
```

**Flujo de datos:** navegador optimiza imagen → `fetch(POST)` a Apps Script (`CONFIG.API_URL`) → `doPost` valida/guarda Blob en carpeta de Drive → registra fila en Sheet → responde JSON con metadatos → cliente inserta la foto en el álbum sin recargar. Al cargar la página, `doGet?action=list` pagina los registros publicados y el cliente construye las páginas del álbum y la cuadrícula.

## Componentes clave del frontend

- **Hero** (`#hero`): fondo con foto principal (o placeholder), monograma `R & R` animado, título, subtítulo, fecha configurable, scroll-cue.
- **Álbum interactivo** (`#album`): libro con 2 páginas en escritorio / 1 página en móvil, paginación por transform 3D (`rotateY` con `transform-style: preserve-3d`, backface-hidden, sombra dinámica vía capa `::after` con opacity animada, no box-shadow animado costoso), precarga de página ±1, bloqueo de controles durante la transición (`isAnimating` flag + `aria-disabled`), soporte teclado/swipe/click-en-borde.
- **Subida** (`#upload`): formulario con selección múltiple, dropzone, preview, categoría, nombre, dedicatoria, checkbox de consentimiento, cola de subida con concurrencia limitada (3), reintento exponencial (solo fallidos), idempotencia (`crypto.randomUUID()` por archivo), cancelación en cola, barra de progreso individual/global.
- **Galería complementaria** (`#gallery`): grid editorial con filtros por categoría, lazy loading (`loading="lazy"` + `IntersectionObserver` para animación de entrada), skeleton loaders, botón "Descubrir más recuerdos" (paginación), estado vacío/error, favoritos.
- **Lightbox**: overlay compartido entre álbum y galería, navegación anterior/siguiente, Escape, foco atrapado, descarga opcional.
- **Sistema de movimiento**: jerarquizado — hero (una vez), álbum (por interacción), scroll (`IntersectionObserver` + clases `.is-visible`), ambiental (ramas/partículas con `transform`/`opacity`, `will-change` puntual, pausado con `prefers-reduced-motion` y con `matchMedia('(prefers-reduced-motion: reduce)')`).

## Backend (`Code.gs`)

- `doGet(e)`: `action=health|list`.
- `doPost(e)`: `action=upload` (JSON en `postData.contents`, no multipart).
- Auto-creación de carpeta Drive y Sheet si no existen (guardando sus IDs en `PropertiesService`).
- Columnas de Sheet: `id, idempotencyKey, fileName, driveFileId, viewUrl, thumbUrl, category, guestName, dedication, mimeType, sizeBytes, createdAt, status`.
- `LockService.getScriptLock()` alrededor de escritura de fila + chequeo de idempotencia.
- `CacheService` (60s) para `list` con parámetros de categoría/página como clave.
- Validación: tipo MIME permitido, tamaño máximo (`PropertiesService.MAX_FILE_MB`, default 12MB tras compresión cliente), sanitización de texto (longitud máxima, strip de HTML) antes de guardar en Sheet, y el cliente nunca inserta esos textos con `innerHTML` (siempre `textContent`).
- Manejo de errores: cuotas de Drive, bloqueos no adquiridos, JSON inválido → respuestas `{ok:false, error:{code,message}}` consistentes.

## Pruebas planeadas

1. Servidor local + Chrome DevTools: consola sin errores, viewports 320/360/375/390/412/tablet/1366.
2. Interacción álbum: teclado, swipe simulado, click en bordes, orden de capas al pasar rápido varias veces seguidas.
3. Simulación de backend no desplegado (estado real actual) → verificar mensajes de error claros en vez de fallos silenciosos.
4. Cola de subida: archivo inválido, archivo grande, cancelación, reintento.
5. Filtros, lightbox, favoritos, `prefers-reduced-motion`.
6. Auditoría rápida de accesibilidad (roles, foco, contraste) con DevTools.

## Fuera de alcance (YAGNI)

- Autenticación de invitados.
- Panel de administración visual para moderar (se deja `estado` en Sheet, moderable manualmente por el dueño desde Google Sheets).
- Edición/borrado de fotos desde el cliente.
- Multi-idioma.
