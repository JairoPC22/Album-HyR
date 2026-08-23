> **PIVOTE 2026-08-21 (mismo día):** el usuario reformuló el encargo — ya no es un "libro interactivo" con páginas que giran, sino una **landing page** de una sola página (nav + hero + historia + galería masonry con filtros + sección editorial de destacadas + formulario de subida inline + cierre + footer). Se descarta todo el diseño de `Album` con flip 3D (Tasks 4/5 de la versión anterior de este plan). El resto de la arquitectura (CONFIG central, ApiClient, UploadQueue, Gallery, Lightbox, backend Apps Script) se conserva y se adapta. Los archivos `index.html`/`styles.css` se reescriben desde cero con la nueva estructura; este documento ya no se actualiza tarea por tarea porque la implementación continúa inline sin checkpoints, según instrucción explícita del usuario.

# Álbum de boda Héctor & Raquel — Implementation Plan

> **Ejecución:** por instrucción directa del usuario ("no te detengas después de planear"), este plan se ejecuta inline en la sesión actual, sin checkpoints de aprobación por tarea. Verificación mediante navegador (Chrome DevTools tool) en lugar de tests unitarios, dado que es un sitio estático sin framework de build/test.

**Goal:** Álbum digital colaborativo de boda — libro interactivo + galería + subida a Google Drive/Sheets vía Apps Script.

**Architecture:** `index.html` (semántico, 6 secciones + álbum + modal subida + lightbox) + `styles.css` (variables, mobile-first, animaciones) + `script.js` (CONFIG central, módulo álbum, módulo subida con cola, módulo galería/lightbox, cliente API) + `apps-script/Code.gs` (doGet/doPost, Drive+Sheets).

**Tech Stack:** HTML5, CSS3 (custom properties, Grid/Flexbox, transforms 3D), JavaScript ES2020+ vanilla (módulos IIFE, sin build step), Google Apps Script (V8 runtime).

## Global Constraints

- Sin emojis en ningún texto ni icono; solo SVG inline.
- Sin `innerHTML` para contenido enviado por usuarios (usar `textContent`/creación de nodos).
- Respetar `prefers-reduced-motion: reduce` en toda animación no esencial.
- Controles táctiles ≥ 44×44px; `font-size` ≥ 16px en inputs para evitar zoom en iOS.
- No sección/categoría llamada "Ceremonia".
- Nombres de sección y categorías exactamente como los especificó el usuario.
- `CONFIG.API_URL`, `CONFIG.WEDDING_DATE`, `CONFIG.CATEGORIES`, `CONFIG.PHOTOS` centralizados en `script.js`.
- No simular integración funcional: si `action=health` no responde `ok:true` con la forma esperada, la UI debe mostrar un estado de error explícito, no datos falsos.

---

### Task 1: Fundaciones — variables de diseño y esqueleto HTML semántico

**Files:**
- Create: `index.html`
- Create: `styles.css` (tokens: color, tipografía, espaciado, sombras, z-index, breakpoints)

**Interfaces:**
- Produce: estructura de secciones con IDs `#hero`, `#historia`, `#album`, `#subir`, `#destacadas`, `#gracias`, `footer`; contenedor `#lightbox`, `#modal-subida`, región `#aria-live-status[aria-live="polite"]`.

- [ ] Escribir `styles.css` con `:root` (paleta: `--color-marfil`, `--color-blanco-calido`, `--color-rosa-empolvado`, `--color-beige`, `--color-champagne`, `--color-gris-rosado`, `--color-taupe`, `--color-dorado`, `--color-carbon`), tipografía (`--font-serif`, `--font-sans` vía `@font-face`-free system stack editorial: `"Playfair Display", Georgia, serif` / `"Inter", system-ui, sans-serif` cargadas desde Google Fonts con `<link rel=preconnect>` + `display=swap`), breakpoints como comentarios de referencia, `prefers-reduced-motion` media query con reglas globales que anulan `animation`/`transition`.
- [ ] Escribir `index.html` con `<head>` (meta viewport, charset, description, Open Graph básico, preconnect fonts), `<body>` con las 6 secciones semánticas (`<header>`, `<main>` con `<section aria-labelledby>` por bloque, `<footer>`), monograma SVG inline `R & R`, botones con `aria-label`, formulario de subida con `<label for>` en cada campo, `<template>` para tarjeta de foto de galería y para item de cola de subida (evita `innerHTML` en JS).
- [ ] Verificación: abrir en navegador (servidor local), consola sin errores 404 críticos de recursos referenciados, HTML válido (revisar estructura visualmente).
- [ ] Commit no aplica (no es repo git).

