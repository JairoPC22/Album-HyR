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
     text/plain para evitar preflight CORS, errores con código estable)
     ========================================================================== */
  async function peticion(url, opciones, timeoutMs) {
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
      if (err.name === 'AbortError') throw Object.assign(new Error('La solicitud tardó demasiado.'), { codigo: 'TIMEOUT' });
      throw err;
    }
  }

  function post(action, payload, timeoutMs) {
    return peticion(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
    }, timeoutMs);
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
    if (!guardado) { mostrarLogin(); return; }
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
      cargarFotos();
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
    await Promise.all([cargarFotos(), cargarConfiguracion()]);
    // cargarFotos()/cargarConfiguracion() nunca lanzan: si la sesión expiró,
    // ya llamaron a cerrarSesion() internamente y token queda en null. Se usa
    // eso como señal para que quien llamó sepa si de verdad puede mostrar el panel.
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

  function actualizarResumen(resumen) {
    const el = elementos();
    el.resumenTotal.textContent = resumen.total;
    el.resumenPendiente.textContent = resumen.pendiente;
    el.resumenPublicada.textContent = resumen.publicada;
    el.resumenOculta.textContent = resumen.oculta;
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

  async function cargarFotos() {
    const el = elementos();
    el.error.hidden = true;
    el.vacio.hidden = true;
    el.grid.textContent = '';
    renderSkeletons(6);

    try {
      const datos = await get({ action: 'adminListAll', token, status: filtroActual });
      $$('.es-temporal', el.grid).forEach((n) => n.remove());
      actualizarResumen(datos.resumen);
      fotosActuales = datos.items;

      if (!datos.items.length) { el.vacio.hidden = false; return; }
      datos.items.forEach((foto, i) => el.grid.appendChild(crearTarjeta(foto, i)));
      announce(`${datos.items.length} fotografías cargadas.`);
    } catch (err) {
      $$('.es-temporal', el.grid).forEach((n) => n.remove());
      if (err.codigo === 'SESION_INVALIDA') { cerrarSesion('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
      el.error.hidden = false;
      el.errorMensaje.textContent = mensajeErrorCarga(err);
      announce('No se pudo cargar el álbum.', true);
    }
  }

  function mensajeErrorCarga(err) {
    if (err && err.codigo === 'TIMEOUT') return 'El álbum tardó demasiado en responder. Verifica tu conexión.';
    return 'No se pudo cargar la información del álbum. Verifica que el backend esté desplegado (ver apps-script/README_SETUP.md).';
  }

  function crearTarjeta(foto, indice) {
    const tpl = $('#tpl-admin-card');
    const nodo = tpl.content.firstElementChild.cloneNode(true);
    nodo.dataset.status = foto.status;
    nodo.dataset.id = foto.id;
    nodo.style.setProperty('--giro', `${((indice % 5) - 2) * 0.6}deg`);

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

    el.visorImagen.onerror = () => { el.visorImagen.onerror = null; el.visorImagen.src = placeholderAdmin(); };
    el.visorImagen.src = agrandarMiniaturaDrive(foto.thumbUrl, 1600) || foto.viewUrl || placeholderAdmin();
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
      if (!$('.admin-card', elementos().grid)) elementos().vacio.hidden = false;
    }, 260);
  }

  async function moderar(id, nuevoEstado, nodo) {
    const botones = $$('button', nodo);
    botones.forEach((b) => { b.disabled = true; });
    try {
      const datos = await post('adminModerar', { token, id, status: nuevoEstado });
      actualizarResumen(datos.resumen);
      announce(nuevoEstado === 'publicada' ? 'Fotografía aprobada.' : 'Fotografía ocultada.');
      if (filtroActual !== 'todas' && filtroActual !== nuevoEstado) {
        quitarTarjetaConAnimacion(nodo);
      } else {
        nodo.dataset.status = nuevoEstado;
        $('.admin-card__estado', nodo).textContent = ETIQUETA_ESTADO[nuevoEstado];
        const fotoActualizada = fotosActuales.find((f) => f.id === id);
        if (fotoActualizada) fotoActualizada.status = nuevoEstado;
        botones.forEach((b) => { b.disabled = false; });
      }
    } catch (err) {
      if (err.codigo === 'SESION_INVALIDA') { cerrarSesion('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
      announce('No se pudo actualizar la fotografía. Intenta de nuevo.', true);
      botones.forEach((b) => { b.disabled = false; });
    }
  }

  async function eliminar(id, nodo) {
    const botones = $$('button', nodo);
    botones.forEach((b) => { b.disabled = true; });
    try {
      const datos = await post('adminEliminar', { token, id });
      actualizarResumen(datos.resumen);
      announce('Fotografía eliminada permanentemente.');
      quitarTarjetaConAnimacion(nodo);
    } catch (err) {
      if (err.codigo === 'SESION_INVALIDA') { cerrarSesion('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
      announce('No se pudo eliminar la fotografía. Intenta de nuevo.', true);
      botones.forEach((b) => { b.disabled = false; });
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
      const datos = await post('adminGenerarDescarga', { token, filtro }, DESCARGA_TIMEOUT_MS);
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

    el.botonSalir.addEventListener('click', cerrarSesion);
    el.botonActualizar.addEventListener('click', cargarFotos);
    el.reintentar.addEventListener('click', cargarFotos);

    el.switchModeracion.addEventListener('change', manejarCambioModeracion);
    el.botonDescargar.addEventListener('click', abrirModalDescarga);
    $$('[data-cerrar-modal="descarga"]').forEach((btn) => btn.addEventListener('click', cerrarModalDescarga));
    el.formDescarga.addEventListener('submit', manejarSubmitDescarga);

    $$('[data-cerrar-visor]').forEach((btn) => btn.addEventListener('click', cerrarVisor));
    el.visorPrev.addEventListener('click', visorAnterior);
    el.visorNext.addEventListener('click', visorSiguiente);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.modalDescarga.hidden) cerrarModalDescarga();
      manejarTecladoVisor(e);
    });

    intentarSesionGuardada();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', AdminModule.init);
