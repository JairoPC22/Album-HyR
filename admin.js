'use strict';

/**
 * Panel de administración — solo para Héctor y Raquel.
 * Consume las mismas acciones del backend (config.js define CONFIG.API_URL),
 * más las acciones "admin*" añadidas en apps-script/Code.gs.
 */
const AdminModule = (() => {
  const CLAVE_TOKEN = 'wedding_admin_token_v1';
  const ESTADOS = [
    { id: 'todas', label: 'Todas' },
    { id: 'pendiente', label: 'Por revisar' },
    { id: 'publicada', label: 'Publicadas' },
    { id: 'oculta', label: 'Ocultas' },
  ];
  const ETIQUETA_ESTADO = { pendiente: 'Por revisar', publicada: 'Publicada', oculta: 'Oculta' };
  // Generar el PDF puede tardar varios minutos con muchas fotografías (cada
  // una es una llamada a Drive); Apps Script permite hasta 6 minutos por
  // ejecución, así que el cliente debe esperar casi ese tiempo en vez de
  // usar el timeout corto (15s) de las demás acciones.
  const DESCARGA_TIMEOUT_MS = 5.5 * 60 * 1000;

  let token = null;
  let filtroActual = 'todas';
  let elementosCache = null;
  let fotosActuales = [];
  let todas = [];            // TODAS las fotos (se carga una vez; los filtros se aplican aquí)
  let configAplicada = false;
  let indiceVisor = 0;

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  function announce(mensaje, assertive) {
    const region = document.getElementById(assertive ? 'aria-live-alert' : 'aria-live-status');
    if (region) region.textContent = mensaje;
  }

  function elementos() {
    if (elementosCache) return elementosCache;
    elementosCache = {
      pantallaLogin: $('#pantalla-login'),
      loginTarjeta: $('.login-tarjeta'),
      formLogin: $('#form-login-admin'),
      campoPassword: $('#campo-password-admin'),
      botonMostrarPassword: $('#btn-mostrar-password'),
      mensajeLogin: $('#mensaje-login-admin'),
      botonLogin: $('#btn-login-admin'),
      panel: $('#panel-admin'),
      resumenTotal: $('#resumen-total'),
      resumenPendiente: $('#resumen-pendiente'),
      resumenPublicada: $('#resumen-publicada'),
      resumenOculta: $('#resumen-oculta'),
      filtros: $('#admin-filtros'),
      grid: $('#admin-grid'),
      vacio: $('#admin-vacio'),
      error: $('#admin-error'),
      errorMensaje: $('#admin-error-mensaje'),
      reintentar: $('#admin-reintentar'),
      botonActualizar: $('#btn-actualizar-panel'),
      botonSalir: $('#btn-cerrar-sesion-admin'),
      botonDescargar: $('#btn-descargar-album'),
      switchModeracion: $('#switch-moderacion'),
      visor: $('#admin-lightbox'),
      visorImagen: $('#admin-visor-imagen'),
      visorCategoria: $('#admin-visor-categoria'),
      visorEstado: $('#admin-visor-estado'),
      visorInvitado: $('#admin-visor-invitado'),
      visorDedicatoria: $('#admin-visor-dedicatoria'),
      visorFecha: $('#admin-visor-fecha'),
      visorActual: $('#admin-visor-actual'),
      visorTotal: $('#admin-visor-total'),
      visorOriginal: $('#admin-visor-original'),
      visorPrev: $('#admin-visor-prev'),
      visorNext: $('#admin-visor-next'),
      modalDescarga: $('#modal-descarga'),
      formDescarga: $('#form-descarga'),
      campoFiltroDescarga: $('#campo-filtro-descarga'),
      descargaEstado: $('#descarga-estado'),
      botonGenerarDescarga: $('#btn-generar-descarga'),
    };
    return elementosCache;
  }

  /* ==========================================================================
     CLIENTE API — mismas convenciones que script.js (fetch con timeout,
     text/plain para evitar preflight CORS, errores con código estable).
     También reintenta automáticamente (con espera creciente) los errores
     transitorios — antes solo script.js (el sitio de invitados) lo hacía;
     el panel se quedaba corto y mostraba "Reintentar" desde el primer
     tropiezo, algo muy notorio justo al abrirlo (la primera carga después de
     un rato sin uso puede tardar por el arranque en frío de Apps Script).
     ========================================================================== */
  const ERRORES_RECUPERABLES = new Set(['TIMEOUT', 'RED', 'SERVIDOR_OCUPADO', 'RESPUESTA_INVALIDA']);

  function esperar(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async function peticion(url, opciones, { timeoutMs, reintentable = true } = {}) {
    let intento = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const controlador = new AbortController();
      const timeoutId = setTimeout(() => controlador.abort(), timeoutMs || CONFIG.API_TIMEOUT_MS);
      try {
        const respuesta = await fetch(url, { ...opciones, signal: controlador.signal });
        clearTimeout(timeoutId);
        let cuerpo;
        try { cuerpo = await respuesta.json(); }
        catch { throw Object.assign(new Error('Respuesta inválida del servidor.'), { codigo: 'RESPUESTA_INVALIDA' }); }
        if (!respuesta.ok || cuerpo.ok === false) {
          const codigo = (cuerpo.error && cuerpo.error.code) || 'ERROR_DESCONOCIDO';
          const mensaje = (cuerpo.error && cuerpo.error.message) || 'Ocurrió un problema.';
          throw Object.assign(new Error(mensaje), { codigo });
        }
        return cuerpo.data;
      } catch (err) {
        clearTimeout(timeoutId);
        const codigo = err.name === 'AbortError' ? 'TIMEOUT' : (err.codigo || 'RED');
        intento += 1;
        const puedeReintentar = reintentable && ERRORES_RECUPERABLES.has(codigo) && intento <= CONFIG.API_MAX_RETRIES;
        if (!puedeReintentar) throw Object.assign(new Error(err.message || 'La solicitud tardó demasiado.'), { codigo });
        await esperar(Math.min(4000, 400 * 2 ** intento) + Math.random() * 200);
      }
    }
  }

  function post(action, payload, timeoutMs, reintentable) {
    return peticion(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
    }, { timeoutMs, reintentable });
  }

  function get(parametros) {
    const query = new URLSearchParams(parametros).toString();
    return peticion(`${CONFIG.API_URL}?${query}`, { method: 'GET' });
  }

  /* ==========================================================================
     SESIÓN
     ========================================================================== */
  function guardarToken(t) {
    token = t;
    try { sessionStorage.setItem(CLAVE_TOKEN, t); } catch { /* si no hay almacenamiento, la sesión no sobrevive un refresh */ }
  }
  function leerTokenGuardado() {
    try { return sessionStorage.getItem(CLAVE_TOKEN); } catch { return null; }
  }
  function borrarToken() {
    token = null;
    try { sessionStorage.removeItem(CLAVE_TOKEN); } catch { /* noop */ }
  }

  function mostrarPanel() {
    elementos().pantallaLogin.hidden = true;
    elementos().panel.hidden = false;
  }
  function mostrarLogin(mensaje) {
    elementos().panel.hidden = true;
    elementos().pantallaLogin.hidden = false;
    if (mensaje) {
      elementos().mensajeLogin.hidden = false;
      elementos().mensajeLogin.textContent = mensaje;
    }
    elementos().campoPassword.focus();
  }

  async function intentarSesionGuardada() {
    const guardado = leerTokenGuardado();
    if (!guardado) {
      mostrarLogin();
      // Apps Script tarda varios segundos en "despertar": se le avisa ya, mientras se escribe la contraseña.
      peticion(`${CONFIG.API_URL}?action=health`, { method: 'GET' }, { reintentable: false }).catch(() => {});
      return;
    }
    token = guardado;
    const sesionSigueValida = await cargarTodo();
    // Si la sesión expiró, cargarFotos()/cargarConfiguracion() ya llamaron a
    // cerrarSesion() (que muestra el login) — no hay que pisar eso mostrando
    // el panel encima, aunque las promesas se hayan resuelto sin lanzar error.
    if (sesionSigueValida) mostrarPanel();
  }

  function mensajeErrorLogin(err) {
    const codigo = err && err.codigo;
    if (codigo === 'CREDENCIALES_INVALIDAS') return 'Contraseña incorrecta. Inténtalo de nuevo.';
    if (codigo === 'DEMASIADOS_INTENTOS') return 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.';
    if (codigo === 'ADMIN_NO_CONFIGURADO') return 'El panel todavía no tiene una contraseña configurada. Revisa apps-script/README_SETUP.md.';
    if (codigo === 'TIMEOUT' || codigo === 'RESPUESTA_INVALIDA') return 'No se pudo conectar con el álbum en línea. Verifica que el backend esté desplegado.';
    return 'No se pudo iniciar sesión. Intenta de nuevo.';
  }

  async function manejarSubmitLogin(e) {
    e.preventDefault();
    const el = elementos();
    const password = el.campoPassword.value;
    if (!password) return;
    el.botonLogin.disabled = true;
    el.mensajeLogin.hidden = true;
    try {
      const datos = await post('adminLogin', { password });
      guardarToken(datos.token);
      el.formLogin.reset();
      mostrarPanel();
      await cargarTodo();
    } catch (err) {
      el.mensajeLogin.hidden = false;
      el.mensajeLogin.textContent = mensajeErrorLogin(err);
      el.loginTarjeta.classList.remove('esta-agitando');
      // eslint-disable-next-line no-void
      void el.loginTarjeta.offsetWidth; // fuerza el reflujo para poder repetir la animación
      el.loginTarjeta.classList.add('esta-agitando');
      el.campoPassword.focus();
      el.campoPassword.select();
    } finally {
      el.botonLogin.disabled = false;
    }
  }

  async function cerrarSesion(mensaje) {
    const tokenActual = token;
    borrarToken();
    mostrarLogin(mensaje);
    if (tokenActual) {
      try { await post('adminLogout', { token: tokenActual }); }
      catch { /* la sesión local ya se limpió; si falla el aviso al servidor, expira sola por TTL */ }
    }
  }

  /* ==========================================================================
     FILTROS POR ESTADO (con el mismo indicador deslizante que la galería pública)
     ========================================================================== */
  let filtrosEventosListos = false;

  function renderFiltros() {
    const el = elementos();
    el.filtros.textContent = '';
    const indicador = document.createElement('span');
    indicador.className = 'filtro-pill__indicador';
    indicador.setAttribute('aria-hidden', 'true');
    el.filtros.appendChild(indicador);

    ESTADOS.forEach((estado) => {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'filtro-pill';
      boton.textContent = estado.label;
      boton.dataset.estado = estado.id;
      boton.setAttribute('aria-pressed', String(estado.id === filtroActual));
      el.filtros.appendChild(boton);
    });

    requestAnimationFrame(() => moverIndicador($('.filtro-pill[aria-pressed="true"]', el.filtros)));

    // renderFiltros() puede volver a ejecutarse si alguien cierra sesión y
    // vuelve a entrar en la misma pestaña; sin este resguardo, cada vez se
    // agregaría OTRO listener de clic y de resize sobre los mismos elementos.
    if (filtrosEventosListos) return;
    filtrosEventosListos = true;

    el.filtros.addEventListener('click', (e) => {
      const boton = e.target.closest('.filtro-pill');
      if (!boton || boton.dataset.estado === filtroActual) return;
      $$('.filtro-pill', el.filtros).forEach((b) => b.setAttribute('aria-pressed', String(b === boton)));
      moverIndicador(boton);
      filtroActual = boton.dataset.estado;
      renderGrid(); // el filtro se aplica en el navegador: instantáneo, sin pedir nada al servidor
    });

    window.addEventListener('resize', debounce(() => moverIndicador($('.filtro-pill[aria-pressed="true"]', el.filtros)), 150));
  }

  function moverIndicador(boton) {
    const indicador = $('.filtro-pill__indicador', elementos().filtros);
    if (!indicador || !boton) return;
    const contenedorRect = elementos().filtros.getBoundingClientRect();
    const botonRect = boton.getBoundingClientRect();
    indicador.style.opacity = '1';
    indicador.style.width = `${botonRect.width}px`;
    indicador.style.transform = `translateX(${(botonRect.left - contenedorRect.left).toFixed(1)}px)`;
  }

  function debounce(fn, espera) {
    let temporizador;
    return (...args) => { clearTimeout(temporizador); temporizador = setTimeout(() => fn(...args), espera); };
  }

  /* ==========================================================================
     CARGA Y RENDER DE FOTOGRAFÍAS
     ========================================================================== */
  async function cargarTodo() {
    renderFiltros();
    configAplicada = false;
    await cargarFotos();
    // Con el backend nuevo la configuración ya viene en la misma respuesta; la
    // segunda petición solo se hace si el backend desplegado todavía es el viejo.
    if (token !== null && !configAplicada) await cargarConfiguracion();
    // cargarFotos()/cargarConfiguracion() nunca lanzan: si la sesión expiró,
    // ya llamaron a cerrarSesion() internamente y token queda en null.
    return token !== null;
  }

  async function cargarConfiguracion() {
    const el = elementos();
    try {
      const config = await get({ action: 'adminObtenerConfig', token });
      el.switchModeracion.checked = config.moderationEnabled;
      el.switchModeracion.disabled = false;
    } catch (err) {
      if (err.codigo === 'SESION_INVALIDA') { cerrarSesion('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
      // No es crítico: el interruptor simplemente se queda deshabilitado hasta la próxima actualización.
      el.switchModeracion.disabled = true;
    }
  }

  async function manejarCambioModeracion() {
    const el = elementos();
    const nuevoValor = el.switchModeracion.checked;
    el.switchModeracion.disabled = true;
    try {
      await post('adminActualizarConfig', { token, moderationEnabled: nuevoValor });
      announce(nuevoValor ? 'Ahora las fotos nuevas quedarán por revisar antes de publicarse.' : 'Ahora las fotos nuevas se publicarán automáticamente.');
    } catch (err) {
      el.switchModeracion.checked = !nuevoValor; // revierte si no se pudo guardar
      if (err.codigo === 'SESION_INVALIDA') { cerrarSesion('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
      announce('No se pudo guardar el cambio de moderación. Intenta de nuevo.', true);
    } finally {
      el.switchModeracion.disabled = false;
    }
  }

  /** Cuenta desde el valor anterior hasta el nuevo (salvo con movimiento reducido). */
  function animarNumero(nodo, destino) {
    const final = Number(destino) || 0;
    const inicio = parseInt(nodo.textContent, 10);
    const reducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducido || Number.isNaN(inicio) || inicio === final) { nodo.textContent = final; return; }
    const t0 = performance.now();
    const dur = 700;
    nodo.animId = (nodo.animId || 0) + 1; // una animación nueva cancela la anterior del mismo número
    const miId = nodo.animId;
    (function paso(ahora) {
      if (nodo.animId !== miId) return;
      const p = Math.min(1, (ahora - t0) / dur);
      nodo.textContent = Math.round(inicio + (final - inicio) * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(paso);
    }(t0));
  }

  function actualizarResumen(resumen) {
    const el = elementos();
    animarNumero(el.resumenTotal, resumen.total);
    animarNumero(el.resumenPendiente, resumen.pendiente);
    animarNumero(el.resumenPublicada, resumen.publicada);
    animarNumero(el.resumenOculta, resumen.oculta);
  }

  /** Aviso visible y breve (además del anuncio para lectores de pantalla). */
  let toastActual = null;
  function mostrarToast(mensaje, tipo) {
    if (toastActual) toastActual.remove();
    const toast = document.createElement('div');
    toast.className = 'admin-toast';
    toast.dataset.tipo = tipo || 'ok';
    toast.setAttribute('aria-hidden', 'true');
    toast.textContent = mensaje;
    document.body.appendChild(toast);
    toastActual = toast;
    setTimeout(() => {
      toast.classList.add('is-saliendo');
      setTimeout(() => { toast.remove(); if (toastActual === toast) toastActual = null; }, 340);
    }, 2800);
  }

  function renderSkeletons(cantidad) {
    const tpl = $('#tpl-admin-skeleton');
    for (let i = 0; i < cantidad; i += 1) {
      const nodo = tpl.content.firstElementChild.cloneNode(true);
      nodo.classList.add('es-temporal');
      elementos().grid.appendChild(nodo);
    }
  }

  function categoryLabel(id) {
    const encontrada = CONFIG.CATEGORIES.find((c) => c.id === id);
    return encontrada ? encontrada.label : 'General';
  }

  function formatearFecha(iso) {
    try {
      return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function placeholderAdmin() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500">
      <rect width="400" height="500" fill="#E9DAC1"/>
      <text x="200" y="260" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="18" fill="#8C6E3F">H &amp; R</text>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  let numeroSolicitudFotos = 0;
  const LOTE = 24;               // tarjetas que se dibujan por tanda (con cientos de fotos, dibujar todas de golpe congela el panel)
  let pendientesRender = [];
  let observadorLote = null;

  function calcularResumenLocal() {
    const r = { total: todas.length, publicada: 0, pendiente: 0, oculta: 0 };
    todas.forEach((f) => { if (r[f.status] !== undefined) r[f.status] += 1; });
    return r;
  }

  function renderGrid() {
    const el = elementos();
    el.error.hidden = true;
    el.grid.textContent = '';
    fotosActuales = filtroActual === 'todas' ? todas.slice() : todas.filter((f) => f.status === filtroActual);
    el.vacio.hidden = fotosActuales.length > 0;
    pendientesRender = fotosActuales.slice();
    renderSiguienteLote();
  }

  function renderSiguienteLote() {
    const el = elementos();
    const lote = pendientesRender.splice(0, LOTE);
    const fragmento = document.createDocumentFragment();
    lote.forEach((foto, i) => fragmento.appendChild(crearTarjeta(foto, i)));
    el.grid.appendChild(fragmento);
    prepararCentinelaLote();
  }

  function prepararCentinelaLote() {
    if (observadorLote) { observadorLote.disconnect(); observadorLote = null; }
    const anterior = $('#admin-centinela');
    if (anterior) anterior.remove();
    if (!pendientesRender.length) return;
    const centinela = document.createElement('div');
    centinela.id = 'admin-centinela';
    centinela.setAttribute('aria-hidden', 'true');
    centinela.style.height = '1px';
    elementos().grid.after(centinela);
    observadorLote = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) renderSiguienteLote();
    }, { rootMargin: '700px 0px' });
    observadorLote.observe(centinela);
  }

  async function cargarFotos() {
    const el = elementos();
    // Si se pide otra carga antes de que termine la anterior, solo vale la última.
    const miSolicitud = ++numeroSolicitudFotos;
    el.error.hidden = true;
    const primeraCarga = todas.length === 0;
    if (primeraCarga) { el.vacio.hidden = true; el.grid.textContent = ''; renderSkeletons(6); }
    el.botonActualizar.disabled = true;

    try {
      const datos = await get({ action: 'adminListAll', token, status: 'todas' });
      if (miSolicitud !== numeroSolicitudFotos) return;
      todas = datos.items;
      actualizarResumen(calcularResumenLocal());
      if (typeof datos.moderationEnabled === 'boolean') {
        el.switchModeracion.checked = datos.moderationEnabled;
        el.switchModeracion.disabled = false;
        configAplicada = true;
      }
      renderGrid();
      announce(`${todas.length} fotografías cargadas.`);
    } catch (err) {
      if (miSolicitud !== numeroSolicitudFotos) return;
      $$('.es-temporal', el.grid).forEach((n) => n.remove());
      if (err.codigo === 'SESION_INVALIDA') { cerrarSesion('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
      if (!primeraCarga) {
        // Una actualización fallida NO borra lo que ya se ve: solo avisa.
        mostrarToast('No se pudo actualizar. Se muestra lo último cargado.', 'error');
        return;
      }
      el.error.hidden = false;
      el.errorMensaje.textContent = mensajeErrorCarga(err);
      announce('No se pudo cargar el álbum.', true);
    } finally {
      if (miSolicitud === numeroSolicitudFotos) el.botonActualizar.disabled = false;
    }
  }

  function mensajeErrorCarga(err) {
    const codigo = err && err.codigo;
    if (codigo === 'TIMEOUT') return 'El álbum tardó demasiado en responder. Verifica tu conexión.';
    if (codigo === 'RED') return 'No pudimos conectarnos con el álbum en línea. Revisa tu conexión a internet.';
    if (codigo === 'SERVIDOR_OCUPADO') return 'El álbum está recibiendo muchas visitas en este momento. Intenta de nuevo en un momento.';
    return 'No se pudo cargar la información del álbum. Verifica que el backend esté desplegado (ver apps-script/README_SETUP.md).';
  }

  function crearTarjeta(foto, indice) {
    const tpl = $('#tpl-admin-card');
    const nodo = tpl.content.firstElementChild.cloneNode(true);
    nodo.dataset.status = foto.status;
    nodo.dataset.id = foto.id;
    nodo.style.setProperty('--giro', `${((indice % 5) - 2) * 0.6}deg`);
    nodo.style.setProperty('--i', String(Math.min(indice, 14)));

    const img = $('.admin-card__img', nodo);
    const marco = $('.admin-card__marco', nodo);
    img.addEventListener('load', () => marco.classList.add('esta-lista'), { once: true });
    img.addEventListener('error', function alError() {
      img.removeEventListener('error', alError);
      img.src = placeholderAdmin();
      marco.classList.add('esta-lista');
    }, { once: true });
    img.src = foto.thumbUrl || foto.viewUrl || placeholderAdmin();
    img.alt = `Fotografía de ${categoryLabel(foto.category)}`;

    $('.admin-card__enlace-imagen', nodo).addEventListener('click', () => abrirVisor(foto.id));
    $('.admin-card__estado', nodo).textContent = ETIQUETA_ESTADO[foto.status] || foto.status;
    $('.admin-card__categoria', nodo).textContent = categoryLabel(foto.category);
    $('.admin-card__invitado', nodo).textContent = foto.guestName || '';
    $('.admin-card__dedicatoria', nodo).textContent = foto.dedication || '';
    $('.admin-card__fecha', nodo).textContent = formatearFecha(foto.createdAt);

    $('.admin-card__aprobar', nodo).addEventListener('click', () => moderar(foto.id, 'publicada', nodo));
    $('.admin-card__ocultar', nodo).addEventListener('click', () => moderar(foto.id, 'oculta', nodo));

    const confirmar = $('.admin-card__confirmar', nodo);
    const botonesPrincipales = ['.admin-card__aprobar', '.admin-card__ocultar', '.admin-card__eliminar']
      .map((selector) => $(selector, nodo))
      .filter(Boolean);
    // Mientras se ve el aviso de confirmación, los botones de abajo quedan
    // tapados visualmente — sin esto, seguían siendo alcanzables con Tab.
    function mostrarConfirmar(mostrar) {
      confirmar.hidden = !mostrar;
      botonesPrincipales.forEach((b) => { b.tabIndex = mostrar ? -1 : 0; b.setAttribute('aria-hidden', String(mostrar)); });
    }
    $('.admin-card__eliminar', nodo).addEventListener('click', () => mostrarConfirmar(true));
    $('.admin-card__confirmar-no', nodo).addEventListener('click', () => mostrarConfirmar(false));
    $('.admin-card__confirmar-si', nodo).addEventListener('click', () => eliminar(foto.id, nodo));

    return nodo;
  }

  /* ==========================================================================
     VISOR DE FOTOGRAFÍA (modal, con navegación anterior/siguiente)
     ========================================================================== */
  let ultimoFocoAntesDelVisor = null;
  let solicitudVisor = 0;
  const imagenesPrecargadas = new Map();

  /** Descarga una imagen en segundo plano; resuelve true/false. Recuerda las ya pedidas. */
  function precargarImagen(url) {
    if (!url) return Promise.resolve(false);
    if (imagenesPrecargadas.has(url)) return imagenesPrecargadas.get(url);
    const promesa = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => { imagenesPrecargadas.delete(url); resolve(false); };
      img.src = url;
    });
    imagenesPrecargadas.set(url, promesa);
    return promesa;
  }

  function abrirVisor(id) {
    const posicion = fotosActuales.findIndex((f) => f.id === id);
    if (posicion === -1) return;
    indiceVisor = posicion;
    ultimoFocoAntesDelVisor = document.activeElement;
    elementos().visor.hidden = false;
    document.body.classList.add('no-scroll');
    renderVisor();
    elementos().visor.querySelector('.visor-modal__cerrar').focus();
  }

  function cerrarVisor() {
    elementos().visor.hidden = true;
    document.body.classList.remove('no-scroll');
    if (ultimoFocoAntesDelVisor && document.contains(ultimoFocoAntesDelVisor)) ultimoFocoAntesDelVisor.focus();
  }

  function visorSiguiente() { if (fotosActuales.length > 1) { indiceVisor = (indiceVisor + 1) % fotosActuales.length; renderVisor(); } }
  function visorAnterior() { if (fotosActuales.length > 1) { indiceVisor = (indiceVisor - 1 + fotosActuales.length) % fotosActuales.length; renderVisor(); } }

  function renderVisor() {
    const foto = fotosActuales[indiceVisor];
    if (!foto) { cerrarVisor(); return; }
    const el = elementos();

    el.visorImagen.classList.remove('lb-in');
    void el.visorImagen.offsetWidth; // reinicia la animación
    el.visorImagen.classList.add('lb-in');
    el.visorImagen.onerror = () => { el.visorImagen.onerror = null; el.visorImagen.src = placeholderAdmin(); };
    // Apertura rápida: se muestra YA la miniatura (la tarjeta ya la descargó) y la versión
    // mediana la reemplaza al terminar de bajar. El modal mide ~540 px: pedir 1600 px era 3x más pesado de lo necesario.
    const miniatura = foto.thumbUrl || foto.viewUrl || placeholderAdmin();
    const mediana = agrandarMiniaturaDrive(foto.thumbUrl, 1000) || miniatura;
    const solicitud = ++solicitudVisor;
    el.visorImagen.src = miniatura;
    if (mediana !== miniatura) {
      el.visorImagen.classList.add('es-cargando');
      precargarImagen(mediana).then((ok) => {
        if (solicitud !== solicitudVisor) return;
        if (ok) el.visorImagen.src = mediana;
        el.visorImagen.classList.remove('es-cargando');
        // Las vecinas se bajan en segundo plano: al pasar a la siguiente foto ya está lista.
        [fotosActuales[indiceVisor + 1], fotosActuales[indiceVisor - 1]].forEach((v) => {
          if (v && v.thumbUrl) precargarImagen(agrandarMiniaturaDrive(v.thumbUrl, 1000));
        });
      });
    } else {
      el.visorImagen.classList.remove('es-cargando');
    }
    el.visorImagen.alt = `Fotografía de ${categoryLabel(foto.category)}`;

    el.visorCategoria.textContent = categoryLabel(foto.category);
    el.visorEstado.textContent = ETIQUETA_ESTADO[foto.status] || foto.status;
    el.visorEstado.dataset.status = foto.status;
    el.visorInvitado.textContent = foto.guestName || '';
    el.visorDedicatoria.textContent = foto.dedication ? `"${foto.dedication.trim()}"` : '';
    el.visorFecha.textContent = formatearFecha(foto.createdAt);

    el.visorActual.textContent = String(indiceVisor + 1);
    el.visorTotal.textContent = String(fotosActuales.length);
    el.visorOriginal.href = foto.viewUrl || foto.thumbUrl || '#';
    el.visorPrev.disabled = fotosActuales.length <= 1;
    el.visorNext.disabled = fotosActuales.length <= 1;
  }

  function manejarTecladoVisor(e) {
    if (elementos().visor.hidden) return;
    if (e.key === 'Escape') cerrarVisor();
    else if (e.key === 'ArrowRight') visorSiguiente();
    else if (e.key === 'ArrowLeft') visorAnterior();
  }

  function quitarTarjetaConAnimacion(nodo) {
    fotosActuales = fotosActuales.filter((f) => f.id !== nodo.dataset.id);
    nodo.classList.add('admin-card--saliendo');
    setTimeout(() => {
      nodo.remove();
      if (!$('.admin-card', elementos().grid) && !pendientesRender.length) elementos().vacio.hidden = false;
    }, 260);
  }

  /**
   * Moderar y eliminar son OPTIMISTAS: la pantalla cambia al instante y la
   * petición viaja en segundo plano (Apps Script tarda 1-3 s por llamada, que
   * se sentían como el panel "lento"). Si el servidor falla, se revierte y se avisa.
   */
  async function moderar(id, nuevoEstado, nodo) {
    const foto = todas.find((f) => f.id === id);
    if (!foto || foto.status === nuevoEstado) return;
    const estadoAnterior = foto.status;
    foto.status = nuevoEstado;
    actualizarResumen(calcularResumenLocal());
    announce(nuevoEstado === 'publicada' ? 'Fotografía aprobada.' : 'Fotografía ocultada.');
    mostrarToast(nuevoEstado === 'publicada' ? 'Fotografía aprobada' : 'Fotografía ocultada');
    if (filtroActual !== 'todas' && filtroActual !== nuevoEstado) {
      quitarTarjetaConAnimacion(nodo);
    } else {
      nodo.dataset.status = nuevoEstado;
      $('.admin-card__estado', nodo).textContent = ETIQUETA_ESTADO[nuevoEstado];
    }
    try {
      await post('adminModerar', { token, id, status: nuevoEstado });
    } catch (err) {
      foto.status = estadoAnterior;
      actualizarResumen(calcularResumenLocal());
      if (err.codigo === 'SESION_INVALIDA') { cerrarSesion('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
      announce('No se pudo actualizar la fotografía. Intenta de nuevo.', true);
      mostrarToast('No se pudo actualizar. Se deshizo el cambio.', 'error');
      renderGrid();
    }
  }

  async function eliminar(id, nodo) {
    const posicion = todas.findIndex((f) => f.id === id);
    if (posicion === -1) return;
    const [foto] = todas.splice(posicion, 1);
    actualizarResumen(calcularResumenLocal());
    announce('Fotografía eliminada permanentemente.');
    mostrarToast('Fotografía eliminada');
    quitarTarjetaConAnimacion(nodo);
    try {
      await post('adminEliminar', { token, id });
    } catch (err) {
      todas.splice(posicion, 0, foto);
      actualizarResumen(calcularResumenLocal());
      if (err.codigo === 'SESION_INVALIDA') { cerrarSesion('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
      announce('No se pudo eliminar la fotografía. Intenta de nuevo.', true);
      mostrarToast('No se pudo eliminar. Se restauró la foto.', 'error');
      renderGrid();
    }
  }

  /* ==========================================================================
     DESCARGA DEL ÁLBUM (.pdf generado en Drive por Apps Script)
     ========================================================================== */
  function abrirModalDescarga() {
    elementos().modalDescarga.hidden = false;
    elementos().descargaEstado.hidden = true;
    document.body.classList.add('no-scroll');
  }
  function cerrarModalDescarga() {
    elementos().modalDescarga.hidden = true;
    document.body.classList.remove('no-scroll');
  }

  function mostrarEstadoDescarga(tipo, mensaje, urlDescarga) {
    const el = elementos().descargaEstado;
    el.textContent = '';
    el.dataset.tipo = tipo;
    el.hidden = false;

    if (tipo === 'cargando') {
      const spinner = document.createElement('span');
      spinner.className = 'descarga-estado__spinner';
      spinner.setAttribute('aria-hidden', 'true');
      el.append(spinner, document.createTextNode(mensaje));
      return;
    }

    const iconoId = tipo === 'error' ? 'icon-alert' : tipo === 'advertencia' ? 'icon-alert' : 'icon-check';
    const cuerpo = document.createElement('div');
    cuerpo.className = 'descarga-estado__cuerpo';

    const icono = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icono.setAttribute('class', 'descarga-estado__icono');
    icono.setAttribute('aria-hidden', 'true');
    const uso = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    uso.setAttribute('href', `#${iconoId}`);
    icono.appendChild(uso);

    const texto = document.createElement('p');
    texto.className = 'descarga-estado__texto';
    texto.textContent = mensaje;

    cuerpo.append(icono, texto);
    el.appendChild(cuerpo);

    if (urlDescarga) {
      const enlace = document.createElement('a');
      enlace.href = urlDescarga;
      enlace.className = 'descarga-estado__boton';
      enlace.target = '_blank';
      enlace.rel = 'noopener';
      const usoDescarga = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      usoDescarga.setAttribute('aria-hidden', 'true');
      const usoUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      usoUse.setAttribute('href', '#icon-download');
      usoDescarga.appendChild(usoUse);
      enlace.append(usoDescarga, document.createTextNode('Volver a descargar el PDF'));
      el.appendChild(enlace);
    }
  }

  /** El PDF se descarga solo apenas está listo, sin que el usuario tenga que darle clic a nada. */
  function dispararDescargaAutomatica(urlDescarga) {
    try {
      const enlaceOculto = document.createElement('a');
      enlaceOculto.href = urlDescarga;
      enlaceOculto.rel = 'noopener';
      enlaceOculto.style.display = 'none';
      document.body.appendChild(enlaceOculto);
      enlaceOculto.click();
      enlaceOculto.remove();
    } catch (err) {
      // Si el navegador bloquea la descarga automática, el botón "Volver a
      // descargar el PDF" del estado de éxito sigue disponible como respaldo.
    }
  }

  function mensajeErrorDescarga(err) {
    const codigo = err && err.codigo;
    if (codigo === 'SIN_FOTOGRAFIAS') return 'No hay fotografías que coincidan con ese filtro.';
    if (codigo === 'TIMEOUT') return 'La generación tardó demasiado (el álbum es muy grande). Intenta de nuevo, o revisa la carpeta "Descargas del álbum" directamente en Drive.';
    // El servidor ahora indica en qué paso exacto falló (crear presentación,
    // crear páginas, exportar, guardar); se muestra tal cual en vez de un
    // mensaje genérico, para poder diagnosticarlo sin acceso a los registros.
    if (err && err.message) return err.message;
    return 'No se pudo generar el archivo. Intenta de nuevo.';
  }

  async function manejarSubmitDescarga(e) {
    e.preventDefault();
    const el = elementos();
    const filtro = el.campoFiltroDescarga.value;
    el.botonGenerarDescarga.disabled = true;
    mostrarEstadoDescarga('cargando', ' Generando el PDF del álbum… puede tardar según cuántas fotografías haya.');
    try {
      // reintentable:false — generar el PDF puede tardar varios minutos; si
      // el primer intento se agota, reintentarlo solo dispararía OTRA
      // generación larga en vez de resolver algo, y podría confundir al
      // duplicar el trabajo. Mejor que el botón "Reintentar" quede a mano.
      const datos = await post('adminGenerarDescarga', { token, filtro }, DESCARGA_TIMEOUT_MS, false);
      const faltantes = datos.solicitadas - datos.cantidad;
      const mensaje = faltantes > 0
        ? `Listo: ${datos.cantidad} de ${datos.solicitadas} fotografías incluidas (${faltantes} no se pudieron leer desde Drive). La descarga comenzó sola.`
        : `Listo: ${datos.cantidad} fotografía${datos.cantidad === 1 ? '' : 's'} incluidas. La descarga comenzó sola.`;
      mostrarEstadoDescarga(faltantes > 0 ? 'advertencia' : 'exito', mensaje, datos.url);
      if (datos.url) dispararDescargaAutomatica(datos.url);
    } catch (err) {
      if (err.codigo === 'SESION_INVALIDA') { cerrarModalDescarga(); cerrarSesion('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
      mostrarEstadoDescarga('error', mensajeErrorDescarga(err));
    } finally {
      el.botonGenerarDescarga.disabled = false;
    }
  }

  /* ==========================================================================
     ARRANQUE
     ========================================================================== */
  function init() {
    const el = elementos();

    el.formLogin.addEventListener('submit', manejarSubmitLogin);
    el.botonMostrarPassword.addEventListener('click', () => {
      const mostrando = el.campoPassword.type === 'text';
      el.campoPassword.type = mostrando ? 'password' : 'text';
      el.botonMostrarPassword.setAttribute('aria-pressed', String(!mostrando));
      $('use', el.botonMostrarPassword).setAttribute('href', mostrando ? '#icon-eye-off' : '#icon-eye');
      el.campoPassword.focus();
    });

    el.botonSalir.addEventListener('click', () => cerrarSesion()); // sin argumentos: el evento de clic se mostraba como mensaje ("[object PointerEvent]")
    el.botonActualizar.addEventListener('click', cargarFotos);
    el.reintentar.addEventListener('click', cargarFotos);

    el.switchModeracion.addEventListener('change', manejarCambioModeracion);
    el.botonDescargar.addEventListener('click', abrirModalDescarga);
    $$('[data-cerrar-modal="descarga"]').forEach((btn) => btn.addEventListener('click', cerrarModalDescarga));
    el.formDescarga.addEventListener('submit', manejarSubmitDescarga);
    if (typeof UiSelect !== 'undefined') UiSelect.mejorar(el.campoFiltroDescarga, { modo: 'tarjetas' });

    $$('[data-cerrar-visor]').forEach((btn) => btn.addEventListener('click', cerrarVisor));
    el.visorPrev.addEventListener('click', visorAnterior);
    el.visorNext.addEventListener('click', visorSiguiente);
    let toqueX = 0;
    const panelVisor = el.visor.querySelector('.visor-modal__panel');
    panelVisor.addEventListener('touchstart', (e) => { toqueX = e.changedTouches[0].clientX; }, { passive: true });
    panelVisor.addEventListener('touchend', (e) => {
      const delta = e.changedTouches[0].clientX - toqueX;
      if (Math.abs(delta) > 60) (delta < 0 ? visorSiguiente() : visorAnterior());
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.modalDescarga.hidden) cerrarModalDescarga();
      manejarTecladoVisor(e);
    });

    intentarSesionGuardada();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', AdminModule.init);
