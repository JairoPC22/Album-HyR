'use strict';
// CONFIG vive en config.js (compartido con admin.html) — cargar ese script
// antes que este en cualquier página que use script.js.

/* ==========================================================================
   UTILIDADES GENERALES
   ========================================================================== */
const $ = (sel, ctx) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isLowPowerDevice() {
  return (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || prefersReducedMotion();
}

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function announce(message, assertive) {
  const region = document.getElementById(assertive ? 'aria-live-alert' : 'aria-live-status');
  if (region) region.textContent = message;
}

function emit(name, detail) { document.dispatchEvent(new CustomEvent(name, { detail })); }
function on(name, handler) { document.addEventListener(name, handler); }

/** Genera un id de idempotencia por archivo (evita duplicados ante reintentos). */
function newIdempotencyKey() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Convierte un Blob en base64 puro (sin el prefijo data:...;base64,). */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(blob);
  });
}

function categoryLabel(id) {
  const found = CONFIG.CATEGORIES.find((c) => c.id === id);
  return found ? found.label : 'general';
}

/**
 * Lanza un pequeño gesto festivo de pétalos cayendo desde un punto de origen.
 * Se usa solo en dos momentos puntuales (subida exitosa, cierre) — nunca de
 * forma continua — y respeta prefers-reduced-motion.
 */
function lanzarPetalos(origenRect, cantidad = 6) {
  if (prefersReducedMotion() || !origenRect) return;
  const total = Math.min(cantidad, 8);
  for (let i = 0; i < total; i += 1) {
    const petalo = document.createElement('div');
    petalo.className = 'petalo';
    petalo.setAttribute('aria-hidden', 'true');
    const x = origenRect.left + origenRect.width * Math.random();
    const y = origenRect.top + origenRect.height * 0.25;
    petalo.style.left = `${x}px`;
    petalo.style.top = `${y}px`;
    petalo.style.setProperty('--deriva-x', `${((Math.random() - 0.5) * 100).toFixed(0)}px`);
    petalo.style.setProperty('--caida', `${(170 + Math.random() * 140).toFixed(0)}px`);
    petalo.style.setProperty('--rotacion', `${(180 + Math.random() * 260).toFixed(0)}deg`);
    petalo.style.animation = `petaloCaer ${(1300 + Math.random() * 700).toFixed(0)}ms ease-in forwards`;
    document.body.appendChild(petalo);
    petalo.addEventListener('animationend', () => petalo.remove(), { once: true });
  }
}

/* ---------- Marcadores elegantes para fotografías ausentes o rotas ---------- */
function placeholderDataUri({ tone = 'suave' } = {}) {
  const bg = tone === 'suave'
    ? ['#EFE4D3', '#E7CFC9']
    : ['#E9DAC1', '#D9CCC8'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${bg[0]}"/>
        <stop offset="1" stop-color="${bg[1]}"/>
      </linearGradient>
    </defs>
    <rect width="800" height="1000" fill="url(#g)"/>
    <g transform="translate(400,470)" fill="none" stroke="#8C6E3F" stroke-width="2" opacity="0.75">
      <rect x="-70" y="-70" width="140" height="140" rx="10"/>
      <circle cx="-28" cy="-24" r="14"/>
      <path d="M-58 34 L-14 -6 L20 22 L48 -10 L58 4" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <text x="400" y="580" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="26" fill="#8C6E3F">H &amp; R</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** Aplica el fallback elegante ante cualquier error de carga de imagen. */
function withPlaceholderFallback(img, tone) {
  img.addEventListener('error', function onError() {
    img.removeEventListener('error', onError);
    img.src = placeholderDataUri({ tone });
  }, { once: true });
}

function initConfiguredPhotos() {
  $$('[data-photo-key]').forEach((img) => {
    const key = img.getAttribute('data-photo-key');
    const src = CONFIG.PHOTOS[key];
    withPlaceholderFallback(img, 'suave');
    img.src = src || placeholderDataUri({ tone: 'suave' });
  });
}

/* ==========================================================================
   NAVEGACIÓN (barra fija + menú móvil accesible + scroll suave)
   ========================================================================== */
const NavModule = (() => {
  let menuAbierto = false;
  let ultimoFocoPrevio = null;

  function elementos() {
    return {
      nav: $('#nav'),
      boton: $('#btn-menu-movil'),
      menu: $('#menu-movil'),
      overlay: $('#menu-movil-overlay'),
    };
  }

  function abrirMenu() {
    const { nav, boton, menu, overlay } = elementos();
    menuAbierto = true;
    ultimoFocoPrevio = document.activeElement;
    nav.dataset.menuOpen = 'true';
    boton.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    overlay.hidden = false;
    document.body.classList.add('no-scroll');
    const primerEnlace = menu.querySelector('a');
    if (primerEnlace) primerEnlace.focus();
    document.addEventListener('keydown', onKeydownMenu);
  }

  function cerrarMenu() {
    const { nav, boton, menu, overlay } = elementos();
    menuAbierto = false;
    nav.dataset.menuOpen = 'false';
    boton.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    overlay.hidden = true;
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKeydownMenu);
    if (ultimoFocoPrevio && document.contains(ultimoFocoPrevio)) ultimoFocoPrevio.focus();
    else boton.focus();
  }

  function onKeydownMenu(e) {
    if (e.key === 'Escape') { cerrarMenu(); return; }
    if (e.key !== 'Tab') return;
    const { menu } = elementos();
    const focusables = $$('a, button', menu).filter((el) => !el.hidden);
    if (!focusables.length) return;
    const primero = focusables[0];
    const ultimo = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }

  function scrollASeccion(id) {
    const destino = document.getElementById(id);
    if (!destino) return;
    const navAltura = $('#nav').offsetHeight;
    const top = destino.getBoundingClientRect().top + window.scrollY - navAltura + 1;
    window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function init() {
    const { boton, overlay } = elementos();
    boton.addEventListener('click', () => (menuAbierto ? cerrarMenu() : abrirMenu()));
    overlay.addEventListener('click', cerrarMenu);
    $$('[data-cerrar-menu]').forEach((el) => el.addEventListener('click', () => { if (menuAbierto) cerrarMenu(); }));

    document.addEventListener('click', (e) => {
      const disparador = e.target.closest('[data-scroll-to]');
      if (!disparador) return;
      e.preventDefault();
      scrollASeccion(disparador.getAttribute('data-scroll-to'));
    });
  }

  return { init };
})();

/* ==========================================================================
   HERO — animación de entrada + parallax discreto
   ========================================================================== */
const HeroModule = (() => {
  function init() {
    const hero = $('#hero');
    if (!hero) return;
    requestAnimationFrame(() => hero.classList.add('is-ready'));

    if (prefersReducedMotion() || isLowPowerDevice()) return;

    const capas = $$('[data-parallax]', hero);
    if (!capas.length) return;
    let ticking = false;

    function actualizarParallax() {
      const scrollY = window.scrollY;
      const heroAltura = hero.offsetHeight;
      if (scrollY > heroAltura) { ticking = false; return; }
      const progreso = scrollY / heroAltura;
      capas.forEach((capa) => {
        const factor = parseFloat(capa.getAttribute('data-parallax')) || 0.2;
        capa.style.transform = `translate3d(0, ${(progreso * factor * 120).toFixed(1)}px, 0)`;
      });
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(actualizarParallax); ticking = true; }
    }, { passive: true });
  }

  return { init };
})();

/* ==========================================================================
   REVELADOS AL HACER SCROLL (IntersectionObserver genérico)
   ========================================================================== */