### Task 2: Servidor local de pruebas y CONFIG inicial en script.js

**Files:**
- Create: `script.js` (solo objeto `CONFIG` + arranque `DOMContentLoaded` vacío por ahora)

**Interfaces:**
- Produce: `CONFIG = { API_URL, WEDDING_DATE, COUPLE_NAMES, CATEGORIES: [{id,label}], PHOTOS: {hero, albumCover, ...}, UPLOAD: {maxFileMB, maxDimension, concurrency, allowedMime}, ALLOW_DOWNLOAD, MODERATION_NOTE }`.

- [ ] Definir `CONFIG` completo con las 8 categorías pedidas (`todos`, `pareja`, `celebracion`, `gente-favorita`, `primer-baile`, `fiesta`, `espontaneos`, `detalles`) mapeadas a sus etiquetas exactas.
- [ ] `CONFIG.WEDDING_DATE = null;` con comentario explicando que se debe reemplazar por `"2026-MM-DD"` cuando se confirme.
- [ ] Levantar servidor local (`python -m http.server` o `npx serve`) para pruebas durante todo el desarrollo.
- [ ] Verificación: `console.log(CONFIG)` en DevTools muestra el objeto esperado sin errores de sintaxis.

### Task 3: Hero — animación de entrada

**Files:**
- Modify: `index.html` (`#hero` contenido final)
- Modify: `styles.css` (bloque hero + keyframes de entrada)
- Modify: `script.js` (función `initHero()`)

**Interfaces:**
- Consume: `CONFIG.COUPLE_NAMES`, `CONFIG.WEDDING_DATE`, `CONFIG.PHOTOS.hero`.
- Produce: `initHero()` invocada desde el bootstrap principal.

- [ ] CSS: `@keyframes` para fade del fondo, reveal de monograma (`clip-path` o `opacity`+`translateY`), reveal de foto principal con `clip-path: inset()` animado, ramas decorativas SVG con `transform: translateY` sutil vía scroll (parallax ligero con `--parallax` custom property actualizada en `requestAnimationFrame` con throttle).
- [ ] JS: `initHero()` añade clase `.is-ready` tras `DOMContentLoaded` (dispara animaciones CSS), maneja fallback de imagen con `onerror` → placeholder SVG generado inline (función `buildPlaceholder(label)` reutilizable).
- [ ] Todas las animaciones dentro de `@media (prefers-reduced-motion: no-preference)`; fallback estático accesible fuera de ese bloque.
- [ ] Verificación en navegador: recargar, observar secuencia (monograma → nombres → foto), sin salto de layout (CLS), medir con DevTools Performance que no haya jank evidente.

### Task 4: Módulo Álbum — modelo de datos y render de páginas

**Files:**
- Modify: `index.html` (`#album` con `.album-viewport`, `.album-page[data-side="left|right"]`, controles prev/next, indicador de página)
- Modify: `styles.css` (perspectiva 3D, `.page`, `.page__front/back`, sombra dinámica, layout de plantillas de página: foto-completa, collage-2, collage-3, foto+frase, portada-categoria, dedicatoria, editorial-nombres, transición)
- Modify: `script.js` (módulo `Album`)

**Interfaces:**
- Consume: array `state.pages` (cada página: `{id, template, data}`), `CONFIG.CATEGORIES`.
- Produce: `Album.init(pagesData)`, `Album.next()`, `Album.prev()`, `Album.goTo(index)`, `Album.destroy()`. Expone `Album.state.currentIndex` de solo lectura para otros módulos.

- [ ] Definir 8 plantillas de página como funciones `renderTemplateX(container, data)` que crean nodos DOM (sin `innerHTML`) para: foto completa, collage 2/3 fotos, foto+frase, portada de categoría, dedicatoria de invitado, editorial nombres+fecha, collage equilibrado, transición.
- [ ] Construir `state.pages` inicial con contenido propio de la boda (sin datos falsos de invitados; usar placeholders de fotos + textos reales del brief: frases, nombres, categorías) — las páginas que dependan de fotos de invitados se completan dinámicamente cuando lleguen datos de la API (Task 8).
- [ ] Implementar paginación con `rotateY` en `.page` usando `transform-style: preserve-3d`, `backface-visibility: hidden`, dos capas (`front`/`back`) para que nunca se vea el reverso incorrecto; sombra dinámica vía pseudo-elemento con `opacity` animada (no `box-shadow` costoso).
- [ ] Bloqueo de controles: flag `isAnimating`, `aria-disabled="true"` en botones durante la transición, se libera en el evento `transitionend` de la página animada.
- [ ] Precarga: al mostrar página N, precargar imágenes de N-1 y N+1 (`new Image().src = ...`).
- [ ] Navegación: click en botones, flechas de teclado (`ArrowLeft/ArrowRight`) cuando `#album` tiene el foco o está en viewport, swipe táctil (`touchstart/move/end` con umbral de distancia y velocidad, `touch-action: pan-y` para no interferir con scroll vertical), click en el 15% del borde de cada página.
- [ ] En móvil (`matchMedia('(max-width: 767px)')`): una sola página visible, mismo motor de datos, transición de deslizamiento horizontal en vez de rotación 3D (más barata y estable en gama baja).
- [ ] Verificación: en escritorio, avanzar/retroceder repetidamente rápido sin que se superpongan capas ni se vea contenido invertido; en móvil (DevTools device toolbar 375×667), swipe funcional sin scroll horizontal accidental de la página completa.

### Task 5: Fullscreen de fotografía del álbum

**Files:**
- Modify: `script.js` (reutiliza módulo `Lightbox` de Task 7, expuesto antes vía interfaz mínima)
- Modify: `index.html` / `styles.css` (botón "ver en pantalla completa" sobre cada foto de página)

**Interfaces:**
- Consume: `Lightbox.open(photoList, startIndex)` (definida en Task 7; Task 4 solo añade los botones y placeholders de datos — se conecta en Task 7).

- [ ] Añadir botón con icono SVG de expandir en cada plantilla de página que contenga foto, con `data-photo-id`.
- [ ] Dejar el manejador `onclick` preparado para llamar `Lightbox.open(...)`; se completa la implementación real en Task 7 (mismo archivo, sin placeholders de función — se implementa cuando exista el módulo).

### Task 6: Galería complementaria — grid, filtros, skeleton, estado vacío/error

**Files:**
- Modify: `index.html` (`#destacadas` grid, filtros, botón "Descubrir más recuerdos", contenedores de estado vacío/error/skeleton)
- Modify: `styles.css` (masonry vía CSS Grid `grid-template-rows: masonry` con fallback `column-count` para navegadores sin soporte, skeleton shimmer)
- Modify: `script.js` (módulo `Gallery`)

**Interfaces:**
- Consume: `ApiClient.listPhotos({category, cursor})` (definido en Task 8).
- Produce: `Gallery.init()`, `Gallery.applyFilter(categoryId)`, `Gallery.loadMore()`. Emite evento custom `photo:favorite-toggle` en `document` con `detail:{id}`.

- [ ] Construir tarjetas de foto vía `<template id="tpl-photo-card">`, clonado con `content.cloneNode(true)`, relleno con `textContent`/`src` (nunca `innerHTML`).
- [ ] Filtros como botones tipo "pill" con `aria-pressed`, transición de subrayado deslizante (`transform: translateX` sobre un indicador, no recreando layout).
- [ ] Skeleton loaders: placeholders con animación `background-position` (shimmer) mientras `Gallery` espera respuesta.
- [ ] Lazy loading real: `loading="lazy"` + `IntersectionObserver` para disparar animación de entrada (`.is-visible`) por tarjeta, con `rootMargin` amplio.
- [ ] Botón "Descubrir más recuerdos" pagina usando el cursor devuelto por la API; deshabilitado + spinner mientras carga; oculto cuando no hay más páginas.
- [ ] Estado vacío (sin fotos en esa categoría) y estado de error (fallo de red/API) con mensaje claro y botón "Reintentar".
- [ ] Favoritos: doble-click o botón de corazón-outline (SVG, no emoji) que alterna clase `.is-favorite`, persiste en `localStorage['wedding_favorites_v1']`, confirmación visual breve (micro-animación de escala + trazo del icono).
- [ ] Verificación: sin backend real disponible todavía, probar con datos de ejemplo inyectados manualmente en consola (`Gallery.__debugRender(mockPhotos)` — función auxiliar solo para esta verificación, se deja documentada como utilidad de desarrollo, no como dato falso de producción) que los filtros, skeleton→contenido, paginación y estado vacío/error se comporten bien; limpiar antes de cerrar la tarea si la función no aporta valor productivo (se puede dejar si es genuinamente útil para QA, documentada como tal).