const ScrollRevealModule = (() => {
  function init() {
    const elementosRevelables = $$('.reveal-on-scroll, .section-rule');
    if (!elementosRevelables.length) return;

    if (prefersReducedMotion()) {
      elementosRevelables.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver((entradas) => {
      entradas.forEach((entrada) => {
        if (!entrada.isIntersecting) return;
        const el = entrada.target;
        const retraso = parseInt(el.getAttribute('data-reveal-delay') || '0', 10);
        setTimeout(() => el.classList.add('is-visible'), retraso);
        observer.unobserve(el);
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });

    elementosRevelables.forEach((el) => observer.observe(el));

    // Red de seguridad: si por lo que sea el observer nunca detecta que un
    // elemento entró en pantalla (un salto de navegación directo a otra
    // sección, un elemento con tamaño mal calculado, etc.), ese contenido
    // quedaría invisible PARA SIEMPRE — nunca es aceptable para fotos reales
    // de la boda. A los pocos segundos se revela cualquier cosa que se haya
    // quedado pendiente, se haya visto o no la animación.
    setTimeout(() => {
      elementosRevelables.forEach((el) => el.classList.add('is-visible'));
      observer.disconnect();
    }, 4000);
  }
  return { init };
})();

/* ==========================================================================
   NUESTRA HISTORIA — línea de tiempo editorial (contenido propio de la pareja)
   ========================================================================== */
const HistoriaMomentosModule = (() => {
  function init() {
    const lista = $('#historia-momentos');
    if (!lista) return;
    CONFIG.COUPLE_STORY.forEach((momento, indice) => {
      const item = document.createElement('li');
      item.className = 'historia-momento reveal-on-scroll';
      item.setAttribute('data-reveal-delay', String(indice * 140));

      const marcador = document.createElement('span');
      marcador.className = 'historia-momento__marcador';
      marcador.setAttribute('aria-hidden', 'true');
      marcador.textContent = String(indice + 1).padStart(2, '0');

      const titulo = document.createElement('h4');
      titulo.className = 'historia-momento__titulo';
      titulo.textContent = momento.title;

      const texto = document.createElement('p');
      texto.className = 'historia-momento__texto';
      texto.textContent = momento.text;

      item.append(marcador, titulo, texto);
      lista.appendChild(item);
    });
  }
  return { init };
})();

/* ==========================================================================
   PARTÍCULAS AMBIENTALES — muy discretas, solo en el hero
   ========================================================================== */
const ParticlesModule = (() => {
  function init() {
    if (prefersReducedMotion() || isLowPowerDevice()) return;
    const hero = $('#hero');
    if (!hero) return;
    const cantidad = 10;
    const particulas = [];

    for (let i = 0; i < cantidad; i += 1) {
      const el = document.createElement('div');
      el.className = 'particula';
      el.setAttribute('aria-hidden', 'true');
      const tam = 3 + Math.random() * 4;
      el.style.width = `${tam}px`;
      el.style.height = `${tam}px`;
      document.body.appendChild(el);
      particulas.push({
        el,
        x: Math.random() * window.innerWidth,
        y: Math.random() * hero.offsetHeight,
        velocidad: 0.15 + Math.random() * 0.25,
        deriva: (Math.random() - 0.5) * 0.3,
        fase: Math.random() * Math.PI * 2,
      });
    }

    let activo = true;
    const observadorHero = new IntersectionObserver((entradas) => {
      activo = entradas[0].isIntersecting;
    });
    observadorHero.observe(hero);

    function loop() {
      if (activo) {
        particulas.forEach((p) => {
          p.y -= p.velocidad;
          p.fase += 0.01;
          if (p.y < -10) p.y = hero.offsetHeight + 10;
          const x = p.x + Math.sin(p.fase) * 12;
          p.el.style.opacity = String(0.35 + Math.sin(p.fase) * 0.15);
          p.el.style.transform = `translate3d(${x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
        });
      } else {
        // Fuera del hero: se ocultan por completo para no "flotar" sobre otras secciones
        // (son fixed y sus coordenadas están calculadas relativas al viewport del hero).
        particulas.forEach((p) => { p.el.style.opacity = '0'; });
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
  return { init };
})();

/* ==========================================================================
   CLIENTE API — comunicación con Apps Script
   ========================================================================== */
const ApiClient = (() => {
  const ERRORES_RECUPERABLES = new Set(['TIMEOUT', 'RED', 'SERVIDOR_OCUPADO']);

  function esperar(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async function peticion(url, opciones, { reintentable = true } = {}) {
    let intento = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const controlador = new AbortController();
      const timeoutId = setTimeout(() => controlador.abort(), CONFIG.API_TIMEOUT_MS);
      try {
        const respuesta = await fetch(url, { ...opciones, signal: controlador.signal });
        clearTimeout(timeoutId);
        if (respuesta.status === 429 || respuesta.status >= 500) {
          throw Object.assign(new Error('SERVIDOR_OCUPADO'), { codigo: 'SERVIDOR_OCUPADO' });
        }
        let cuerpo;
        try { cuerpo = await respuesta.json(); }
        catch { throw Object.assign(new Error('RESPUESTA_INVALIDA'), { codigo: 'RESPUESTA_INVALIDA' }); }

        if (!respuesta.ok || cuerpo.ok === false) {
          const codigo = (cuerpo.error && cuerpo.error.code) || 'ERROR_DESCONOCIDO';
          const mensaje = (cuerpo.error && cuerpo.error.message) || 'Ocurrió un problema al comunicarse con el álbum.';
          throw Object.assign(new Error(mensaje), { codigo });
        }
        return cuerpo.data;
      } catch (err) {
        clearTimeout(timeoutId);
        const codigo = err.name === 'AbortError' ? 'TIMEOUT' : (err.codigo || 'RED');
        intento += 1;
        const puedeReintentar = reintentable && ERRORES_RECUPERABLES.has(codigo) && intento <= CONFIG.API_MAX_RETRIES;
        if (!puedeReintentar) throw Object.assign(new Error(err.message || 'No se pudo completar la solicitud.'), { codigo });
        const espera = Math.min(4000, 400 * 2 ** intento) + Math.random() * 200;
        await esperar(espera);
      }
    }
  }

  function health() {
    return peticion(`${CONFIG.API_URL}?action=health`, { method: 'GET' });
  }

  function listPhotos({ category = 'todos', cursor = '', pageSize = CONFIG.PAGE_SIZE } = {}) {
    const params = new URLSearchParams({ action: 'list', category, cursor, pageSize: String(pageSize) });
    return peticion(`${CONFIG.API_URL}?${params.toString()}`, { method: 'GET' });
  }

  /** Envía como text/plain para evitar el preflight CORS que Apps Script no resuelve bien. */
  function uploadPhoto(payload) {
    return peticion(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'upload', ...payload }),
    }, { reintentable: false });
  }

  function verifyEventCode(code) {
    return peticion(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'verifyCode', code }),
    }, { reintentable: false });
  }

  return { health, listPhotos, uploadPhoto, verifyEventCode };
})();

/* ==========================================================================
   FAVORITOS — persistencia local
   ========================================================================== */
const FavoritesModule = (() => {
  const CLAVE = 'wedding_favorites_v1';

  function obtener() {
    try { return new Set(JSON.parse(localStorage.getItem(CLAVE) || '[]')); }
    catch { return new Set(); }
  }

  function guardar(conjunto) {
    try { localStorage.setItem(CLAVE, JSON.stringify(Array.from(conjunto))); } catch { /* almacenamiento no disponible */ }
  }

  function esFavorita(id) { return obtener().has(id); }

  function alternar(id) {
    const conjunto = obtener();
    const yaEstaba = conjunto.has(id);
    if (yaEstaba) conjunto.delete(id); else conjunto.add(id);
    guardar(conjunto);
    emit('favorito:cambio', { id, favorita: !yaEstaba });
    return !yaEstaba;
  }

  function listar() { return Array.from(obtener()); }

  return { esFavorita, alternar, listar };
})();

/* ==========================================================================
   ESTADO COMPARTIDO DE FOTOGRAFÍAS
   ========================================================================== */
const PhotoStore = (() => {
  const porId = new Map();
  function registrar(foto) { porId.set(foto.id, foto); }
  function registrarVarias(fotos) { fotos.forEach(registrar); }
  function obtener(id) { return porId.get(id); }
  return { registrar, registrarVarias, obtener };
})();

/* ==========================================================================
   GALERÍA — filtros, cuadrícula editorial, paginación, estados
   ========================================================================== */
const GalleryModule = (() => {
  const state = { categoriaActual: 'todos', cursor: '', cargando: false, error: null, fotos: [], totalActual: null, modoFavoritas: false };
  let elementos = {};

  function cachearElementos() {
    elementos = {
      filtros: $('#galeria-filtros'),
      grid: $('#galeria-grid'),
      vacio: $('#galeria-vacio'),
      error: $('#galeria-error'),
      errorMensaje: $('#galeria-error-mensaje'),
      reintentar: $('#galeria-reintentar'),
      cargarMas: $('#galeria-cargar-mas'),
      contador: $('#galeria-contador'),
    };
    elementos.vacioTextoDefault = elementos.vacio.textContent;
  }

  function renderFiltros() {
    const indicador = document.createElement('span');
    indicador.className = 'filtro-pill__indicador';
    indicador.setAttribute('aria-hidden', 'true');
    elementos.filtros.appendChild(indicador);
    elementos.indicador = indicador;

    CONFIG.CATEGORIES.forEach((categoria) => {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'filtro-pill';
      boton.textContent = categoria.label;
      boton.setAttribute('aria-pressed', String(categoria.id === state.categoriaActual));
      boton.dataset.categoria = categoria.id;
      elementos.filtros.appendChild(boton);
    });

    const botonFavoritas = document.createElement('button');
    botonFavoritas.type = 'button';
    botonFavoritas.className = 'filtro-pill filtro-pill--favoritas';
    botonFavoritas.setAttribute('aria-pressed', 'false');
    botonFavoritas.dataset.favoritas = 'true';
    const iconoFav = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconoFav.setAttribute('aria-hidden', 'true');
    const usoFav = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    usoFav.setAttribute('href', '#icon-heart');
    iconoFav.appendChild(usoFav);
    botonFavoritas.append(iconoFav, document.createTextNode('Mis favoritas'));
    elementos.filtros.appendChild(botonFavoritas);

    requestAnimationFrame(() => moverIndicador($('.filtro-pill[aria-pressed="true"]', elementos.filtros)));

    elementos.filtros.addEventListener('click', (e) => {
      const boton = e.target.closest('.filtro-pill');
      if (!boton || state.cargando) return;

      if (boton.dataset.favoritas) {
        const activar = boton.getAttribute('aria-pressed') !== 'true';
        $$('.filtro-pill', elementos.filtros).forEach((b) => b.setAttribute('aria-pressed', String(b === boton && activar)));
        $('use', boton).setAttribute('href', activar ? '#icon-heart-filled' : '#icon-heart');
        moverIndicador(activar ? boton : $(`.filtro-pill[data-categoria="${state.categoriaActual}"]`, elementos.filtros));
        if (activar) mostrarFavoritas(); else cargar({ reiniciar: true });
        return;
      }

      const nuevaCategoria = boton.dataset.categoria;
      if (nuevaCategoria === state.categoriaActual && !state.modoFavoritas) return;
      $$('.filtro-pill', elementos.filtros).forEach((b) => b.setAttribute('aria-pressed', String(b === boton)));
      moverIndicador(boton);
      state.categoriaActual = nuevaCategoria;
      state.cursor = '';
      state.modoFavoritas = false;
      cargar({ reiniciar: true });
    });
  }

  function moverIndicador(boton) {
    const indicador = elementos.indicador;
    if (!indicador) return;
    if (!boton) { indicador.style.opacity = '0'; return; }
    const contenedorRect = elementos.filtros.getBoundingClientRect();
    const botonRect = boton.getBoundingClientRect();
    indicador.style.opacity = '1';
    indicador.style.width = `${botonRect.width}px`;
    indicador.style.transform = `translateX(${(botonRect.left - contenedorRect.left).toFixed(1)}px)`;
  }

  function mostrarFavoritas() {
    state.modoFavoritas = true;
    state.cargando = false;
    const favoritas = FavoritesModule.listar().map((id) => PhotoStore.obtener(id)).filter(Boolean);
    elementos.grid.innerHTML = '';
    elementos.error.hidden = true;
    elementos.cargarMas.hidden = true;
    favoritas.forEach((foto, i) => elementos.grid.appendChild(crearTarjetaFoto(foto, i)));
    requestAnimationFrame(revelarTarjetasVisibles);
    elementos.vacio.hidden = favoritas.length !== 0;
    elementos.vacio.textContent = favoritas.length === 0
      ? 'Aún no marcaste ninguna fotografía como favorita. Toca el corazón en cualquier foto para guardarla aquí.'
      : '';
    elementos.contador.textContent = favoritas.length
      ? `${favoritas.length} favorita${favoritas.length === 1 ? '' : 's'} en este dispositivo`
      : '';
    announce(`${favoritas.length} fotografías favoritas.`);
  }

  /**
   * Antes se le asignaba a cada tarjeta una proporción al azar (ciclando
   * 4/5, 1/1, 3/4) sin importar la forma real de la foto — una foto
   * panorámica podía terminar forzada en una caja vertical y el
   * object-fit:cover la recortaba muy mal. Ahora se usa el ancho/alto real
   * de la foto (ya guardado al subirla), acotado para que la cuadrícula
   * masonry no termine con columnas absurdamente altas o angostas.
   */
  function calcularRatioTarjeta(foto, indice) {
    const ancho = Number(foto.width) || 0;
    const alto = Number(foto.height) || 0;
    if (ancho > 0 && alto > 0) return String(clamp(ancho / alto, 0.62, 1.35));
    const ratios = ['4/5', '1/1', '3/4', '4/5'];
    return ratios[indice % ratios.length];
  }

  function crearTarjetaFoto(foto, indice) {
    const tpl = $('#tpl-photo-card');
    const nodo = tpl.content.firstElementChild.cloneNode(true);
    const boton = $('.foto-card__boton', nodo);
    const marco = $('.foto-card__marco', nodo);
    const img = $('.foto-card__img', nodo);
    const categoriaEl = $('.foto-card__categoria', nodo);
    const invitadoEl = $('.foto-card__invitado', nodo);
    const favBtn = $('.foto-card__favorito', nodo);

    marco.style.setProperty('--ratio', calcularRatioTarjeta(foto, indice));

    withPlaceholderFallback(img, 'foto');
    img.src = foto.thumbUrl || foto.viewUrl || placeholderDataUri({ tone: 'foto' });
    img.alt = foto.dedication
      ? `Fotografía de ${categoryLabel(foto.category)} compartida por ${foto.guestName || 'un invitado'}`
      : `Fotografía de ${categoryLabel(foto.category)}`;

    categoriaEl.textContent = categoryLabel(foto.category);
    if (!CONFIG.FEATURES.hideGuestName && foto.guestName) invitadoEl.textContent = foto.guestName;
    else invitadoEl.remove();

    if (!CONFIG.FEATURES.allowFavorites) {
      favBtn.remove();
    } else {
      const favorita = FavoritesModule.esFavorita(foto.id);
      favBtn.setAttribute('aria-pressed', String(favorita));
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nuevoEstado = FavoritesModule.alternar(foto.id);
        favBtn.setAttribute('aria-pressed', String(nuevoEstado));
        announce(nuevoEstado ? 'Fotografía guardada en favoritos.' : 'Fotografía quitada de favoritos.');
        if (state.modoFavoritas && !nuevoEstado) {
          nodo.style.transition = `opacity ${prefersReducedMotion() ? '1ms' : '260ms'} ease-out`;
          nodo.style.opacity = '0';
          setTimeout(() => {
            nodo.remove();
            if (!$('.foto-card', elementos.grid)) mostrarFavoritas();
          }, prefersReducedMotion() ? 0 : 260);
        }
      });
    }

    boton.addEventListener('click', () => {
      LightboxModule.open(state.fotos, state.fotos.findIndex((f) => f.id === foto.id));
    });

    nodo.dataset.id = foto.id;
    return nodo;
  }

  function revelarTarjetasVisibles() {
    const observer = new IntersectionObserver((entradas) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting) { entrada.target.classList.add('is-visible'); observer.unobserve(entrada.target); }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
    $$('.foto-card:not(.is-visible)', elementos.grid).forEach((tarjeta) => observer.observe(tarjeta));
  }

  function renderSkeletons(cantidad) {
    const tpl = $('#tpl-photo-skeleton');
    for (let i = 0; i < cantidad; i += 1) {
      const nodo = tpl.content.firstElementChild.cloneNode(true);
      nodo.classList.add('foto-card--skeleton-temp');
      elementos.grid.appendChild(nodo);
    }
  }

  function limpiarSkeletons() {
    $$('.foto-card--skeleton-temp', elementos.grid).forEach((n) => n.remove());
  }

  async function cargar({ reiniciar = false } = {}) {
    if (state.cargando) return;
    state.cargando = true;
    state.modoFavoritas = false;
    state.error = null;
    elementos.error.hidden = true;
    elementos.vacio.hidden = true;
    elementos.vacio.textContent = elementos.vacioTextoDefault;
    elementos.cargarMas.disabled = true;

    if (reiniciar) {
      elementos.grid.innerHTML = '';
      state.fotos = [];
    }
    renderSkeletons(reiniciar ? 8 : 4);
    announce('Cargando fotografías…');

    try {
      const datos = await ApiClient.listPhotos({ category: state.categoriaActual, cursor: state.cursor, pageSize: CONFIG.PAGE_SIZE });
      limpiarSkeletons();
      PhotoStore.registrarVarias(datos.items);
      state.fotos = reiniciar ? datos.items.slice() : state.fotos.concat(datos.items);
      state.cursor = datos.nextCursor || '';

      datos.items.forEach((foto, i) => elementos.grid.appendChild(crearTarjetaFoto(foto, state.fotos.length - datos.items.length + i)));
      requestAnimationFrame(revelarTarjetasVisibles);

      elementos.cargarMas.hidden = !state.cursor;
      elementos.cargarMas.disabled = false;
      elementos.vacio.hidden = state.fotos.length !== 0;
      actualizarContador(datos.total);
      announce(`${state.fotos.length} fotografías cargadas.`);
      emit('galeria:fotos-cargadas', { fotos: state.fotos, categoria: state.categoriaActual });
    } catch (err) {
      limpiarSkeletons();
      state.error = err;
      elementos.error.hidden = false;
      elementos.cargarMas.hidden = true;
      elementos.errorMensaje.textContent = mensajeErrorAmigable(err);
      elementos.contador.textContent = '';
      announce('No se pudieron cargar las fotografías.', true);
    } finally {
      state.cargando = false;
    }
  }

  function mensajeErrorAmigable(err) {
    const codigo = err && err.codigo;
    if (codigo === 'TIMEOUT') return 'El álbum está tardando demasiado en responder. Verifica tu conexión e inténtalo de nuevo.';
    if (codigo === 'RED') return 'No pudimos conectarnos con el álbum en línea. Revisa tu conexión a internet.';
    if (codigo === 'SERVIDOR_OCUPADO') return 'El álbum está recibiendo muchas visitas en este momento. Intenta de nuevo en un momento.';
    return 'El álbum en línea todavía no está disponible. Vuelve a intentarlo más tarde.';
  }

  function actualizarContador(total) {
    if (typeof total !== 'number') { elementos.contador.textContent = ''; return; }
    state.totalActual = total;
    const plural = total === 1 ? '' : 's';
    elementos.contador.textContent = state.categoriaActual === 'todos'
      ? `${total} recuerdo${plural} compartido${plural} hasta ahora`
      : `${total} recuerdo${plural} en "${categoryLabel(state.categoriaActual)}"`;
  }

  function insertarFotoNueva(foto) {
    PhotoStore.registrar(foto);
    if (state.modoFavoritas) return;
    if (state.categoriaActual !== 'todos' && state.categoriaActual !== foto.category) return;
    state.fotos.unshift(foto);
    const tarjeta = crearTarjetaFoto(foto, 0);
    elementos.grid.insertBefore(tarjeta, elementos.grid.firstChild);
    requestAnimationFrame(() => tarjeta.classList.add('is-visible'));
    elementos.vacio.hidden = true;
    if (typeof state.totalActual === 'number') actualizarContador(state.totalActual + 1);
    emit('galeria:fotos-cargadas', { fotos: state.fotos, categoria: state.categoriaActual });
  }

  /**
   * Revisa si el panel de administración aprobó/publicó fotografías nuevas
   * desde la última vez, y las agrega a la galería SIN que el invitado tenga
   * que recargar la página. Siempre consulta "todos" (no la categoría que
   * esté viendo el invitado en este momento): así detecta cualquier foto
   * nueva, y `insertarFotoNueva` decide si de verdad le corresponde
   * mostrarse en el filtro actual. Se apoya en PhotoStore para saber cuáles
   * ya se conocen — nunca vuelve a insertar una que ya está en pantalla.
   */
  async function sondearFotosNuevas() {
    if (state.cargando || state.modoFavoritas || document.hidden) return;
    try {
      const datos = await ApiClient.listPhotos({ category: 'todos', cursor: '', pageSize: CONFIG.PAGE_SIZE });
      const nuevas = datos.items.filter((foto) => !PhotoStore.obtener(foto.id));
      // `datos.items` viene ordenado de más nueva a más vieja; se insertan en
      // orden inverso porque cada `insertarFotoNueva` pone la suya primera
      // (unshift) — así, al terminar, la más nueva de verdad queda arriba.
      nuevas.slice().reverse().forEach(insertarFotoNueva);
    } catch (err) {
      // Silencioso a propósito: un sondeo en segundo plano que falla (por
      // ejemplo, sin conexión un instante) no debe interrumpir al invitado
      // ni mostrar un error — simplemente se reintenta en el próximo ciclo.
    }
  }

  function init() {
    cachearElementos();
    renderFiltros();
    elementos.reintentar.addEventListener('click', () => cargar({ reiniciar: true }));
    elementos.cargarMas.addEventListener('click', () => cargar({ reiniciar: false }));
    cargar({ reiniciar: true });
    on('subida:completada', (e) => insertarFotoNueva(e.detail.foto));
    window.addEventListener('resize', debounce(() => moverIndicador($('.filtro-pill[aria-pressed="true"]', elementos.filtros)), 150));
    setInterval(sondearFotosNuevas, 25000);
  }

  return { init, obtenerFotosActuales: () => state.fotos };
})();

/* ==========================================================================
   DESTACADAS — composición editorial a partir de dedicatorias reales
   ========================================================================== */
const DestacadasModule = (() => {
  function construir(fotos) {
    const contenedor = $('#destacadas-composicion');
    contenedor.innerHTML = '';
    const conDedicatoria = fotos.filter((f) => f.dedication && f.dedication.trim());

    if (!conDedicatoria.length) {
      const vacio = document.createElement('p');
      vacio.className = 'destacadas__vacio';
      vacio.textContent = 'Las primeras dedicatorias de nuestros invitados aparecerán aquí.';
      contenedor.appendChild(vacio);
      return;
    }

    const principal = conDedicatoria[0];
    const secundarias = conDedicatoria.slice(1, 3);

    const figuraPrincipal = document.createElement('figure');
    figuraPrincipal.className = 'destacada-principal';
    const imgPrincipal = document.createElement('img');
    withPlaceholderFallback(imgPrincipal, 'foto');
    imgPrincipal.src = agrandarMiniaturaDrive(principal.thumbUrl, 1200) || principal.viewUrl || placeholderDataUri({ tone: 'foto' });
    imgPrincipal.alt = `Fotografía compartida por ${principal.guestName || 'un invitado'}`;
    imgPrincipal.loading = 'lazy';
    const cita = document.createElement('figcaption');
    cita.className = 'destacada-principal__cita';
    const frase = document.createElement('p');
    frase.className = 'destacada-principal__frase';
    frase.textContent = principal.dedication.trim();
    const autor = document.createElement('p');
    autor.className = 'destacada-principal__autor';
    autor.textContent = CONFIG.FEATURES.hideGuestName ? 'Un invitado' : (principal.guestName || 'Un invitado');
    cita.append(frase, autor);
    figuraPrincipal.append(imgPrincipal, cita);
    figuraPrincipal.addEventListener('click', () => LightboxModule.open(fotos, fotos.indexOf(principal)));
    figuraPrincipal.style.cursor = 'zoom-in';
    contenedor.appendChild(figuraPrincipal);

    secundarias.forEach((foto) => {
      const figura = document.createElement('figure');
      figura.className = 'destacada-secundaria';
      const img = document.createElement('img');
      withPlaceholderFallback(img, 'foto');
      img.src = foto.thumbUrl || foto.viewUrl || placeholderDataUri({ tone: 'foto' });
      img.alt = `Fotografía compartida por ${foto.guestName || 'un invitado'}`;
      img.loading = 'lazy';
      figura.appendChild(img);
      figura.style.cursor = 'zoom-in';
      figura.addEventListener('click', () => LightboxModule.open(fotos, fotos.indexOf(foto)));
      contenedor.appendChild(figura);
    });
  }

  function init() {
    construir([]);
    on('galeria:fotos-cargadas', (e) => construir(e.detail.fotos));
  }

  return { init };
})();

/* ==========================================================================
   LIGHTBOX — visor a pantalla completa compartido
   ========================================================================== */
const LightboxModule = (() => {
  let lista = [];
  let indice = 0;
  let ultimoFoco = null;

  function elementos() {
    return {
      raiz: $('#lightbox'),
      imagen: $('#lightbox-imagen'),
      caption: $('#lightbox-caption'),
      actual: $('#lightbox-actual'),
      total: $('#lightbox-total'),
      favorito: $('#lightbox-favorito'),
      descarga: $('#lightbox-descarga'),
      prev: $('#lightbox-prev'),
      next: $('#lightbox-next'),
    };
  }

  function render() {
    const el = elementos();
    const foto = lista[indice];
    if (!foto) return;
    withPlaceholderFallback(el.imagen, 'foto');
    el.imagen.src = agrandarMiniaturaDrive(foto.thumbUrl, 1600) || foto.viewUrl || placeholderDataUri({ tone: 'foto' });
    el.imagen.alt = `Fotografía de ${categoryLabel(foto.category)}`;

    const partes = [];
    if (!CONFIG.FEATURES.hideGuestName && foto.guestName) partes.push(foto.guestName);
    if (foto.dedication) partes.push(`"${foto.dedication.trim()}"`);
    el.caption.textContent = partes.join(' — ');

    el.actual.textContent = String(indice + 1);
    el.total.textContent = String(lista.length);

    if (CONFIG.FEATURES.allowFavorites) {
      const favorita = FavoritesModule.esFavorita(foto.id);
      el.favorito.hidden = false;
      el.favorito.setAttribute('aria-pressed', String(favorita));
    } else {
      el.favorito.hidden = true;
    }

    if (CONFIG.FEATURES.allowDownload) {
      el.descarga.hidden = false;
      el.descarga.href = foto.viewUrl || foto.thumbUrl || '#';
      el.descarga.setAttribute('download', foto.fileName || 'fotografia-boda.jpg');
    } else {
      el.descarga.hidden = true;
    }

    el.prev.disabled = lista.length <= 1;
    el.next.disabled = lista.length <= 1;
  }

  function open(fotos, indiceInicial) {
    if (!fotos || !fotos.length) return;
    lista = fotos;
    indice = clamp(indiceInicial || 0, 0, fotos.length - 1);
    ultimoFoco = document.activeElement;
    const el = elementos();
    el.raiz.hidden = false;
    document.body.classList.add('no-scroll');
    render();
    el.raiz.querySelector('.lightbox__cerrar').focus();
    document.addEventListener('keydown', onKeydown);
  }

  function close() {
    const el = elementos();
    el.raiz.hidden = true;
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKeydown);
    if (ultimoFoco && document.contains(ultimoFoco)) ultimoFoco.focus();
  }

  function siguiente() { if (lista.length > 1) { indice = (indice + 1) % lista.length; render(); } }
  function anterior() { if (lista.length > 1) { indice = (indice - 1 + lista.length) % lista.length; render(); } }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') siguiente();
    else if (e.key === 'ArrowLeft') anterior();
    else if (e.key === 'Tab') {
      const el = elementos();
      const focusables = $$('button, a[href]', el.raiz).filter((n) => !n.hidden && !n.disabled);
      if (!focusables.length) return;
      const primero = focusables[0];
      const ultimo = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }
  }

  function init() {
    const el = elementos();
    $$('[data-cerrar-lightbox]').forEach((n) => n.addEventListener('click', close));
    el.prev.addEventListener('click', anterior);
    el.next.addEventListener('click', siguiente);
    el.favorito.addEventListener('click', () => {
      const foto = lista[indice];
      const nuevoEstado = FavoritesModule.alternar(foto.id);
      el.favorito.setAttribute('aria-pressed', String(nuevoEstado));
      announce(nuevoEstado ? 'Fotografía guardada en favoritos.' : 'Fotografía quitada de favoritos.');
    });

    let touchStartX = 0;
    el.raiz.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
    el.raiz.addEventListener('touchend', (e) => {
      const delta = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(delta) > 50) (delta < 0 ? siguiente() : anterior());
    }, { passive: true });
  }

  return { init, open };
})();

/* ==========================================================================
   MODALES SIMPLES (privacidad / código de acceso)
   ========================================================================== */
const ModalsModule = (() => {
  function abrir(id) {
    const modal = document.getElementById(id);
    modal.hidden = false;
    document.body.classList.add('no-scroll');
    const enfocable = modal.querySelector('input, button');
    if (enfocable) enfocable.focus();
  }
  function cerrar(id) {
    document.getElementById(id).hidden = true;
    document.body.classList.remove('no-scroll');
  }

  function init() {
    $('#btn-aviso-privacidad').addEventListener('click', () => abrir('modal-privacidad'));
    $$('[data-cerrar-modal]').forEach((btn) => btn.addEventListener('click', () => cerrar(`modal-${btn.dataset.cerrarModal}`)));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#modal-privacidad').hidden) cerrar('modal-privacidad');
    });
  }

  return { init, abrir, cerrar };
})();

/* ==========================================================================
   CÓDIGO DE ACCESO AL EVENTO (desactivado por defecto; ver CONFIG.FEATURES)
   ========================================================================== */
const AccessGateModule = (() => {
  const CLAVE_SESION = 'wedding_access_granted';

  // sessionStorage puede lanzar excepción en navegación privada de algunos
  // navegadores; sin este resguardo, un usuario en ese modo se quedaría
  // atascado en la pantalla de código incluso tras verificarlo correctamente.
  function sesionConcedida() {
    try { return sessionStorage.getItem(CLAVE_SESION) === 'true'; } catch { return false; }
  }
  function marcarSesionConcedida() {
    try { sessionStorage.setItem(CLAVE_SESION, 'true'); } catch { /* se pedirá el código de nuevo en la próxima carga, no es crítico */ }
  }

  function init() {
    if (!CONFIG.FEATURES.accessCodeEnabled) return;
    if (sesionConcedida()) return;

    document.body.classList.add('no-scroll');
    const modal = $('#modal-codigo-acceso');
    modal.hidden = false;
    const form = $('#form-codigo-acceso');
    const mensaje = $('#codigo-acceso-mensaje');
    const boton = $('#btn-verificar-codigo');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const codigo = $('#campo-codigo-acceso').value.trim();
      if (!codigo) return;
      boton.disabled = true;
      mensaje.hidden = true;
      try {
        await ApiClient.verifyEventCode(codigo);
        marcarSesionConcedida();
        modal.hidden = true;
        document.body.classList.remove('no-scroll');
      } catch (err) {
        mensaje.hidden = false;
        mensaje.textContent = 'El código ingresado no es válido. Verifica e inténtalo de nuevo.';
      } finally {
        boton.disabled = false;
      }
    });
  }

  return { init };
})();

/* ==========================================================================
   COMPARTIR ÁLBUM — Web Share API con respaldo de portapapeles
   ========================================================================== */
const ShareModule = (() => {
  function init() {
    const boton = $('#btn-compartir-album');
    if (!boton) return;
    const textoOriginal = boton.textContent;

    boton.addEventListener('click', async () => {
      const datosCompartir = {
        title: document.title,
        text: 'Comparte tus fotografías de la boda de Héctor y Raquel',
        url: window.location.href,
      };

      if (navigator.share) {
        try { await navigator.share(datosCompartir); }
        catch { /* el invitado canceló el diálogo nativo; no es un error que mostrar */ }
        return;
      }

      if (!navigator.clipboard) {
        announce('Copia la dirección desde la barra del navegador para compartirla.', true);
        return;
      }
      try {
        await navigator.clipboard.writeText(window.location.href);
        boton.textContent = 'Enlace copiado';
        announce('Enlace del álbum copiado al portapapeles.');
        setTimeout(() => { boton.textContent = textoOriginal; }, 2400);
      } catch {
        announce('No se pudo copiar el enlace automáticamente. Cópialo desde la barra del navegador.', true);
      }
    });
  }
  return { init };
})();

/* ==========================================================================
   CONEXIÓN — banner de estado sin conexión / recuperada
   ========================================================================== */
const ConnectivityModule = (() => {
  function actualizar() {
    const banner = $('#banner-sin-conexion');
    if (!banner) return;
    const sinConexion = !navigator.onLine;
    banner.hidden = !sinConexion;
    if (!sinConexion) announce('Conexión a internet recuperada.');
  }
  function init() {
    window.addEventListener('online', actualizar);
    window.addEventListener('offline', actualizar);
    actualizar();
  }
  return { init };
})();

/* ==========================================================================
   PROCESAMIENTO DE IMÁGENES (redimensión, compresión, corrección EXIF)
   ========================================================================== */
async function optimizarImagen(file) {
  const cfg = CONFIG.UPLOAD;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    const pareceHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    throw Object.assign(new Error(pareceHeic ? 'Este formato (HEIC/HEIF) no se pudo procesar en este navegador. Intenta exportarlo como JPG.' : 'La imagen parece estar dañada o en un formato no compatible.'), { codigo: pareceHeic ? 'HEIC_NO_SOPORTADO' : 'DECODIFICACION_FALLIDA' });
  }

  const escala = Math.min(1, cfg.maxDimension / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.max(1, Math.round(bitmap.width * escala));
  const alto = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  if (bitmap.close) bitmap.close();

  const generarBlob = (calidad) => new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo comprimir la imagen.'))), 'image/jpeg', calidad);
  });

  let blob = await generarBlob(cfg.quality);
  const maxBytes = cfg.maxFileMB * 1024 * 1024;
  if (blob.size > maxBytes) {
    blob = await generarBlob(Math.max(0.5, cfg.quality - 0.22));
  }
  if (blob.size > maxBytes) {
    throw Object.assign(new Error(`La fotografía supera el tamaño máximo permitido (${cfg.maxFileMB} MB) incluso después de comprimirla.`), { codigo: 'ARCHIVO_MUY_GRANDE' });
  }

  return { blob, width: ancho, height: alto };
}

/* ==========================================================================
   COLA DE SUBIDA — selección, previsualización, concurrencia, reintentos
   ========================================================================== */
const UploadQueueModule = (() => {
  const FORMATOS_VALIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  const CLAVE_CONTADOR_DISPOSITIVO = 'wedding_uploads_count_v1';
  const items = new Map(); // idempotencyKey -> item
  let procesando = false;
  let backendDisponible = true;

  function leerContadorDispositivo() {
    try { return parseInt(localStorage.getItem(CLAVE_CONTADOR_DISPOSITIVO), 10) || 0; }
    catch { return 0; }
  }
  function incrementarContadorDispositivo() {
    try { localStorage.setItem(CLAVE_CONTADOR_DISPOSITIVO, String(leerContadorDispositivo() + 1)); }
    catch { /* si no hay almacenamiento disponible, simplemente no se aplica el límite */ }
  }

  function elementos() {
    return {
      dropzone: $('#dropzone'),
      input: $('#input-archivos'),
      lista: $('#cola-lista'),
      categoria: $('#campo-categoria'),
      nombre: $('#campo-nombre'),
      dedicatoria: $('#campo-dedicatoria'),
      consentimiento: $('#campo-consentimiento'),
      form: $('#form-subida'),
      botonEnviar: $('#btn-enviar-subida'),
      progreso: $('#subida-progreso'),
      progresoRelleno: $('#subida-progreso-relleno'),
      progresoTexto: $('#subida-progreso-texto'),
      mensaje: $('#form-mensaje'),
      bannerBackend: $('#subir-estado-backend'),
    };
  }

  function poblarCategorias() {
    const select = elementos().categoria;
    CONFIG.CATEGORIES.filter((c) => c.id !== 'todos').forEach((categoria) => {
      const opcion = document.createElement('option');
      opcion.value = categoria.id;
      opcion.textContent = categoria.label;
      select.appendChild(opcion);
    });
  }

  function validarArchivo(file) {
    if (!FORMATOS_VALIDOS.includes(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      return { valido: false, motivo: 'Formato no permitido. Usa JPG, PNG, WebP o HEIC.' };
    }
    const limiteOriginal = 45 * 1024 * 1024; // margen amplio antes de optimizar en el navegador
    if (file.size > limiteOriginal) {
      return { valido: false, motivo: 'El archivo original es demasiado grande.' };
    }
    return { valido: true };
  }

  function actualizarBotonEnviar() {
    const { botonEnviar, consentimiento } = elementos();
    const hayPendientes = Array.from(items.values()).some((i) => i.estado === 'pendiente' || i.estado === 'error');
    botonEnviar.disabled = !hayPendientes || !consentimiento.checked || procesando || !backendDisponible;
  }

  function crearItem(file) {
    const idempotencyKey = newIdempotencyKey();
    const item = {
      idempotencyKey, file, estado: 'pendiente', intentos: 0, elemento: null, previewUrl: null,
    };
    items.set(idempotencyKey, item);
    renderItem(item);
    actualizarBotonEnviar();
    return item;
  }

  function renderItem(item) {
    const tpl = $('#tpl-cola-item');
    const nodo = tpl.content.firstElementChild.cloneNode(true);
    const preview = $('.cola-item__preview', nodo);
    item.previewUrl = URL.createObjectURL(item.file);
    preview.src = item.previewUrl;
    preview.alt = '';
    $('.cola-item__nombre', nodo).textContent = item.file.name;
    nodo.dataset.estado = item.estado;

    $('.cola-item__reintentar', nodo).addEventListener('click', () => reintentarItem(item.idempotencyKey));
    $('.cola-item__quitar', nodo).addEventListener('click', () => quitarItem(item.idempotencyKey));

    item.elemento = nodo;
    elementos().lista.appendChild(nodo);
    actualizarEstadoVisual(item, 'En espera');
  }

  function actualizarEstadoVisual(item, textoEstado, progreso) {
    if (!item.elemento) return;
    item.elemento.dataset.estado = item.estado;
    $('.cola-item__estado', item.elemento).textContent = textoEstado;
    if (typeof progreso === 'number') $('.cola-item__relleno', item.elemento).style.width = `${progreso}%`;
    $('.cola-item__reintentar', item.elemento).hidden = item.estado !== 'error';
    $('.cola-item__quitar', item.elemento).disabled = item.estado === 'subiendo';
  }

  function quitarItem(idempotencyKey) {
    const item = items.get(idempotencyKey);
    if (!item || item.estado === 'subiendo') return;
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    item.elemento.classList.add('cola-item--saliendo');
    setTimeout(() => item.elemento.remove(), 200);
    items.delete(idempotencyKey);
    actualizarBotonEnviar();
  }

  function agregarArchivos(fileList) {
    if (fileList.length === 0) return;

    const yaSubidas = leerContadorDispositivo();
    const cupoDispositivo = Math.max(0, CONFIG.UPLOAD.maxPerDevice - yaSubidas - items.size);
    if (cupoDispositivo === 0) {
      mostrarMensaje('Ya compartiste muchas fotografías desde este dispositivo — ¡gracias por tu entusiasmo! Si necesitas subir más, escribe directamente a Héctor y Raquel.', 'error');
      return;
    }

    const espacioDisponible = Math.max(0, Math.min(CONFIG.UPLOAD.maxBatch - items.size, cupoDispositivo));
    if (espacioDisponible === 0) {
      mostrarMensaje(`Ya alcanzaste el máximo de ${CONFIG.UPLOAD.maxBatch} fotografías por lote. Quita alguna para agregar otra.`, 'error');
      return;
    }
    const archivos = Array.from(fileList).slice(0, espacioDisponible);
    if (fileList.length > archivos.length) {
      const motivo = espacioDisponible === cupoDispositivo ? 'por el límite de este dispositivo' : `(máximo ${CONFIG.UPLOAD.maxBatch} por lote)`;
      mostrarMensaje(`Solo se agregaron ${archivos.length} fotografías ${motivo}.`, 'error');
    }
    archivos.forEach((file) => {
      const validacion = validarArchivo(file);
      if (!validacion.valido) {
        const item = crearItem(file);
        item.estado = 'error';
        actualizarEstadoVisual(item, validacion.motivo);
        return;
      }
      crearItem(file);
    });
  }

  function actualizarProgresoGlobal() {
    const total = items.size;
    const completados = Array.from(items.values()).filter((i) => i.estado === 'exito').length;
    const { progreso, progresoRelleno, progresoTexto } = elementos();
    if (total === 0) { progreso.hidden = true; return; }
    progreso.hidden = false;
    progresoRelleno.style.width = `${Math.round((completados / total) * 100)}%`;
    progresoTexto.textContent = `Subiendo ${completados} de ${total}`;
  }

  function mensajeErrorSubida(err) {
    const codigo = err && err.codigo;
    if (codigo === 'TIMEOUT') return 'La subida tardó demasiado. Puedes reintentarlo.';
    if (codigo === 'RED') return 'Se perdió la conexión durante la subida.';
    // El servidor ya manda mensajes específicos en español para sus propios
    // errores controlados (formato no permitido, archivo dañado, etc.) — se
    // muestran tal cual en vez de un mensaje genérico que pierde esa información.
    if (err && err.message) return err.message;
    return 'No se pudo subir esta fotografía. Puedes reintentarlo.';
  }

  async function subirItem(item) {
    item.estado = 'subiendo';
    actualizarEstadoVisual(item, 'Optimizando…', 10);
    try {
      const { blob, width, height } = await optimizarImagen(item.file);
      actualizarEstadoVisual(item, 'Subiendo…', 55);
      const base64 = await blobToBase64(blob);
      const { categoria, nombre, dedicatoria } = elementos();
      const datos = await ApiClient.uploadPhoto({
        idempotencyKey: item.idempotencyKey,
        fileName: item.file.name,
        mimeType: 'image/jpeg',
        base64,
        width,
        height,
        category: categoria.value,
        guestName: nombre.value.trim(),
        dedication: dedicatoria.value.trim(),
      });
      item.estado = 'exito';
      actualizarEstadoVisual(item, 'Compartida con éxito', 100);
      incrementarContadorDispositivo();
      emit('subida:completada', { foto: datos });
    } catch (err) {
      item.intentos += 1;
      if (item.intentos <= CONFIG.UPLOAD.maxRetries && ['TIMEOUT', 'RED', 'SERVIDOR_OCUPADO'].includes(err.codigo)) {
        const espera = Math.min(6000, 500 * 2 ** item.intentos);
        actualizarEstadoVisual(item, `Reintentando en breve… (${item.intentos}/${CONFIG.UPLOAD.maxRetries})`, 30);
        await new Promise((r) => setTimeout(r, espera));
        return subirItem(item);
      }
      item.estado = 'error';
      actualizarEstadoVisual(item, mensajeErrorSubida(err), 0);
    } finally {
      actualizarProgresoGlobal();
      actualizarBotonEnviar();
    }
  }

  function reintentarItem(idempotencyKey) {
    const item = items.get(idempotencyKey);
    if (!item) return;
    item.intentos = 0;
    item.estado = 'pendiente';
    actualizarEstadoVisual(item, 'En espera');
    actualizarBotonEnviar();
    if (!procesando) procesarCola();
  }

  async function procesarCola() {
    procesando = true;
    actualizarBotonEnviar();
    const advertirCierre = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', advertirCierre);

    // try/finally: si algo falla de forma inesperada dentro de la cola, la
    // advertencia de "salir de la página" y el bloqueo del botón NUNCA deben
    // quedar pegados — si no, el invitado quedaría atrapado sin poder volver
    // a intentar ni navegar con normalidad.
    try {
      const pendientes = () => Array.from(items.values()).filter((i) => i.estado === 'pendiente');
      const ejecutores = Array.from({ length: CONFIG.UPLOAD.concurrency }, async () => {
        let siguiente;
        // eslint-disable-next-line no-cond-assign
        while ((siguiente = pendientes()[0])) {
          await subirItem(siguiente);
        }
      });
      await Promise.all(ejecutores);
    } finally {
      window.removeEventListener('beforeunload', advertirCierre);
      procesando = false;
      actualizarBotonEnviar();
    }

    const total = items.size;
    const exitosas = Array.from(items.values()).filter((i) => i.estado === 'exito').length;
    const fallidas = total - exitosas;
    if (fallidas === 0) {
      mostrarMensaje(`${exitosas === 1 ? 'Tu fotografía fue compartida' : `Tus ${exitosas} fotografías fueron compartidas`} con Héctor y Raquel. ¡Gracias!`, 'exito');
      lanzarPetalos(elementos().mensaje.getBoundingClientRect());
      elementos().form.reset();
      items.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
      items.clear();
      elementos().lista.innerHTML = '';
    } else if (exitosas > 0) {
      mostrarMensaje(`Se compartieron ${exitosas} de ${total} fotografías. Revisa las que fallaron para reintentarlas.`, 'error');
    } else {
      mostrarMensaje('No se pudo compartir ninguna fotografía. Revisa tu conexión e inténtalo de nuevo.', 'error');
    }
  }

  function mostrarMensaje(texto, tipo) {
    const { mensaje } = elementos();
    mensaje.hidden = false;
    mensaje.textContent = texto;
    mensaje.dataset.tipo = tipo;
    announce(texto, tipo === 'error');
  }

  async function verificarBackend() {
    const { bannerBackend } = elementos();
    try {
      await ApiClient.health();
      backendDisponible = true;
    } catch {
      backendDisponible = false;
      bannerBackend.hidden = false;
      $('span', bannerBackend).textContent = 'El álbum en línea todavía no está disponible para recibir fotografías. Inténtalo más tarde.';
    }
    actualizarBotonEnviar();
  }

  function init() {
    poblarCategorias();
    const { dropzone, input, form, consentimiento } = elementos();

    dropzone.addEventListener('click', () => input.click());
    dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { agregarArchivos(input.files); input.value = ''; });

    ['dragenter', 'dragover'].forEach((evento) => dropzone.addEventListener(evento, (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); }));
    ['dragleave', 'drop'].forEach((evento) => dropzone.addEventListener(evento, (e) => { e.preventDefault(); dropzone.classList.remove('is-dragover'); }));
    dropzone.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) agregarArchivos(e.dataTransfer.files); });

    consentimiento.addEventListener('change', actualizarBotonEnviar);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (procesando) return;
      elementos().mensaje.hidden = true;
      procesarCola();
    });

    if (leerContadorDispositivo() >= CONFIG.UPLOAD.maxPerDevice) {
      const { bannerBackend } = elementos();
      dropzone.setAttribute('aria-disabled', 'true');
      dropzone.style.pointerEvents = 'none';
      dropzone.style.opacity = '0.55';
      bannerBackend.hidden = false;
      $('span', bannerBackend).textContent = 'Ya compartiste el máximo de fotografías permitido desde este dispositivo. ¡Gracias por tu entusiasmo!';
    } else {
      verificarBackend();
    }
  }

  return { init };
})();

/* ==========================================================================
   CIERRE — pequeño gesto festivo la primera vez que se llega a "Gracias"
   ========================================================================== */
const GraciasFlourishModule = (() => {
  function init() {
    const seccion = $('#gracias');
    const monograma = $('.monogram--gracias', seccion);
    if (!seccion || !monograma) return;
    let disparado = false;
    const observer = new IntersectionObserver((entradas) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting && !disparado) {
          disparado = true;
          lanzarPetalos(monograma.getBoundingClientRect(), 7);
          observer.disconnect();
        }
      });
    }, { threshold: 0.5 });
    observer.observe(seccion);
  }
  return { init };
})();

/* ==========================================================================
   BOTÓN FLOTANTE MÓVIL — visible tras pasar el hero
   ========================================================================== */
const FabModule = (() => {
  function init() {
    const fab = $('#fab-subir');
    const hero = $('#hero');
    const subir = $('#subir');
    if (!fab || !hero || !subir) return;

    const observer = new IntersectionObserver((entradas) => {
      entradas.forEach((entrada) => {
        if (entrada.target === hero) fab.dataset.heroVisible = String(entrada.isIntersecting);
        if (entrada.target === subir) fab.dataset.subirVisible = String(entrada.isIntersecting);
      });
      const ocultarPorHero = fab.dataset.heroVisible === 'true';
      const ocultarPorSubir = fab.dataset.subirVisible === 'true';
      fab.dataset.visible = String(!ocultarPorHero && !ocultarPorSubir);
    }, { threshold: 0.2 });

    observer.observe(hero);
    observer.observe(subir);
  }
  return { init };
})();

/* ==========================================================================
   ARRANQUE DE LA APLICACIÓN
   ========================================================================== */
function aplicarTextosDeFecha() {
  const heroFecha = $('#hero-fecha');
  const footerFecha = $('#footer-fecha');

  if (!CONFIG.WEDDING_DATE) {
    if (heroFecha) heroFecha.textContent = 'Fecha por confirmar';
    if (footerFecha) footerFecha.textContent = 'Fecha por confirmar';
    return;
  }

  const fechaBoda = new Date(`${CONFIG.WEDDING_DATE}T00:00:00`);
  const textoFecha = fechaBoda.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  if (footerFecha) footerFecha.textContent = textoFecha;
  if (!heroFecha) return;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const diffDias = Math.round((fechaBoda - hoy) / 86400000);

  if (diffDias > 1) heroFecha.textContent = `Faltan ${diffDias} días — ${textoFecha}`;
  else if (diffDias === 1) heroFecha.textContent = `¡Es mañana! — ${textoFecha}`;
  else if (diffDias === 0) heroFecha.textContent = '¡Hoy es el día!';
  else heroFecha.textContent = textoFecha;
}

/**
 * CONFIG.HERO_TAGLINE, HERO_SUBTITLE y PRIVACY_NOTE existen para poder
 * editar esos textos solo en config.js — sin esta función quedaban
 * declarados pero nunca se leían, y el HTML mostraba siempre el texto fijo
 * escrito a mano, sin importar lo que se cambiara en config.js.
 */
function aplicarTextosDeConfig() {
  const tagline = $('.hero__tagline');
  if (tagline && CONFIG.HERO_TAGLINE) tagline.textContent = CONFIG.HERO_TAGLINE;

  const cita = $('.hero__cita');
  if (cita && CONFIG.HERO_TAGLINE_CITA) cita.textContent = CONFIG.HERO_TAGLINE_CITA;

  const subtitulo = $('.hero__subtitle');
  if (subtitulo && CONFIG.HERO_SUBTITLE) subtitulo.textContent = CONFIG.HERO_SUBTITLE;

  const notaPrivacidad = $('#privacidad-nota');
  if (notaPrivacidad && CONFIG.PRIVACY_NOTE) notaPrivacidad.textContent = CONFIG.PRIVACY_NOTE;
}

function aplicarUrlCanonica() {
  const link = $('#link-canonico');
  if (link) {
    if (CONFIG.SITE_URL) link.setAttribute('href', CONFIG.SITE_URL);
    else link.remove();
  }

  // Las vistas previas de enlace (WhatsApp, Facebook, iMessage…) funcionan
  // mejor con URLs absolutas. Si aún no se configuró SITE_URL, se dejan las
  // rutas relativas del HTML tal cual (siguen funcionando en casi todos los
  // casos una vez que el sitio esté publicado en una URL real).
  if (CONFIG.SITE_URL) {
    const base = CONFIG.SITE_URL.replace(/\/?$/, '/');
    const metaUrl = $('#meta-og-url');
    if (metaUrl) metaUrl.setAttribute('content', CONFIG.SITE_URL);
    const metaImagen = $('#meta-og-image');
    if (metaImagen) metaImagen.setAttribute('content', new URL('assets/photos/og-cover.jpg', base).href);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initConfiguredPhotos();
  aplicarTextosDeFecha();
  aplicarTextosDeConfig();
  aplicarUrlCanonica();

  NavModule.init();
  HeroModule.init();
  HistoriaMomentosModule.init();
  ScrollRevealModule.init();
  ParticlesModule.init();
  ModalsModule.init();
  AccessGateModule.init();
  ConnectivityModule.init();
  ShareModule.init();
  LightboxModule.init();
  GalleryModule.init();
  DestacadasModule.init();
  UploadQueueModule.init();
  FabModule.init();
  GraciasFlourishModule.init();
});