### Task 7: Lightbox compartido

**Files:**
- Modify: `index.html` (`#lightbox` overlay, botones prev/next/cerrar/descargar, `<img>`, caption)
- Modify: `styles.css` (overlay con `backdrop-filter` sutil, transición de profundidad `scale`+`opacity`)
- Modify: `script.js` (módulo `Lightbox`)

**Interfaces:**
- Produce: `Lightbox.open(photos, startIndex)`, `Lightbox.close()`, `Lightbox.next()`, `Lightbox.prev()`.
- Se conecta a los botones dejados en Task 5 y a las tarjetas de Task 6.

- [ ] Implementar apertura con animación de profundidad, foco atrapado (`Tab`/`Shift+Tab` circulan dentro), cierre con Escape, click en overlay, botón cerrar.
- [ ] Navegación con flechas de teclado, botones, swipe táctil.
- [ ] Botón de descarga visible solo si `CONFIG.ALLOW_DOWNLOAD`, usa `viewUrl` de la foto con atributo `download`.
- [ ] Texto alternativo obligatorio (`alt` derivado de categoría + nombre de invitado si existe, o texto genérico "Fotografía de la boda de Héctor y Raquel").
- [ ] Verificación: abrir desde álbum y desde galería, navegar, cerrar con las 3 vías, probar en móvil que no se salga de la pantalla (viewport 320×568).

### Task 8: Cliente API + manejo de errores

**Files:**
- Modify: `script.js` (módulo `ApiClient`)

**Interfaces:**
- Produce: `ApiClient.health()`, `ApiClient.listPhotos({category, cursor, pageSize})`, `ApiClient.uploadPhoto({base64, mimeType, fileName, category, guestName, dedication, idempotencyKey}, {onProgress})` — todas retornan Promesas que resuelven `{ok:true, data}` o rechazan con `{ok:false, code, message}`.

- [ ] `fetch` con `AbortController` + `setTimeout` para timeout configurable (`CONFIG.API_TIMEOUT_MS`).
- [ ] POST con `Content-Type: text/plain;charset=utf-8` y cuerpo `JSON.stringify(payload)` (evita preflight CORS en Apps Script).
- [ ] Reintentos solo para errores recuperables (timeout, 429, 503) con backoff exponencial + jitter, máximo 3 intentos; errores 4xx de validación no se reintentan.
- [ ] Al arrancar la app: llamar `ApiClient.health()`; si falla o la forma de la respuesta no es la esperada, mostrar banner accesible ("El álbum en vivo no está disponible todavía") sin bloquear el resto de la página (hero/álbum estático siguen visibles), y desactivar el formulario de subida con mensaje explicativo en vez de dejarlo simular un envío exitoso.
- [ ] Verificación real contra el endpoint actual: confirmar que efectivamente falla de forma controlada (ya lo comprobamos con `curl`) y que la UI lo refleja correctamente en vez de quedarse colgada o mostrar datos inventados.

### Task 9: Formulario y cola de subida

**Files:**
- Modify: `index.html` (`#modal-subida` completo)
- Modify: `styles.css` (modal, dropzone, previews, barra de progreso)
- Modify: `script.js` (módulo `UploadQueue` + `UploadForm`)

**Interfaces:**
- Consume: `ApiClient.uploadPhoto`, `CONFIG.UPLOAD`.
- Produce: `UploadQueue.enqueue(fileEntry)`, `UploadQueue.retry(id)`, `UploadQueue.cancel(id)`, evento `document` `photo:uploaded` con `detail:{photo}` (consumido por `Gallery`/`Album` para insertar la nueva foto sin recargar).

- [ ] Selección múltiple (`<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif">`), dropzone con `dragover/drop`, acceso a cámara vía `capture` en móvil.
- [ ] Preview con `URL.createObjectURL`, botón eliminar por archivo antes de subir, revocar objectURL al quitar/cerrar.
- [ ] Pipeline de optimización por archivo: detectar HEIC/HEIF por tipo/extensión → si el navegador no puede decodificarlo (`createImageBitmap` falla), mostrar error claro por archivo ("Este formato no se pudo procesar en este navegador, intenta exportarlo como JPG") en vez de bloquear los demás; para formatos soportados, `createImageBitmap` con `imageOrientation: 'from-image'` (corrige orientación EXIF automáticamente), dibujar en `<canvas>` redimensionado a `CONFIG.UPLOAD.maxDimension`, exportar con `canvas.toBlob(..., 'image/jpeg', quality)` (esto también descarta metadatos EXIF no deseados al re-codificar).
- [ ] Cola con concurrencia limitada (`CONFIG.UPLOAD.concurrency`, ej. 3), cada item con estado `pendiente|subiendo|éxito|error|cancelado`, `idempotencyKey` generado una vez por archivo (`crypto.randomUUID()`) reutilizado en reintentos para evitar duplicados en el backend.
- [ ] Progreso individual (basado en fases: optimizando/subiendo/hecho, ya que `fetch` no da progreso real de subida sin streams — se documenta esta limitación) y progreso global (contador `n/N` + barra agregada).
- [ ] Reintento solo de fallidos (botón por item), cancelación de items en cola (`pendiente`) vía `AbortController` por item.
- [ ] Prevención de doble envío: deshabilitar botón "Subir" mientras hay items en `subiendo`, y usar la idempotencyKey como defensa adicional en servidor.
- [ ] Aviso de privacidad + checkbox de consentimiento obligatorio ("Acepto que esta fotografía se comparta en el álbum de Héctor y Raquel") antes de habilitar el envío.
- [ ] `beforeunload` con advertencia si hay subidas en curso.
- [ ] Verificación: intentar subir con backend no disponible (estado real actual) → cada archivo debe terminar en estado "error" con mensaje claro y botón reintentar, sin colgarse; probar cancelación y eliminación de previews.

### Task 10: Backend Apps Script

**Files:**
- Create: `apps-script/Code.gs`

**Interfaces:**
- Produce endpoints consumidos por `ApiClient` (Task 8): `GET ?action=health`, `GET ?action=list&category=&cursor=&pageSize=`, `POST {action:'upload', ...}`.

- [ ] `doGet(e)`: switch por `e.parameter.action`; `health` retorna `{ok:true,data:{status:'ok',time}}`; `list` valida parámetros, usa `CacheService.getScriptCache()` (clave = categoría+cursor+pageSize, TTL 60s), si falla el cache consulta la Sheet, filtra por `estado === 'publicado'`, ordena por fecha desc, aplica cursor/pageSize, devuelve `{ok:true,data:{items,nextCursor}}`.
- [ ] `doPost(e)`: parsea `JSON.parse(e.postData.contents)`, valida campos requeridos y tipos MIME permitidos, tamaño máximo (`PropertiesService`), sanitiza `guestName`/`dedication` (recorta longitud, elimina etiquetas HTML con regex simple), calcula/verifica `idempotencyKey` contra la Sheet (si ya existe, devuelve el registro existente en vez de duplicar) dentro de `LockService.getScriptLock().tryLock(10000)`.
- [ ] Guardado en Drive: `DriveApp.getFolderById(getOrCreateFolderId())`, `folder.createFile(Utilities.newBlob(...))`, `file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)`, construir `viewUrl`/`thumbUrl` a partir del ID de archivo.
- [ ] `getOrCreateFolderId()` / `getOrCreateSheet()`: buscan ID guardado en `PropertiesService.getScriptProperties()`; si no existe, crean carpeta "Boda Héctor y Raquel - Fotos" / Sheet "Boda Héctor y Raquel - Registro" con encabezados, guardan el ID.
- [ ] Moderación: leer `PropertiesService.getScriptProperties().getProperty('MODERATION_ENABLED')`; si `'true'`, nuevo registro con `estado='pendiente'`; si no, `estado='publicado'`.
- [ ] Manejo de errores/cuota: `try/catch` alrededor de operaciones de Drive/Sheets, capturar `Exception` de cuota y devolver `{ok:false,error:{code:'QUOTA_EXCEEDED',message:'...'}}`; registrar incidencias con `console.error` (Stackdriver) sin exponer detalles internos al cliente.
- [ ] Respuesta uniforme vía `jsonResponse_(payload)` helper que fija `ContentService.createTextOutput(...).setMimeType(ContentService.MimeType.JSON)`.
- [ ] Verificación: no se puede ejecutar Apps Script fuera del editor de Google del usuario; se documenta en README_SETUP.md cómo desplegarlo y probarlo con `curl`/navegador una vez pegado el código.

### Task 11: `apps-script/README_SETUP.md`

**Files:**
- Create: `apps-script/README_SETUP.md`

- [ ] Documentar paso a paso: abrir el proyecto Apps Script existente (o crear uno nuevo), pegar `Code.gs`, guardar, `Implementar > Nueva implementación > Aplicación web`, ejecutar como "Yo", acceso "Cualquier usuario", copiar URL resultante, actualizar `CONFIG.API_URL` en `script.js` si cambia.
- [ ] Documentar cómo activar/desactivar moderación y cambiar el tamaño máximo vía `PropertiesService` (menú "Editor de propiedades del script" o función `configurarPropiedades()` incluida en `Code.gs` para ejecutar una vez).
- [ ] Documentar limitaciones reales de Apps Script: cuota diaria de `UrlFetch`/ejecución, límite ~50MB por request de `doPost` (pero el cliente ya comprime), límite de ejecución de 6 minutos, `ContentService` no soporta CORS preflight por eso se usa `text/plain`, la primera petición tras redeploy puede tardar (cold start), los permisos de Drive deben aceptarse manualmente la primera vez (pantalla de autorización de Google).
- [ ] Checklist de verificación manual para el usuario (probar `?action=health` en el navegador, probar subida de una foto de prueba, revisar que aparezca en Drive y en la fila de la Sheet).

### Task 12: Movimiento ambiental, scroll y microinteracciones restantes

**Files:**
- Modify: `styles.css`, `script.js`

- [ ] `IntersectionObserver` genérico (`observeReveal(selector)`) para animar entrada de títulos/líneas decorativas/secciones al hacer scroll, con `threshold` bajo y `once: true` por elemento.
- [ ] Partículas de luz doradas sutiles: canvas ligero o `div`s posicionados con `transform`, cantidad reducida automáticamente si `navigator.hardwareConcurrency <= 4` o `prefers-reduced-motion`.
- [ ] Pétalos discretos solo en 1-2 momentos (ej. al completar una subida con éxito), cantidad baja (≤8), animación con `transform`+`opacity`, autodestrucción del nodo al terminar.
- [ ] Estados de foco visibles (`:focus-visible` con contorno dorado), navegación completa por teclado verificada en toda la página.
- [ ] Región `aria-live="polite"` centralizada para anuncios de estado (subida completada, error, filtro aplicado).

### Task 13: Verificación final cross-device y correcciones

- [ ] Servir con servidor local, abrir con la herramienta de navegador (Chrome DevTools) en viewports 320×568, 360×800, 375×667, 390×844, 412×915, tablet (768×1024), 1366×768.
- [ ] Revisar consola en cada tamaño (sin errores), revisar `Lighthouse`/panel de rendimiento y accesibilidad disponibles en DevTools.
- [ ] Probar teclado completo (Tab a través de toda la página), swipe simulado en device toolbar, mouse en escritorio.
- [ ] Confirmar que no hay scroll horizontal accidental en ningún viewport (`document.documentElement.scrollWidth <= window.innerWidth`).
- [ ] Corregir cualquier hallazgo y repetir la verificación afectada.

---

## Self-review

- Cobertura: cada sección del brief (hero, historia, álbum, subida, destacadas, cierre, categorías, animaciones, subida robusta, backend, README, accesibilidad, responsive) tiene tarea asignada (1–13).
- Placeholders: la única función auxiliar de depuración (`Gallery.__debugRender`) está explícitamente marcada como utilidad de QA, no como dato falso de producción, y solo se usa mientras el backend real no está desplegado.
- Consistencia de nombres: `ApiClient`, `Album`, `Gallery`, `Lightbox`, `UploadQueue`/`UploadForm`, `CONFIG` se usan de forma consistente entre tareas.
