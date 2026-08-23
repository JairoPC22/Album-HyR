/**
 * Héctor & Raquel — Backend del álbum colaborativo de boda.
 * Google Apps Script: recibe fotografías del frontend, las guarda en Drive
 * y registra sus metadatos en Sheets. No se guardan imágenes ni Base64 en las celdas.
 *
 * Acciones soportadas:
 *   GET  ?action=health
 *   GET  ?action=list&category=&cursor=&pageSize=
 *   GET  ?action=adminListAll&token=&status=       (panel de administración)
 *   GET  ?action=adminObtenerConfig&token=         (panel de administración)
 *   POST { action: 'upload', ... }
 *   POST { action: 'verifyCode', code: '...' }
 *   POST { action: 'adminLogin', password: '...' }              (panel de administración)
 *   POST { action: 'adminLogout', token: '...' }                 (panel de administración)
 *   POST { action: 'adminModerar', token, id, status }           (panel de administración)
 *   POST { action: 'adminEliminar', token, id }                  (panel de administración)
 *   POST { action: 'adminActualizarConfig', token, moderationEnabled } (panel de administración)
 *   POST { action: 'adminGenerarDescarga', token, filtro }       (panel de administración)
 */

/* ==========================================================================
 * CONFIGURACIÓN Y CONSTANTES
 * ========================================================================== */
const NOMBRE_CARPETA_DRIVE = 'Boda Héctor y Raquel - Fotos';
const NOMBRE_HOJA_CALCULO = 'Boda Héctor y Raquel - Registro';
const NOMBRE_PESTANA = 'Fotografias';
const NOMBRE_CARPETA_DESCARGAS = 'Descargas del álbum';

const ENCABEZADOS = [
  'id', 'idempotencyKey', 'fileName', 'driveFileId', 'viewUrl', 'thumbUrl',
  'category', 'guestName', 'dedication', 'mimeType', 'sizeBytes', 'width',
  'height', 'createdAt', 'status',
];

const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const CACHE_TTL_SEGUNDOS = 60;
const CLAVE_CACHE_PUBLICADAS = 'publicadas_todas_v1';
const LOCK_TIMEOUT_MS = 10000;
const ADMIN_SESSION_TTL_SEGUNDOS = 6 * 60 * 60; // 6 horas: máximo permitido por CacheService

/* ==========================================================================
 * PUNTOS DE ENTRADA
 * ========================================================================== */
function doGet(e) {
  try {
    const accion = (e.parameter.action || '').trim();
    if (accion === 'health') return jsonResponse_({ ok: true, data: obtenerEstadoSalud_() });
    if (accion === 'list') return jsonResponse_({ ok: true, data: listarFotografias_(e.parameter) });
    if (accion === 'adminListAll') return jsonResponse_({ ok: true, data: adminListarTodas_(e.parameter) });
    if (accion === 'adminObtenerConfig') return jsonResponse_({ ok: true, data: adminObtenerConfig_(e.parameter) });
    return jsonResponse_(errorPayload_('ACCION_DESCONOCIDA', 'La acción solicitada no existe.'));
  } catch (err) {
    return jsonResponse_(manejarErrorInterno_(err));
  }
}

function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonResponse_(errorPayload_('SOLICITUD_INVALIDA', 'La solicitud no incluye datos.'));
    }
    let cuerpo;
    try {
      cuerpo = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse_(errorPayload_('JSON_INVALIDO', 'El formato de la solicitud no es válido.'));
    }

    const accion = (cuerpo.action || '').trim();
    if (accion === 'upload') return jsonResponse_({ ok: true, data: subirFotografia_(cuerpo) });
    if (accion === 'verifyCode') return jsonResponse_({ ok: true, data: verificarCodigoEvento_(cuerpo) });
    if (accion === 'adminLogin') return jsonResponse_({ ok: true, data: adminLogin_(cuerpo) });
    if (accion === 'adminLogout') return jsonResponse_({ ok: true, data: adminLogout_(cuerpo) });
    if (accion === 'adminModerar') return jsonResponse_({ ok: true, data: adminModerar_(cuerpo) });
    if (accion === 'adminEliminar') return jsonResponse_({ ok: true, data: adminEliminar_(cuerpo) });
    if (accion === 'adminActualizarConfig') return jsonResponse_({ ok: true, data: adminActualizarConfig_(cuerpo) });
    if (accion === 'adminGenerarDescarga') return jsonResponse_({ ok: true, data: adminGenerarDescarga_(cuerpo) });
    return jsonResponse_(errorPayload_('ACCION_DESCONOCIDA', 'La acción solicitada no existe.'));
  } catch (err) {
    return jsonResponse_(manejarErrorInterno_(err));
  }
}

/* ==========================================================================
 * ACCIÓN: health
 * ========================================================================== */
function obtenerEstadoSalud_() {
  return {
    status: 'ok',
    time: new Date().toISOString(),
    moderationEnabled: obtenerPropiedad_('MODERATION_ENABLED', 'false') === 'true',
  };
}

/* ==========================================================================
 * ACCIÓN: list — lectura, filtrado, orden y paginación
 * ========================================================================== */
function listarFotografias_(parametros) {
  const categoria = sanitizarIdentificador_(parametros.category || 'todos');
  const pageSize = clamp_(parseInt(parametros.pageSize, 10) || 16, 1, 48);
  const cursor = Math.max(0, parseInt(parametros.cursor, 10) || 0);

  // Antes había una entrada de caché POR CADA combinación de categoría +
  // pageSize (ej. "list_celebracion_16", "list_todos_16"...). Al publicar
  // una fotografía nueva solo se podía invalidar TODO el caché o nada, así
  // que se dejaba expirar solo. Resultado: si alguien ya había cargado
  // "todos" antes de que una foto de "La gran celebración" se publicara, esa
  // foto no aparecía en "todos" hasta que esa entrada específica expirara
  // por su cuenta (hasta 60s) — aunque sí apareciera de una al filtrar
  // directamente por su categoría, que se cacheaba por separado. Ahora hay
  // UNA sola lista cacheada (todas las publicadas) de la que se filtra en
  // memoria, así que invalidarla una vez (ver invalidarCachePublicadas_)
  // arregla "todos" y cualquier categoría a la vez.
  const publicadas = obtenerPublicadasCacheadas_()
    .filter((fila) => categoria === 'todos' || fila.category === categoria);

  const pagina = publicadas.slice(cursor, cursor + pageSize);
  const siguienteCursor = cursor + pageSize < publicadas.length ? String(cursor + pageSize) : '';

  return { items: pagina, nextCursor: siguienteCursor, total: publicadas.length };
}

/** Lista completa de fotografías publicadas, cacheada bajo UNA sola clave (no una por categoría). */
function obtenerPublicadasCacheadas_() {
  const cache = CacheService.getScriptCache();
  const cacheado = cache.get(CLAVE_CACHE_PUBLICADAS);
  if (cacheado) return JSON.parse(cacheado);

  const filas = obtenerFilasComoObjetos_();
  const publicadas = filas
    .filter((fila) => fila.status === 'publicada')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(mapearFilaParaCliente_);
  cache.put(CLAVE_CACHE_PUBLICADAS, JSON.stringify(publicadas), CACHE_TTL_SEGUNDOS);
  return publicadas;
}

/** Se llama después de CUALQUIER cambio que afecte qué se ve en la galería pública (subir, moderar, eliminar). */
function invalidarCachePublicadas_() {
  try {
    CacheService.getScriptCache().remove(CLAVE_CACHE_PUBLICADAS);
  } catch (err) {
    registrarIncidencia_('No se pudo invalidar el caché de fotografías publicadas (no es crítico, se autolimpia en 60s)', err);
  }
}

function mapearFilaParaCliente_(fila) {
  // No se exponen columnas internas innecesarias (por ejemplo idempotencyKey).
  return {
    id: fila.id,
    fileName: fila.fileName,
    viewUrl: fila.viewUrl,
    thumbUrl: fila.thumbUrl,
    category: fila.category,
    guestName: fila.guestName,
    dedication: fila.dedication,
    mimeType: fila.mimeType,
    sizeBytes: fila.sizeBytes,
    width: fila.width,
    height: fila.height,
    createdAt: fila.createdAt,
  };
}

/* ==========================================================================
 * ACCIÓN: upload — validación, Drive, Sheets, idempotencia
 * ========================================================================== */
function subirFotografia_(cuerpo) {
  const idempotencyKey = String(cuerpo.idempotencyKey || '').trim();
  const fileNameOriginal = String(cuerpo.fileName || '').trim();
  const mimeType = String(cuerpo.mimeType || '').trim();
  const base64 = String(cuerpo.base64 || '');
  const category = sanitizarIdentificador_(cuerpo.category || '');
  const guestName = sanitizarTexto_(cuerpo.guestName, 60);
  // La dedicatoria se corrige ortográficamente ANTES de guardarse: así, desde
  // el primer momento en que existe (galería pública, panel, PDF), ya está
  // corregida — nadie tiene que revisarla ni reenviarla a mano.
  const dedication = corregirOrtografia_(sanitizarTexto_(cuerpo.dedication, 240)).slice(0, 240);
  const width = Number.isFinite(cuerpo.width) ? Math.round(cuerpo.width) : null;
  const height = Number.isFinite(cuerpo.height) ? Math.round(cuerpo.height) : null;

  if (!idempotencyKey) throw new ErrorControlado_('SOLICITUD_INVALIDA', 'Falta el identificador de idempotencia.');
  if (!fileNameOriginal) throw new ErrorControlado_('SOLICITUD_INVALIDA', 'Falta el nombre del archivo.');
  if (!base64) throw new ErrorControlado_('SOLICITUD_INVALIDA', 'Falta el contenido de la fotografía.');
  if (!category) throw new ErrorControlado_('SOLICITUD_INVALIDA', 'Falta la categoría de la fotografía.');
  if (MIME_PERMITIDOS.indexOf(mimeType) === -1) {
    throw new ErrorControlado_('FORMATO_NO_PERMITIDO', 'El formato de la fotografía no está permitido.');
  }

  const maxBytes = clamp_(parseInt(obtenerPropiedad_('MAX_FILE_MB', '15'), 10) || 15, 1, 50) * 1024 * 1024;
  const tamanoEstimado = Math.floor((base64.length * 3) / 4);
  if (tamanoEstimado > maxBytes) {
    throw new ErrorControlado_('ARCHIVO_MUY_GRANDE', 'La fotografía supera el tamaño máximo permitido.');
  }

  // Verificación rápida sin bloqueo: evita subir a Drive cuando es un
  // reintento obvio del mismo archivo (no es la comprobación definitiva,
  // solo un ahorro de trabajo — la comprobación que sí previene duplicados
  // ocurre más abajo, dentro del bloqueo).
  const posibleDuplicado = buscarPorIdempotencyKey_(idempotencyKey);
  if (posibleDuplicado) return mapearFilaParaCliente_(posibleDuplicado);

  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (decodeErr) {
    throw new ErrorControlado_('ARCHIVO_DANADO', 'No se pudo procesar la fotografía enviada.');
  }
  if (bytes.length > maxBytes) {
    throw new ErrorControlado_('ARCHIVO_MUY_GRANDE', 'La fotografía supera el tamaño máximo permitido.');
  }

  // La subida a Drive (la parte lenta) se hace FUERA del bloqueo para que
  // varios invitados puedan subir fotografías en paralelo. El bloqueo solo
  // protege la comprobación de duplicados + el registro en la hoja, que es
  // rápido — así el álbum aguanta muchas subidas simultáneas sin que unas
  // esperen a otras innecesariamente.
  const nombreSeguro = generarNombreSeguro_(fileNameOriginal, mimeType);
  const blob = Utilities.newBlob(bytes, mimeType, nombreSeguro);
  const carpeta = obtenerOCrearCarpeta_();
  const archivo = carpeta.createFile(blob);
  try {
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (sharingErr) {
    registrarIncidencia_('No se pudo configurar el acceso público del archivo', sharingErr);
  }

  const driveFileId = archivo.getId();
  const viewUrl = `https://drive.google.com/uc?export=view&id=${driveFileId}`;
  const thumbUrl = `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w480`;

  const lock = LockService.getScriptLock();
  const bloqueoObtenido = lock.tryLock(LOCK_TIMEOUT_MS);
  if (!bloqueoObtenido) {
    // El archivo ya se subió a Drive pero no se pudo registrar a tiempo:
    // se elimina para no dejar huérfanos, y se pide reintentar (el reintento
    // usa la misma idempotencyKey, así que nunca duplica el registro final).
    borrarArchivoSilenciosamente_(driveFileId);
    throw new ErrorControlado_('SERVIDOR_OCUPADO', 'El álbum está ocupado en este momento. Intenta de nuevo.');
  }

  try {
    // Re-comprobación DEFINITIVA ya dentro del bloqueo: cubre el caso raro de
    // dos solicitudes con la misma idempotencyKey (un reintento de red) que
    // llegaron casi al mismo tiempo y ambas pasaron la comprobación rápida.
    const existente = buscarPorIdempotencyKey_(idempotencyKey);
    if (existente) {
      borrarArchivoSilenciosamente_(driveFileId);
      return mapearFilaParaCliente_(existente);
    }

    const moderando = obtenerPropiedad_('MODERATION_ENABLED', 'false') === 'true';
    const fila = {
      id: Utilities.getUuid(),
      idempotencyKey,
      fileName: nombreSeguro,
      driveFileId,
      viewUrl,
      thumbUrl,
      category,
      guestName,
      dedication,
      mimeType,
      sizeBytes: bytes.length,
      width: width || '',
      height: height || '',
      createdAt: new Date().toISOString(),
      status: moderando ? 'pendiente' : 'publicada',
    };

    agregarFila_(fila);
    if (fila.status === 'publicada') invalidarCachePublicadas_();
    return mapearFilaParaCliente_(fila);
  } finally {
    lock.releaseLock();
  }
}

function borrarArchivoSilenciosamente_(driveFileId) {
  try { DriveApp.getFileById(driveFileId).setTrashed(true); }
  catch (err) { registrarIncidencia_('No se pudo limpiar un archivo huérfano en Drive', err); }
}

/* ==========================================================================
 * ACCIÓN: verifyCode — código de acceso opcional al álbum
 * ========================================================================== */
function verificarCodigoEvento_(cuerpo) {
  const codigoConfigurado = obtenerPropiedad_('EVENT_CODE', '');
  const codigoRecibido = String(cuerpo.code || '').trim();
  if (!codigoConfigurado) {
    throw new ErrorControlado_('FUNCION_NO_HABILITADA', 'El acceso con código no está habilitado.');
  }
  if (!codigoRecibido || codigoRecibido !== codigoConfigurado) {
    throw new ErrorControlado_('CODIGO_INVALIDO', 'El código ingresado no es válido.');
  }
  return { verified: true };
}

/* ==========================================================================
 * PANEL DE ADMINISTRACIÓN — solo para Héctor y Raquel
 * ========================================================================== */

/** Ver apps-script/README_SETUP.md para cómo definir la contraseña sin dejarla en el código. */
function adminLogin_(cuerpo) {
  const hashGuardado = obtenerPropiedad_('ADMIN_PASSWORD_HASH', '');
  if (!hashGuardado) {
    throw new ErrorControlado_('ADMIN_NO_CONFIGURADO', 'El panel todavía no tiene una contraseña configurada. Ejecuta configurarPasswordAdmin() en el editor de Apps Script.');
  }
  const intento = String(cuerpo.password || '');
  if (!intento || calcularHashSHA256_(intento) !== hashGuardado) {
    throw new ErrorControlado_('CREDENCIALES_INVALIDAS', 'Contraseña incorrecta.');
  }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(`admin_sesion_${token}`, 'valida', ADMIN_SESSION_TTL_SEGUNDOS);
  return { token, expiraEnSegundos: ADMIN_SESSION_TTL_SEGUNDOS };
}

function adminLogout_(cuerpo) {
  const token = String(cuerpo.token || '');
  if (token) CacheService.getScriptCache().remove(`admin_sesion_${token}`);
  return { cerrada: true };
}

/** Lanza un ErrorControlado_ si el token no corresponde a una sesión vigente. */
function verificarSesionAdmin_(token) {
  const limpio = String(token || '');
  if (!limpio || !CacheService.getScriptCache().get(`admin_sesion_${limpio}`)) {
    throw new ErrorControlado_('SESION_INVALIDA', 'Tu sesión expiró. Vuelve a iniciar sesión.');
  }
}

function adminListarTodas_(parametros) {
  verificarSesionAdmin_(parametros.token);
  const filtroEstado = String(parametros.status || 'todas');
  const filas = obtenerFilasConIndice_()
    .filter((fila) => filtroEstado === 'todas' || fila.status === filtroEstado)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    items: filas.map((fila) => ({
      id: fila.id,
      fileName: fila.fileName,
      viewUrl: fila.viewUrl,
      thumbUrl: fila.thumbUrl,
      category: fila.category,
      guestName: fila.guestName,
      dedication: fila.dedication,
      mimeType: fila.mimeType,
      sizeBytes: fila.sizeBytes,
      createdAt: fila.createdAt,
      status: fila.status,
    })),
    resumen: calcularResumenEstados_(),
  };
}

function calcularResumenEstados_() {
  const filas = obtenerFilasConIndice_();
  return {
    total: filas.length,
    publicada: filas.filter((f) => f.status === 'publicada').length,
    pendiente: filas.filter((f) => f.status === 'pendiente').length,
    oculta: filas.filter((f) => f.status === 'oculta').length,
  };
}

function adminModerar_(cuerpo) {
  verificarSesionAdmin_(cuerpo.token);
  const id = String(cuerpo.id || '');
  const nuevoEstado = String(cuerpo.status || '');
  if (!id) throw new ErrorControlado_('SOLICITUD_INVALIDA', 'Falta el identificador de la fotografía.');
  if (['publicada', 'oculta', 'pendiente'].indexOf(nuevoEstado) === -1) {
    throw new ErrorControlado_('SOLICITUD_INVALIDA', 'Estado no válido.');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new ErrorControlado_('SERVIDOR_OCUPADO', 'Intenta de nuevo en un momento.');
  try {
    const fila = obtenerFilasConIndice_().find((f) => f.id === id);
    if (!fila) throw new ErrorControlado_('NO_ENCONTRADO', 'Esa fotografía ya no existe.');
    const columnaEstado = ENCABEZADOS.indexOf('status') + 1;
    obtenerOCrearHoja_().getRange(fila._fila, columnaEstado).setValue(nuevoEstado);
    invalidarCachePublicadas_();
    return { id, status: nuevoEstado, resumen: calcularResumenEstados_() };
  } finally {
    lock.releaseLock();
  }
}

function adminEliminar_(cuerpo) {
  verificarSesionAdmin_(cuerpo.token);
  const id = String(cuerpo.id || '');
  if (!id) throw new ErrorControlado_('SOLICITUD_INVALIDA', 'Falta el identificador de la fotografía.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new ErrorControlado_('SERVIDOR_OCUPADO', 'Intenta de nuevo en un momento.');
  try {
    const fila = obtenerFilasConIndice_().find((f) => f.id === id);
    if (!fila) throw new ErrorControlado_('NO_ENCONTRADO', 'Esa fotografía ya no existe.');
    borrarArchivoSilenciosamente_(fila.driveFileId);
    obtenerOCrearHoja_().deleteRow(fila._fila);
    invalidarCachePublicadas_();
    return { id, eliminado: true, resumen: calcularResumenEstados_() };
  } finally {
    lock.releaseLock();
  }
}

function adminObtenerConfig_(parametros) {
  verificarSesionAdmin_(parametros.token);
  return { moderationEnabled: obtenerPropiedad_('MODERATION_ENABLED', 'false') === 'true' };
}

function adminActualizarConfig_(cuerpo) {
  verificarSesionAdmin_(cuerpo.token);
  if (typeof cuerpo.moderationEnabled !== 'boolean') {
    throw new ErrorControlado_('SOLICITUD_INVALIDA', 'Falta indicar si la moderación debe activarse o no.');
  }
  PropertiesService.getScriptProperties().setProperty('MODERATION_ENABLED', cuerpo.moderationEnabled ? 'true' : 'false');
  return { moderationEnabled: cuerpo.moderationEnabled };
}

/**
 * Genera un PDF único del álbum: arma una presentación de Slides con las
 * fotografías acomodadas en cuadrícula (como páginas de un álbum impreso,
 * con espacio blanco alrededor de cada foto), la exporta a PDF y guarda el
 * PDF en Drive. La presentación intermedia se borra al terminar — solo
 * queda el PDF.
 */
function adminGenerarDescarga_(cuerpo) {
  verificarSesionAdmin_(cuerpo.token);
  const filtro = String(cuerpo.filtro || 'publicada');
  const filas = obtenerFilasConIndice_()
    .filter((f) => filtro === 'todas' || f.status === filtro)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (!filas.length) throw new ErrorControlado_('SIN_FOTOGRAFIAS', 'No hay fotografías para el PDF con ese filtro.');

  const carpetaDescargas = obtenerOCrearCarpetaDescargas_();

  // Se usa el tamaño de página POR DEFECTO de una presentación nueva (no se
  // fuerza uno personalizado): así se evita depender de un método de la API
  // que puede no comportarse igual en todas las cuentas. La cuadrícula se
  // adapta al tamaño real que devuelva la presentación.
  let presentacion;
  try {
    presentacion = SlidesApp.create(`Álbum temporal ${Utilities.getUuid()}`);
  } catch (err) {
    registrarIncidencia_('No se pudo crear la presentación temporal para el PDF', err);
    throw new ErrorControlado_('ERROR_INTERNO', 'No se pudo iniciar la generación del PDF (paso: crear presentación). Revisa los registros de ejecución en Apps Script.');
  }

  try {
    const ANCHO_PT = presentacion.getPageWidth();
    const ALTO_PT = presentacion.getPageHeight();

    // La primera diapositiva (la que trae toda presentación nueva) se
    // reutiliza como portada, en vez de borrarla y crear una en blanco aparte.
    dibujarPortadaAlbum_(presentacion.getSlides()[0], ANCHO_PT, ALTO_PT, obtenerFotoPortada_());

    // Tamaños de grupo "deseados" que se van alternando para variar el ritmo
    // visual del álbum. Cada grupo se recorta con Math.min() al número de
    // fotografías que realmente quedan, así el ÚLTIMO grupo del álbum nunca
    // deja celdas vacías: si sobra 1 sola foto, esa va sola en su propia
    // página (plantilla de 1); si sobran 2, van juntas (plantilla de 2); etc.
    const TAMANOS_DESEADOS = [4, 6, 5, 3];

    let incluidas = 0;
    let indiceFoto = 0;
    let indiceTamano = 0;
    let numeroPagina = 1; // la portada es la página 1; la primera de fotos es la 2

    while (indiceFoto < filas.length) {
      let deseado = TAMANOS_DESEADOS[indiceTamano % TAMANOS_DESEADOS.length];
      indiceTamano += 1;

      // Una fotografía MUY panorámica o MUY alargada nunca encaja bien
      // compartiendo página con otras (recortarla se vería mal, y sin
      // recortar desperdiciaría casi toda su celda) — es más inteligente
      // darle su propia página, como haría alguien maquetando el álbum a mano.
      if (esFormatoExtremo_(filas[indiceFoto])) deseado = 1;

      const objetivo = Math.min(deseado, filas.length - indiceFoto);

      // Se reúnen fotos válidas hasta completar el objetivo (o hasta quedarse
      // sin fotos por leer). indiceFoto siempre avanza en cada vuelta interna,
      // así que el ciclo externo termina como máximo tras filas.length vueltas.
      const grupo = [];
      while (grupo.length < objetivo && indiceFoto < filas.length) {
        const fila = filas[indiceFoto];
        indiceFoto += 1;
        try {
          const blob = DriveApp.getFileById(fila.driveFileId).getBlob();
          grupo.push({ fila, blob });
        } catch (err) {
          registrarIncidencia_(`No se pudo leer "${fila.fileName}" de Drive para el PDF`, err);
        }
      }

      if (!grupo.length) continue; // todas las lecturas de este intento fallaron

      let paginaActual;
      try {
        paginaActual = presentacion.appendSlide(SlidesApp.PredefinedLayout.BLANK);
        paginaActual.getBackground().setSolidFill('#FFFFFF');
      } catch (err) {
        registrarIncidencia_('No se pudo agregar una página a la presentación', err);
        throw new ErrorControlado_('ERROR_INTERNO', 'No se pudo generar el PDF (paso: crear páginas). Revisa los registros de ejecución en Apps Script.');
      }

      // La plantilla se elige según CUÁNTAS fotos quedaron disponibles de
      // verdad (grupo.length, que puede ser menor al objetivo si algo falló
      // al leerse de Drive) y probando qué variante de plantilla desperdicia
      // menos espacio para la forma real de esas fotos (ver elegirCeldas_).
      // `orden` puede reacomodar QUÉ foto va en la celda protagonista (ver
      // elegirMejorDistribucionConRotacion_) — antes la celda grande siempre
      // se llevaba la primera foto del grupo, sin importar si su forma le
      // quedaba bien ahí.
      const { celdas, orden } = elegirCeldas_(grupo.length, grupo, ANCHO_PT, ALTO_PT);
      const grupoOrdenado = orden.map((i) => grupo[i]);
      grupoOrdenado.forEach((item, i) => {
        const celda = celdas[i];
        if (!celda) return; // por seguridad, nunca debería faltar
        try {
          insertarFotoConDedicatoria_(paginaActual, item, celda, ANCHO_PT, ALTO_PT);
          incluidas += 1;
        } catch (err) {
          registrarIncidencia_(`No se pudo insertar "${item.fila.fileName}" en el PDF`, err);
        }
      });

      numeroPagina += 1;
      dibujarPieDePagina_(paginaActual, ANCHO_PT, ALTO_PT, numeroPagina);
    }

    if (incluidas === 0) {
      throw new ErrorControlado_('SIN_FOTOGRAFIAS', 'No se pudo insertar ninguna fotografía en el PDF.');
    }

    let respuesta;
    try {
      presentacion.saveAndClose();
      const tokenOAuth = ScriptApp.getOAuthToken();
      const urlExportacion = `https://docs.google.com/presentation/d/${presentacion.getId()}/export/pdf`;
      respuesta = UrlFetchApp.fetch(urlExportacion, {
        headers: { Authorization: `Bearer ${tokenOAuth}` },
        muteHttpExceptions: true,
      });
    } catch (err) {
      registrarIncidencia_('No se pudo exportar la presentación a PDF (UrlFetchApp)', err);
      throw new ErrorControlado_('ERROR_INTERNO', 'No se pudo generar el PDF (paso: exportar a PDF). Revisa los registros de ejecución en Apps Script.');
    }

    if (respuesta.getResponseCode() !== 200) {
      registrarIncidencia_('La exportación a PDF respondió con error', new Error(`HTTP ${respuesta.getResponseCode()}: ${respuesta.getContentText().slice(0, 300)}`));
      throw new ErrorControlado_('ERROR_INTERNO', `No se pudo generar el PDF (exportación respondió ${respuesta.getResponseCode()}). Revisa los registros de ejecución en Apps Script.`);
    }

    let archivoPdf;
    try {
      const marcaTiempo = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT', 'yyyyMMdd_HHmm');
      const pdfBlob = respuesta.getBlob().setName(`album-hector-y-raquel-${marcaTiempo}.pdf`);
      archivoPdf = carpetaDescargas.createFile(pdfBlob);
      archivoPdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
      registrarIncidencia_('No se pudo guardar el PDF exportado en Drive', err);
      throw new ErrorControlado_('ERROR_INTERNO', 'No se pudo guardar el PDF en Drive (paso: guardar archivo). Revisa los registros de ejecución en Apps Script.');
    }

    // El PDF anterior solo se borra DESPUÉS de crear el nuevo con éxito: si algo
    // falla arriba, siempre queda al menos un archivo descargable en la carpeta.
    try {
      const anteriores = carpetaDescargas.getFiles();
      while (anteriores.hasNext()) {
        const archivo = anteriores.next();
        if (archivo.getId() !== archivoPdf.getId()) archivo.setTrashed(true);
      }
    } catch (err) {
      registrarIncidencia_('No se pudieron limpiar los PDF anteriores (no es crítico)', err);
    }

    return {
      url: `https://drive.google.com/uc?export=download&id=${archivoPdf.getId()}`,
      cantidad: incluidas,
      solicitadas: filas.length,
      generadoEn: new Date().toISOString(),
    };
  } finally {
    // La presentación de Slides fue solo un paso intermedio: se borra siempre,
    // haya salido bien o mal el resto del proceso.
    try { DriveApp.getFileById(presentacion.getId()).setTrashed(true); } catch (err) { /* ya no existía */ }
  }
}

/** Calcula el tamaño (ancho/alto) para encajar una imagen dentro de una celda sin estirarla ni recortarla. */
function calcularEncajado_(anchoOriginal, altoOriginal, anchoCelda, altoCelda) {
  const ao = Number(anchoOriginal) || 0;
  const alo = Number(altoOriginal) || 0;
  if (!ao || !alo) return { w: anchoCelda, h: altoCelda };
  const escala = Math.min(anchoCelda / ao, altoCelda / alo);
  return { w: ao * escala, h: alo * escala };
}

/**
 * El límite de recorte tolerado depende de si la foto y la celda comparten
 * orientación general (ambas horizontales o ambas verticales) o no — pero
 * incluso en el caso "normal" (misma orientación) se comprobó que un
 * recorte que suena moderado en porcentaje (30%+) se ve francamente mal en
 * una composición simétrica (un logo circular, por ejemplo). Por eso ambos
 * valores son deliberadamente bajos: se prioriza que NINGUNA foto se vea
 * mal recortada, aunque eso signifique que el modo "a página completa" se
 * use con menos frecuencia de la que se usaría con un límite más permisivo.
 */
const RECORTE_MAXIMO_MISMA_ORIENTACION = 0.1;
const RECORTE_MAXIMO_ORIENTACION_CRUZADA = 0.04;

/** ¿La foto y la celda comparten orientación general (ambas horizontales o ambas verticales)? */
function orientacionCoincide_(anchoOriginal, altoOriginal, celda) {
  const fotoHorizontal = anchoOriginal >= altoOriginal;
  const celdaHorizontal = celda.w >= celda.h;
  return fotoHorizontal === celdaHorizontal;
}

/** Límite de recorte aplicable a esta combinación específica de foto + celda (ver comentario arriba). */
function limiteRecorte_(anchoOriginal, altoOriginal, celda) {
  return orientacionCoincide_(anchoOriginal, altoOriginal, celda)
    ? RECORTE_MAXIMO_MISMA_ORIENTACION
    : RECORTE_MAXIMO_ORIENTACION_CRUZADA;
}

/**
 * ¿Esta foto va a LLENAR por completo su celda (modo "cover"), o se va a
 * encajar completa dejando espacio alrededor (modo "contain")? Usa
 * exactamente el mismo cálculo que insertarFotoEnCelda_, para que la
 * decisión de "adónde poner la dedicatoria" (debajo vs. superpuesta) sea
 * siempre consistente con lo que realmente se dibuja.
 */
function sePuedeLlenarCelda_(fila, celda) {
  const ancho = Number(fila.width) || 0;
  const alto = Number(fila.height) || 0;
  if (!ancho || !alto) return false;
  const escalaCover = Math.max(celda.w / ancho, celda.h / alto);
  const anchoCover = ancho * escalaCover;
  const altoCover = alto * escalaCover;
  const fraccionRecorte = Math.max(1 - celda.w / anchoCover, 1 - celda.h / altoCover);
  return fraccionRecorte <= limiteRecorte_(ancho, alto, celda);
}

/**
 * Inserta una fotografía LLENANDO por completo una celda {x,y,w,h}, como en
 * un álbum impreso de verdad (sin franjas blancas alrededor de cada foto),
 * PERO solo cuando la proporción de la foto encaja razonablemente con la de
 * la celda. La imagen se escala en modo "cover" (el eje que sobra se
 * recorta); como SlidesApp no tiene un recorte real disponible sin el
 * servicio avanzado de Slides, el sobrante se tapa con uno o dos rectángulos
 * del color de fondo de la página — el resultado visual es idéntico a un
 * recorte real. Si el recorte necesario sería demasiado agresivo, se cae a
 * encajar la foto completa (sin recortar) para no arruinar la composición.
 */
function insertarFotoEnCelda_(pagina, blob, fila, celda, colorFondo) {
  const anchoOriginal = Number(fila.width) || 0;
  const altoOriginal = Number(fila.height) || 0;
  const fondo = colorFondo || '#FFFFFF';

  const insertarEncajada = () => {
    const encajado = calcularEncajado_(anchoOriginal, altoOriginal, celda.w, celda.h);
    const w = Math.max(1, encajado.w);
    const h = Math.max(1, encajado.h);
    const x = celda.x + (celda.w - w) / 2;
    const y = celda.y + (celda.h - h) / 2;
    pagina.insertImage(blob, x, y, w, h);
    return { x, y, w, h };
  };

  if (!anchoOriginal || !altoOriginal) {
    return insertarEncajada();
  }

  const escalaCover = Math.max(celda.w / anchoOriginal, celda.h / altoOriginal);
  const anchoCover = anchoOriginal * escalaCover;
  const altoCover = altoOriginal * escalaCover;
  const fraccionRecorte = Math.max(1 - celda.w / anchoCover, 1 - celda.h / altoCover);
  if (fraccionRecorte > limiteRecorte_(anchoOriginal, altoOriginal, celda)) {
    return insertarEncajada();
  }

  const escala = escalaCover;
  const anchoImg = anchoOriginal * escala;
  const altoImg = altoOriginal * escala;
  const x = celda.x - (anchoImg - celda.w) / 2;
  const y = celda.y - (altoImg - celda.h) / 2;
  pagina.insertImage(blob, x, y, anchoImg, altoImg);

  const sobranteX = anchoImg - celda.w;
  const sobranteY = altoImg - celda.h;
  if (sobranteX > 0.5) {
    const anchoFranja = sobranteX / 2;
    dibujarFranjaOculta_(pagina, x, celda.y, anchoFranja, celda.h, fondo);
    dibujarFranjaOculta_(pagina, celda.x + celda.w, celda.y, anchoFranja, celda.h, fondo);
  } else if (sobranteY > 0.5) {
    const altoFranja = sobranteY / 2;
    dibujarFranjaOculta_(pagina, celda.x, y, celda.w, altoFranja, fondo);
    dibujarFranjaOculta_(pagina, celda.x, celda.y + celda.h, celda.w, altoFranja, fondo);
  }

  // La foto llenó la celda por completo: el marco/leyenda usan la celda tal cual.
  return celda;
}

/** Rectángulo del color de fondo que "tapa" el sobrante de una foto en modo cover (recorte falso). */
function dibujarFranjaOculta_(pagina, x, y, w, h, colorFondo) {
  if (w <= 0.5 || h <= 0.5) return;
  const franja = pagina.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, w, h);
  franja.getFill().setSolidFill(colorFondo);
  franja.getBorder().setTransparent();
}

/* ---------- Plantillas de página: cada una devuelve un arreglo de celdas {x,y,w,h} ---------- */

/**
 * Márgenes compartidos por todas las plantillas de página. El margen
 * inferior es más grande que el superior a propósito: deja aire para el
 * pie de página (monograma "H & R" + línea dorada) que se dibuja en TODAS
 * las páginas de fotos, no solo en la portada.
 */
function margenesPagina_(ANCHO, ALTO) {
  return {
    // Aire alrededor de todo el contenido, como el margen de un álbum
    // impreso de verdad (sin marco ni esquinas decorativas — minimalista).
    x: ANCHO * 0.034,
    ySup: ALTO * 0.05,
    // 0.085 dejaba el borde inferior del contenido en 0.915*ALTO, MÁS ABAJO
    // de donde empieza el pie de página (0.9*ALTO) — el texto de la
    // dedicatoria podía terminar encimado con la línea y el monograma del
    // pie. Con 0.115 el contenido termina en 0.885*ALTO, con aire real antes
    // del pie de página.
    yInf: ALTO * 0.115,
    hueco: ANCHO * 0.012,
    huecoChico: ANCHO * 0.012,
    huecoY: ALTO * 0.016,
  };
}

/**
 * ¿La fotografía tiene una proporción MUY panorámica o MUY alargada (más de
 * ~1.9:1 en cualquier eje)? Esas fotos nunca encajan bien compartiendo
 * página con otras — se les da su propia página en vez de forzarlas en una
 * cuadrícula pensada para proporciones normales.
 */
function esFormatoExtremo_(fila) {
  if (!fila) return false;
  const ancho = Number(fila.width) || 0;
  const alto = Number(fila.height) || 0;
  if (!ancho || !alto) return false;
  return Math.max(ancho / alto, alto / ancho) >= 1.9;
}

/**
 * Mide qué tan bien encajaría una foto en una celda concreta, sin recortarla
 * (0 = no aprovecha nada del espacio, 1 = la llena por completo). Se usa
 * para elegir ENTRE VARIAS plantillas posibles cuál desperdicia menos
 * espacio en blanco para las fotos reales del grupo, en vez de adivinar
 * solo por si son "horizontales" o "verticales".
 */
function eficienciaCelda_(fila, celda) {
  const ancho = Number(fila.width) || 0;
  const alto = Number(fila.height) || 0;
  if (!ancho || !alto || !celda) return 0.7; // valor neutro si falta información

  const escalaCover = Math.max(celda.w / ancho, celda.h / alto);
  const anchoCover = ancho * escalaCover;
  const altoCover = alto * escalaCover;
  const fraccionRecorte = Math.max(1 - celda.w / anchoCover, 1 - celda.h / altoCover);
  if (fraccionRecorte <= limiteRecorte_(ancho, alto, celda)) return 1; // se puede llenar sin recorte feo

  const escalaContain = Math.min(celda.w / ancho, celda.h / alto);
  const areaImagen = (ancho * escalaContain) * (alto * escalaContain);
  const areaCelda = celda.w * celda.h;
  return areaCelda ? areaImagen / areaCelda : 0.7;
}

/**
 * Plantillas de 1 foto: antes había una sola celda de forma fija (casi
 * cuadrada), que no le sentaba bien ni a fotos muy verticales ni a fotos muy
 * horizontales. Ahora hay dos variantes — una angosta y alta (para retratos)
 * y una ancha y baja (para panorámicas) — y `elegirMejorDistribucion_` se
 * queda con la que de verdad aprovecha mejor la foto de este grupo, igual
 * que ya se hace para 2, 3, 4, 5 y 6 fotos.
 */
function celdasUnaVertical_(ANCHO, ALTO) {
  const m = margenesPagina_(ANCHO, ALTO);
  const margenExtra = ANCHO * 0.12;
  return [{
    x: m.x + margenExtra,
    y: m.ySup,
    w: ANCHO - (m.x + margenExtra) * 2,
    h: ALTO - m.ySup - m.yInf,
  }];
}

function celdasUnaHorizontal_(ANCHO, ALTO) {
  const m = margenesPagina_(ANCHO, ALTO);
  const alturaDisponible = ALTO - m.ySup - m.yInf;
  const margenExtra = alturaDisponible * 0.12;
  return [{
    x: m.x,
    y: m.ySup + margenExtra,
    w: ANCHO - m.x * 2,
    h: alturaDisponible - margenExtra * 2,
  }];
}

/**
 * Reparte el espacio disponible entre 2 fotos de forma PROPORCIONAL a la
 * forma natural de cada una, en vez de partir siempre 50/50. Por ejemplo, si
 * una foto es mucho más panorámica que la otra, esa recibe menos del ancho o
 * alto disponible — así ninguna de las dos necesita recortarse tanto para
 * llenar su celda. Se deja un mínimo de 32% para cada foto para que ninguna
 * quede demasiado angosta. `medida(fila)` calcula el tamaño "natural" de esa
 * foto en el eje que se está repartiendo (alto si se apilan, ancho si van
 * lado a lado).
 */
function proporcionesRelativas_(grupo, medida) {
  const tamanos = grupo.map((item) => Math.max(1, medida(item.fila)));
  const total = tamanos[0] + tamanos[1];
  // Un mínimo bajo, solo para evitar el caso extremo de una celda casi en 0
  // — NO para "equilibrar" el reparto. Un mínimo alto (antes 0.32) distorsiona
  // el reparto real: si una foto necesita mucho menos espacio que la otra,
  // forzarle una celda más ancha de la que necesita hace que se vea
  // "flotando" con mucho blanco alrededor mientras la otra llena la suya —
  // dos fotos con presencia visual muy distinta en la misma página.
  const MIN = 0.14;
  let p0 = total ? tamanos[0] / total : 0.5;
  p0 = Math.min(1 - MIN, Math.max(MIN, p0));
  return [p0, 1 - p0];
}

/** Plantilla de 2 fotos, lado a lado (mejor para fotografías verticales/retrato). */
function celdasDosLadoALado_(ANCHO, ALTO, grupo) {
  const m = margenesPagina_(ANCHO, ALTO);
  const anchoUtil = ANCHO - m.x * 2 - m.hueco;
  const altoUtil = ALTO - m.ySup - m.yInf;
  const proporciones = proporcionesRelativas_(grupo, (fila) => altoUtil * ((Number(fila.width) || 1) / (Number(fila.height) || 1)));
  const cw0 = anchoUtil * proporciones[0];
  const cw1 = anchoUtil * proporciones[1];
  return [
    { x: m.x, y: m.ySup, w: cw0, h: altoUtil },
    { x: m.x + cw0 + m.hueco, y: m.ySup, w: cw1, h: altoUtil },
  ];
}

/** Plantilla de 2 fotos, apiladas (mejor para fotografías horizontales/panorámicas). */
function celdasDosApiladas_(ANCHO, ALTO, grupo) {
  const m = margenesPagina_(ANCHO, ALTO);
  const anchoUtil = ANCHO - m.x * 2;
  const altoUtil = ALTO - m.ySup - m.yInf - m.huecoY;
  const proporciones = proporcionesRelativas_(grupo, (fila) => anchoUtil * ((Number(fila.height) || 1) / (Number(fila.width) || 1)));
  const ch0 = altoUtil * proporciones[0];
  const ch1 = altoUtil * proporciones[1];
  return [
    { x: m.x, y: m.ySup, w: anchoUtil, h: ch0 },
    { x: m.x, y: m.ySup + ch0 + m.huecoY, w: anchoUtil, h: ch1 },
  ];
}

/** Cuadrícula uniforme de `columnas` x `filas` (usada para 4 y para 6 fotos). */
function celdasCuadricula_(ANCHO, ALTO, columnas, filas) {
  const m = margenesPagina_(ANCHO, ALTO);
  const anchoUtil = ANCHO - m.x * 2 - m.huecoChico * (columnas - 1);
  const altoUtil = ALTO - m.ySup - m.yInf - m.huecoY * (filas - 1);
  const cw = anchoUtil / columnas;
  const ch = altoUtil / filas;
  const celdas = [];
  for (let f = 0; f < filas; f += 1) {
    for (let c = 0; c < columnas; c += 1) {
      celdas.push({ x: m.x + c * (cw + m.huecoChico), y: m.ySup + f * (ch + m.huecoY), w: cw, h: ch });
    }
  }
  return celdas;
}

/** Plantilla de 3 fotos, variante para foto principal VERTICAL: grande a la izquierda + dos apiladas a la derecha. */
function celdasUnaGrandeIzquierdaMasDos_(ANCHO, ALTO) {
  const m = margenesPagina_(ANCHO, ALTO);
  const anchoUtil = ANCHO - m.x * 2 - m.hueco;
  const altoUtil = ALTO - m.ySup - m.yInf;
  const anchoGrande = anchoUtil * 0.6;
  const anchoChico = anchoUtil - anchoGrande;
  const rightX = m.x + anchoGrande + m.hueco;
  const chH = (altoUtil - m.huecoY) / 2;
  return [
    { x: m.x, y: m.ySup, w: anchoGrande, h: altoUtil },
    { x: rightX, y: m.ySup, w: anchoChico, h: chH },
    { x: rightX, y: m.ySup + chH + m.huecoY, w: anchoChico, h: chH },
  ];
}

/** Plantilla de 3 fotos, variante para foto principal HORIZONTAL: grande arriba + dos lado a lado abajo. */
function celdasUnaGrandeArribaMasDos_(ANCHO, ALTO) {
  const m = margenesPagina_(ANCHO, ALTO);
  const anchoUtil = ANCHO - m.x * 2;
  const altoUtil = ALTO - m.ySup - m.yInf - m.huecoY;
  const altoGrande = altoUtil * 0.58;
  const altoChico = altoUtil - altoGrande;
  const abajoY = m.ySup + altoGrande + m.huecoY;
  const cw = (anchoUtil - m.hueco) / 2;
  return [
    { x: m.x, y: m.ySup, w: anchoUtil, h: altoGrande },
    { x: m.x, y: abajoY, w: cw, h: altoChico },
    { x: m.x + cw + m.hueco, y: abajoY, w: cw, h: altoChico },
  ];
}

/** Plantilla de 5 fotos: una grande a la izquierda + una cuadrícula 2x2 a la derecha. */
function celdasUnaGrandeMasCuatro_(ANCHO, ALTO) {
  const m = margenesPagina_(ANCHO, ALTO);
  const anchoUtil = ANCHO - m.x * 2 - m.hueco;
  const altoUtil = ALTO - m.ySup - m.yInf;
  const anchoGrande = anchoUtil * 0.54;
  const anchoChico = anchoUtil - anchoGrande;
  const rightX = m.x + anchoGrande + m.hueco;
  const cw2 = (anchoChico - m.huecoChico) / 2;
  const ch2 = (altoUtil - m.huecoY) / 2;

  const celdas = [{ x: m.x, y: m.ySup, w: anchoGrande, h: altoUtil }];
  for (let f = 0; f < 2; f += 1) {
    for (let c = 0; c < 2; c += 1) {
      celdas.push({ x: rightX + c * (cw2 + m.huecoChico), y: m.ySup + f * (ch2 + m.huecoY), w: cw2, h: ch2 });
    }
  }
  return celdas;
}

/** Plantilla de 5 fotos, variante para foto principal HORIZONTAL: grande arriba + cuadrícula 2x2 abajo. */
function celdasUnaGrandeArribaMasCuatro_(ANCHO, ALTO) {
  const m = margenesPagina_(ANCHO, ALTO);
  const anchoUtil = ANCHO - m.x * 2;
  const altoUtil = ALTO - m.ySup - m.yInf - m.huecoY;
  const altoGrande = altoUtil * 0.5;
  const altoChico = altoUtil - altoGrande;
  const abajoY = m.ySup + altoGrande + m.huecoY;
  const cw = (anchoUtil - m.huecoChico) / 2;
  const ch2 = (altoChico - m.huecoY) / 2;

  const celdas = [{ x: m.x, y: m.ySup, w: anchoUtil, h: altoGrande }];
  for (let f = 0; f < 2; f += 1) {
    for (let c = 0; c < 2; c += 1) {
      celdas.push({ x: m.x + c * (cw + m.huecoChico), y: abajoY + f * (ch2 + m.huecoY), w: cw, h: ch2 });
    }
  }
  return celdas;
}

/**
 * Suma cuánto aprovecha cada foto real del grupo el espacio de su celda en
 * una distribución candidata (ver `eficienciaCelda_`). Cuanto más alto, menos
 * espacio en blanco desperdiciado y menos recorte agresivo hizo falta.
 */
function puntuarCeldas_(celdas, grupo) {
  return grupo.reduce((acc, item, i) => acc + eficienciaCelda_(item.fila, celdas[i]), 0);
}

/**
 * De una lista de distribuciones candidatas (cada una, una función que arma
 * su arreglo de celdas), devuelve la que mejor puntaje obtiene para las
 * fotos reales de este grupo — esto es lo que hace que la elección sea
 * "inteligente": no se adivina la forma por una regla fija, se PRUEBAN las
 * alternativas y se mide cuál desperdicia menos espacio de verdad.
 */
function elegirMejorDistribucion_(candidatos, grupo) {
  let mejorCeldas = null;
  let mejorPuntaje = -Infinity;
  candidatos.forEach((generar) => {
    const celdas = generar();
    const puntaje = puntuarCeldas_(celdas, grupo);
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejorCeldas = celdas;
    }
  });
  return { celdas: mejorCeldas, orden: grupo.map((_, i) => i) };
}

/** Todas las rotaciones posibles de los índices [0..n-1] (n rotaciones, no n! permutaciones). */
function rotacionesIndices_(n) {
  const rotaciones = [];
  for (let r = 0; r < n; r++) {
    const orden = [];
    for (let i = 0; i < n; i++) orden.push((i + r) % n);
    rotaciones.push(orden);
  }
  return rotaciones;
}

/**
 * Igual que `elegirMejorDistribucion_`, pero para plantillas con una celda
 * "protagonista" claramente distinta de las demás (una grande + varias
 * chicas). Antes la foto protagonista era SIEMPRE la primera del grupo, sin
 * importar si su forma encajaba bien ahí — una foto vertical podía terminar
 * forzada en una celda pensada para horizontal (o viceversa) mientras una
 * foto que sí encajaba perfecto se quedaba en una celda chica. Probando las
 * `n` rotaciones del grupo (cuál foto queda "primera") se elige, de las
 * fotos reales de esta página, cuál le sienta mejor a la celda grande.
 */
function elegirMejorDistribucionConRotacion_(candidatos, grupo) {
  let mejorCeldas = null;
  let mejorOrden = null;
  let mejorPuntaje = -Infinity;
  const rotaciones = rotacionesIndices_(grupo.length);
  candidatos.forEach((generar) => {
    const celdas = generar();
    rotaciones.forEach((orden) => {
      const grupoOrdenado = orden.map((i) => grupo[i]);
      const puntaje = puntuarCeldas_(celdas, grupoOrdenado);
      if (puntaje > mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejorCeldas = celdas;
        mejorOrden = orden;
      }
    });
  });
  return { celdas: mejorCeldas, orden: mejorOrden };
}

/**
 * Elige la plantilla más adecuada según cuántas fotos hay en el grupo.
 * Para cada tamaño se arman TODAS las variantes de plantilla razonables y se
 * usa `elegirMejorDistribucion_` para quedarse con la que mejor aprovecha el
 * espacio para las fotos reales de este grupo — así, por ejemplo, cuatro
 * fotos panorámicas terminan en una fila de celdas anchas y bajas en vez de
 * en una cuadrícula 2x2 cuadrada donde se recortarían mucho más.
 */
function elegirCeldas_(cantidad, grupo, ANCHO, ALTO) {
  switch (cantidad) {
    case 1:
      return elegirMejorDistribucion_([
        () => celdasUnaVertical_(ANCHO, ALTO),
        () => celdasUnaHorizontal_(ANCHO, ALTO),
      ], grupo);
    case 2:
      return elegirMejorDistribucion_([
        () => celdasDosApiladas_(ANCHO, ALTO, grupo),
        () => celdasDosLadoALado_(ANCHO, ALTO, grupo),
      ], grupo);
    case 3:
      return elegirMejorDistribucionConRotacion_([
        () => celdasUnaGrandeArribaMasDos_(ANCHO, ALTO),
        () => celdasUnaGrandeIzquierdaMasDos_(ANCHO, ALTO),
      ], grupo);
    case 4:
      return elegirMejorDistribucion_([
        () => celdasCuadricula_(ANCHO, ALTO, 2, 2),
        () => celdasCuadricula_(ANCHO, ALTO, 1, 4),
        () => celdasCuadricula_(ANCHO, ALTO, 4, 1),
      ], grupo);
    case 5:
      return elegirMejorDistribucionConRotacion_([
        () => celdasUnaGrandeMasCuatro_(ANCHO, ALTO),
        () => celdasUnaGrandeArribaMasCuatro_(ANCHO, ALTO),
      ], grupo);
    case 6:
      return elegirMejorDistribucion_([
        () => celdasCuadricula_(ANCHO, ALTO, 3, 2),
        () => celdasCuadricula_(ANCHO, ALTO, 2, 3),
        () => celdasCuadricula_(ANCHO, ALTO, 1, 6),
        () => celdasCuadricula_(ANCHO, ALTO, 6, 1),
      ], grupo);
    default:
      // No debería alcanzarse (los grupos nunca superan 6), pero se deja una
      // cuadrícula genérica de respaldo por seguridad.
      return { celdas: celdasCuadricula_(ANCHO, ALTO, 2, Math.ceil(cantidad / 2)), orden: grupo.map((_, i) => i) };
  }
}

/**
 * Pie de página discreto que se dibuja en TODAS las páginas de fotos: una
 * línea dorada fina y el monograma "H & R" en itálica, para que el álbum se
 * sienta diseñado de principio a fin y no solo en la portada. Si algo
 * falla, se ignora silenciosamente: es un detalle decorativo, no debe
 * arruinar la generación del PDF.
 */
function dibujarPieDePagina_(pagina, ANCHO, ALTO, numeroPagina) {
  try {
    const cx = ANCHO / 2;
    const lineaY = ALTO * 0.9;
    const linea = pagina.insertShape(SlidesApp.ShapeType.RECTANGLE, cx - ANCHO * 0.035, lineaY, ANCHO * 0.07, 0.6);
    linea.getFill().setSolidFill('#6B5D50');
    linea.getBorder().setTransparent();

    // Misma tipografía y color que el monograma "H & R" de la portada
    // (Georgia, sin cursiva, carbón), solo que a un tamaño de pie de página.
    const monograma = pagina.insertTextBox('H & R', cx - ANCHO * 0.08, lineaY + ALTO * 0.014, ANCHO * 0.16, ALTO * 0.05);
    const estilo = monograma.getText().getTextStyle();
    estilo.setFontFamily('Georgia').setFontSize(Math.round(ALTO * 0.022)).setForegroundColor('#2E2A26');
    monograma.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

    // Numeración discreta — el detalle que hace que se sienta un libro
    // editado de verdad y no solo hojas sueltas con fotos. Va abajo, en la
    // esquina derecha, a la misma altura que el monograma pero bien separada
    // de él (y de la línea central) para que nunca se sientan amontonados.
    if (numeroPagina) {
      const anchoNum = ANCHO * 0.05;
      const num = pagina.insertTextBox(String(numeroPagina), ANCHO - ANCHO * 0.06 - anchoNum, lineaY + ALTO * 0.018, anchoNum, ALTO * 0.03);
      const estiloNum = num.getText().getTextStyle();
      estiloNum.setFontFamily('Georgia').setFontSize(Math.round(ALTO * 0.021)).setForegroundColor('#8C7C6E');
      num.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    }
  } catch (err) {
    registrarIncidencia_('No se pudo dibujar el pie de página decorativo del PDF (no es crítico)', err);
  }
}

/** Recorta un texto a `maxCaracteres`, agregando "…" si hizo falta cortar. */
function truncarTexto_(texto, maxCaracteres) {
  const limpio = String(texto || '').trim();
  if (limpio.length <= maxCaracteres) return limpio;
  return `${limpio.slice(0, maxCaracteres - 1).trim()}…`;
}

/**
 * Simula letter-spacing en mayúsculas insertando espacios entre caracteres
 * (SlidesApp no tiene una propiedad real de espaciado entre letras). Se usa
 * para nombres de invitados y textos cortos — no para párrafos largos,
 * donde se vería raro.
 */
function espaciarLetras_(texto) {
  return String(texto || '').trim().toUpperCase().split('').join(' ');
}

/**
 * Inserta una fotografía en su celda y, si tiene dedicatoria, la acomoda
 * junto a la foto en el lugar que mejor le quede SEGÚN EL TAMAÑO de esa
 * celda (que depende de en qué plantilla y posición cayó la foto):
 *   - Celdas grandes (una foto sola, o la foto "protagonista" de una
 *     plantilla con 3 o 5) tienen aire de sobra: la dedicatoria va DEBAJO de
 *     la imagen, con el nombre del invitado.
 *   - Celdas chicas (las de una cuadrícula de 4 o 6) no tienen espacio para
 *     eso sin achicar demasiado la foto: la dedicatoria se muestra sobre una
 *     franja translúcida en el propio borde inferior de la foto, como una
 *     leyenda de revista.
 * Si no hay dedicatoria, la foto ocupa toda la celda como antes.
 */
function insertarFotoConDedicatoria_(pagina, item, celda, ANCHO, ALTO) {
  const dedicatoria = String(item.fila.dedication || '').trim();
  if (!dedicatoria) {
    insertarFotoEnCelda_(pagina, item.blob, item.fila, celda, '#FFFFFF');
    return;
  }

  // La leyenda SUPERPUESTA (sobre el propio borde de la foto) solo tiene
  // sentido cuando la foto de verdad LLENA su celda (modo "cover"). Si la
  // foto se va a encajar completa sin recortar (modo "contain", por ejemplo
  // un logo casi cuadrado en una celda angosta), ya queda espacio en blanco
  // alrededor — poner ahí encima una franja oscura translúcida se ve como
  // una caja flotando sobre la nada. En ese caso la leyenda SIEMPRE va
  // debajo, igual que con una celda grande.
  const llenaLaCelda = sePuedeLlenarCelda_(item.fila, celda);
  const esCeldaGrande = (celda.w * celda.h) >= (ANCHO * ALTO * 0.28);
  if (!llenaLaCelda || esCeldaGrande) {
    // Antes se reservaba hasta 0.115*ALTO para la dedicatoria: mucho más de
    // lo que una cita corta + un nombre necesitan, y esa foto perdía
    // tamaño para nada. Ahora se reserva bastante menos, y le devuelve ese
    // espacio a la foto.
    const altoLeyenda = Math.min(celda.h * 0.18, ALTO * 0.075);
    const celdaFoto = { x: celda.x, y: celda.y, w: celda.w, h: celda.h - altoLeyenda };
    // bounds = el tamaño REAL con el que se dibujó la foto — si se encajó
    // completa (contain), puede ser bastante más chico que celdaFoto. La
    // leyenda usa bounds, no celdaFoto, para que se vea pegada a la foto de
    // verdad y no flotando en una caja de sobra.
    const bounds = insertarFotoEnCelda_(pagina, item.blob, item.fila, celdaFoto, '#FFFFFF');
    dibujarLeyendaDebajo_(pagina, item.fila, celda, bounds, ALTO);
  } else {
    insertarFotoEnCelda_(pagina, item.blob, item.fila, celda, '#FFFFFF');
    dibujarLeyendaSuperpuesta_(pagina, item.fila, celda, ALTO);
  }
}

/** Dedicatoria debajo de la foto, para celdas con espacio de sobra. */
function dibujarLeyendaDebajo_(pagina, fila, celdaOriginal, celdaFoto, ALTO) {
  try {
    const inicioY = celdaFoto.y + celdaFoto.h + ALTO * 0.016;
    const finY = celdaOriginal.y + celdaOriginal.h;
    if (finY - inicioY < ALTO * 0.03) return; // no hay espacio real: mejor omitir que amontonar texto

    const texto = truncarTexto_(fila.dedication, 105);
    // En vez de una raya separando la cita del nombre (se veía como un
    // renglón cruzando el texto, y a veces tapaba el nombre), se usa un
    // guion largo delante del nombre — el mismo recurso tipográfico de una
    // atribución de cita, sin dibujar ninguna forma extra.
    const nombre = `—  ${espaciarLetras_(String(fila.guestName || '').trim() || 'Un invitado')}`;

    const tamFontTexto = Math.round(ALTO * 0.024);
    const tamFontNombre = Math.round(ALTO * 0.017);

    // El cuadro de la cita se calcula según cuántas líneas va a necesitar
    // de verdad (estimado por su longitud y el ancho disponible), NO según
    // todo el espacio que sobra debajo de la foto. Antes ese cuadro ocupaba
    // siempre el sobrante completo y, como el texto se ancla arriba, una
    // cita corta como "TQM" dejaba un hueco enorme antes del nombre.
    const alturaDisponible = finY - inicioY;
    // Un poco de aire entre la cita y el nombre — antes quedaban casi
    // pegados, y con la raya ya quitada hacía falta ese respiro para que se
    // lean como dos líneas distintas, no una encima de la otra.
    const espacio = Math.min(ALTO * 0.042, alturaDisponible * 0.3);
    const anchoPromedioChar = tamFontTexto * 0.52;
    const charsPorLinea = Math.max(10, Math.floor(celdaOriginal.w / anchoPromedioChar));
    const lineasTexto = Math.min(3, Math.max(1, Math.ceil((texto.length + 2) / charsPorLinea)));
    // El nombre es siempre una sola línea corta: alto fijo, chico.
    const altoNombre = Math.min(tamFontNombre * 1.6, alturaDisponible * 0.4);
    const altoTextoMax = Math.max(0, alturaDisponible - altoNombre - espacio);
    const altoTexto = Math.min(altoTextoMax, lineasTexto * tamFontTexto * 1.6);

    const cuadroTexto = pagina.insertTextBox(`“${texto}”`, celdaOriginal.x, inicioY, celdaOriginal.w, altoTexto);
    const estiloTexto = cuadroTexto.getText().getTextStyle();
    estiloTexto.setFontFamily('Georgia').setItalic(true).setFontSize(tamFontTexto).setForegroundColor('#2E2A26');
    // Más interlineado: a este tamaño, Georgia itálica se siente apretada
    // entre línea y línea (y entre letras, dentro de lo que la fuente
    // permite sin un control real de tracking en Slides). Con más espacio
    // entre renglones respira mejor.
    cuadroTexto.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER).setLineSpacing(145);

    const cuadroNombre = pagina.insertTextBox(nombre, celdaOriginal.x, inicioY + altoTexto + espacio, celdaOriginal.w, altoNombre);
    const estiloNombre = cuadroNombre.getText().getTextStyle();
    estiloNombre.setFontFamily('Georgia').setFontSize(tamFontNombre).setForegroundColor('#6B5D50');
    cuadroNombre.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  } catch (err) {
    registrarIncidencia_('No se pudo dibujar la dedicatoria debajo de una foto (no crítico)', err);
  }
}

/** Dedicatoria en una franja translúcida sobre el borde inferior de la foto, para celdas chicas. */
function dibujarLeyendaSuperpuesta_(pagina, fila, celda, ALTO) {
  try {
    const altoFranja = Math.min(celda.h * 0.34, ALTO * 0.075);
    const y = celda.y + celda.h - altoFranja;

    const franja = pagina.insertShape(SlidesApp.ShapeType.RECTANGLE, celda.x, y, celda.w, altoFranja);
    franja.getFill().setSolidFill('#2E2A26', 0.55);
    franja.getBorder().setTransparent();

    // Mismo criterio que la dedicatoria "debajo": el nombre va con un guion
    // largo delante, en una línea chica y fija; la cita usa el resto.
    const nombre = `—  ${espaciarLetras_(String(fila.guestName || '').trim() || 'Un invitado')}`;
    const espacio = Math.min(ALTO * 0.02, altoFranja * 0.22);
    const altoNombre = Math.min(altoFranja * 0.34, ALTO * 0.02);
    const altoTexto = altoFranja - altoNombre - espacio;

    const texto = truncarTexto_(fila.dedication, 52);
    const cuadroTexto = pagina.insertTextBox(`“${texto}”`, celda.x + celda.w * 0.06, y, celda.w * 0.88, altoTexto);
    const estiloTexto = cuadroTexto.getText().getTextStyle();
    estiloTexto.setFontFamily('Georgia').setItalic(true).setFontSize(Math.round(ALTO * 0.016)).setForegroundColor('#FBF9F7');
    cuadroTexto.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    try { cuadroTexto.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE); } catch (e2) { /* alineación vertical opcional */ }

    const cuadroNombre = pagina.insertTextBox(nombre, celda.x + celda.w * 0.06, y + altoTexto + espacio, celda.w * 0.88, altoNombre);
    const estiloNombre = cuadroNombre.getText().getTextStyle();
    estiloNombre.setFontFamily('Georgia').setFontSize(Math.round(ALTO * 0.011)).setForegroundColor('#D9D2C8');
    cuadroNombre.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  } catch (err) {
    registrarIncidencia_('No se pudo dibujar la dedicatoria superpuesta de una foto (no crítico)', err);
  }
}

/**
 * La foto de portada se obtiene de Drive igual que cualquier otra foto del
 * álbum (ver adminGenerarDescarga_) — antes iba incrustada como texto
 * Base64 directo en el script, pero una cadena de 39 KB pegada a mano en el
 * editor de Apps Script es frágil (se corrompe fácil al copiar/pegar) y
 * además quedaba fija a una sola imagen que había que actualizar a mano.
 * Usar la primera foto real de los invitados es más simple y confiable.
 */
/** Inserta la foto de portada llenando un bloque {x:0,y:0,w:ANCHO,h:altoBloque}, tapando el sobrante con colorFondo. */
function dibujarFotoPortada_(portada, blob, anchoOriginalPx, altoOriginalPx, ANCHO, altoBloque, colorFondo) {
  const escala = Math.max(ANCHO / anchoOriginalPx, altoBloque / altoOriginalPx);
  const anchoImg = anchoOriginalPx * escala;
  const altoImg = altoOriginalPx * escala;
  const x = (ANCHO - anchoImg) / 2;
  const y = (altoBloque - altoImg) / 2;
  portada.insertImage(blob, x, y, anchoImg, altoImg);

  const sobranteAbajo = (y + altoImg) - altoBloque;
  if (sobranteAbajo > 0.5) {
    dibujarFranjaOculta_(portada, 0, altoBloque, ANCHO, sobranteAbajo, colorFondo);
  }
}

/**
 * Portada del PDF, inspirada en un diseno editorial de album impreso: foto
 * grande arriba (recortada para llenar todo el ancho) y, abajo, un bloque
 * blanco limpio con una etiqueta pequena, el monograma "H & R" y los
 * nombres completos. Si algo de la API de Slides fallara, se cae a una
 * version minima (solo texto) para no arruinar la generacion del PDF por un
 * detalle decorativo.
 */
function dibujarPortadaAlbum_(portada, ANCHO, ALTO, fotoPortada) {
  const BLANCO = '#FFFFFF';
  try {
    portada.getBackground().setSolidFill(BLANCO);

    const altoFoto = ALTO * 0.58;
    if (fotoPortada && fotoPortada.blob && fotoPortada.ancho && fotoPortada.alto) {
      dibujarFotoPortada_(portada, fotoPortada.blob, fotoPortada.ancho, fotoPortada.alto, ANCHO, altoFoto, BLANCO);
    }

    const bloqueY = altoFoto;
    const bloqueH = ALTO - altoFoto;

    const eyebrow = portada.insertTextBox('N U E S T R A   B O D A', ANCHO * 0.1, bloqueY + bloqueH * 0.14, ANCHO * 0.8, bloqueH * 0.14);
    const estiloEyebrow = eyebrow.getText().getTextStyle();
    estiloEyebrow.setFontFamily('Georgia').setFontSize(Math.round(ALTO * 0.02)).setForegroundColor('#8C7C6E');
    eyebrow.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

    const monograma = portada.insertTextBox('H & R', ANCHO * 0.1, bloqueY + bloqueH * 0.3, ANCHO * 0.8, bloqueH * 0.34);
    const estiloMono = monograma.getText().getTextStyle();
    estiloMono.setFontFamily('Georgia').setFontSize(Math.round(ALTO * 0.078)).setForegroundColor('#2E2A26');
    monograma.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

    const cx = ANCHO / 2;
    const linea = portada.insertShape(SlidesApp.ShapeType.RECTANGLE, cx - ANCHO * 0.03, bloqueY + bloqueH * 0.7, ANCHO * 0.06, 1);
    linea.getFill().setSolidFill('#6B5D50');
    linea.getBorder().setTransparent();

    const nombres = portada.insertTextBox('HÉCTOR  +  RAQUEL', ANCHO * 0.1, bloqueY + bloqueH * 0.76, ANCHO * 0.8, bloqueH * 0.14);
    const estiloNombres = nombres.getText().getTextStyle();
    estiloNombres.setFontFamily('Georgia').setFontSize(Math.round(ALTO * 0.026)).setForegroundColor('#6B5D50');
    nombres.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  } catch (err) {
    registrarIncidencia_('No se pudo dibujar la portada elegante del PDF, se usa una version simple', err);
    try {
      portada.getBackground().setSolidFill('#FFFFFF');
      const texto = portada.insertTextBox('Héctor & Raquel', ANCHO * 0.1, ALTO * 0.42, ANCHO * 0.8, ALTO * 0.16);
      texto.getText().getTextStyle().setFontFamily('Georgia').setFontSize(36).setForegroundColor('#2E2A26');
      texto.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    } catch (err2) {
      registrarIncidencia_('Tampoco se pudo dibujar la portada minima (no es critico, el album sigue sin portada)', err2);
    }
  }
}

/**
 * Foto de portada: un archivo llamado EXACTAMENTE "portada.jpg" dentro de la
 * carpeta principal de Drive del proyecto ("Boda Héctor y Raquel - Fotos").
 * Es una foto elegida por ustedes (no una al azar de los invitados) — para
 * cambiarla, solo hay que subir un archivo nuevo con ese mismo nombre a esa
 * carpeta, sin tocar el código. Si el archivo no existe todavía, la portada
 * sale sin foto (no rompe la generación del PDF).
 */
function obtenerFotoPortada_() {
  try {
    const carpeta = obtenerOCrearCarpeta_();
    let archivo = null;
    // Acepta "portada" con cualquiera de estas extensiones — no hace falta
    // que sea exactamente .jpg.
    for (const ext of ['jpg', 'jpeg', 'png']) {
      const encontrados = carpeta.getFilesByName(`portada.${ext}`);
      if (encontrados.hasNext()) { archivo = encontrados.next(); break; }
    }
    if (!archivo) return null;
    const blob = archivo.getBlob();
    const dimensiones = leerDimensionesImagen_(blob);
    if (!dimensiones) return null;
    return { blob, ancho: dimensiones.ancho, alto: dimensiones.alto };
  } catch (err) {
    registrarIncidencia_('No se pudo leer la foto de portada de Drive (la portada del PDF sale sin foto)', err);
    return null;
  }
}

/**
 * Lee el ancho/alto de una imagen JPEG directamente de sus bytes (el
 * segmento SOF0/SOF2 del formato), sin depender de ningún servicio avanzado
 * de Google que haya que habilitar aparte.
 */
function leerDimensionesImagen_(blob) {
  try {
    const bytes = blob.getBytes();

    // PNG: firma fija de 8 bytes, luego el chunk IHDR trae ancho/alto en
    // los primeros 8 bytes de su contenido (offsets 16-23 del archivo).
    if (bytes.length > 24 && (bytes[0] & 0xFF) === 0x89 && (bytes[1] & 0xFF) === 0x50) {
      const leerUint32 = (offset) =>
        ((bytes[offset] & 0xFF) * 16777216) + ((bytes[offset + 1] & 0xFF) << 16) + ((bytes[offset + 2] & 0xFF) << 8) + (bytes[offset + 3] & 0xFF);
      return { ancho: leerUint32(16), alto: leerUint32(20) };
    }

    // JPEG: buscar el segmento SOF0/SOF2, que trae ancho/alto.
    let i = 2;
    while (i + 8 < bytes.length) {
      if ((bytes[i] & 0xFF) !== 0xFF) break;
      const marcador = bytes[i + 1] & 0xFF;
      if (marcador >= 0xC0 && marcador <= 0xC3) {
        const alto = ((bytes[i + 5] & 0xFF) << 8) | (bytes[i + 6] & 0xFF);
        const ancho = ((bytes[i + 7] & 0xFF) << 8) | (bytes[i + 8] & 0xFF);
        return { ancho, alto };
      }
      const largoSegmento = ((bytes[i + 2] & 0xFF) << 8) | (bytes[i + 3] & 0xFF);
      i += 2 + largoSegmento;
    }
  } catch (err) {
    registrarIncidencia_('No se pudieron leer las dimensiones de la foto de portada (no es crítico)', err);
  }
  return null;
}

function obtenerOCrearCarpetaDescargas_() {
  const carpetaPrincipal = obtenerOCrearCarpeta_();
  const existentes = carpetaPrincipal.getFoldersByName(NOMBRE_CARPETA_DESCARGAS);
  return existentes.hasNext() ? existentes.next() : carpetaPrincipal.createFolder(NOMBRE_CARPETA_DESCARGAS);
}

/* ==========================================================================
 * ACCESO A DRIVE Y SHEETS (con creación automática y caché de IDs)
 * ========================================================================== */
function obtenerOCrearCarpeta_() {
  const props = PropertiesService.getScriptProperties();
  const idGuardado = props.getProperty('DRIVE_FOLDER_ID');
  if (idGuardado) {
    try { return DriveApp.getFolderById(idGuardado); } catch (err) { /* la carpeta ya no existe: se recrea abajo */ }
  }
  const carpetas = DriveApp.getFoldersByName(NOMBRE_CARPETA_DRIVE);
  const carpeta = carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(NOMBRE_CARPETA_DRIVE);
  props.setProperty('DRIVE_FOLDER_ID', carpeta.getId());
  return carpeta;
}

function obtenerOCrearHoja_() {
  const props = PropertiesService.getScriptProperties();
  const idGuardado = props.getProperty('SHEET_ID');
  let libro;
  if (idGuardado) {
    try { libro = SpreadsheetApp.openById(idGuardado); } catch (err) { libro = null; }
  }
  if (!libro) {
    const archivos = DriveApp.getFilesByName(NOMBRE_HOJA_CALCULO);
    if (archivos.hasNext()) {
      libro = SpreadsheetApp.open(archivos.next());
    } else {
      libro = SpreadsheetApp.create(NOMBRE_HOJA_CALCULO);
    }
    props.setProperty('SHEET_ID', libro.getId());
  }

  let hoja = libro.getSheetByName(NOMBRE_PESTANA);
  if (!hoja) {
    hoja = libro.getSheets()[0];
    hoja.setName(NOMBRE_PESTANA);
  }
  if (hoja.getLastRow() === 0) {
    hoja.appendRow(ENCABEZADOS);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function obtenerFilasComoObjetos_() {
  return obtenerFilasConIndice_();
}

/**
 * Igual que leer todas las filas, pero cada objeto incluye `_fila` (el número
 * real de fila en la hoja, empezando en 1). El panel de administración lo
 * necesita para poder actualizar o borrar una fila específica sin tener que
 * reescribir toda la hoja. `_fila` nunca se envía al cliente porque las
 * funciones que arman la respuesta pública seleccionan los campos a mano.
 */
function obtenerFilasConIndice_() {
  const hoja = obtenerOCrearHoja_();
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return [];
  const valores = hoja.getRange(2, 1, ultimaFila - 1, ENCABEZADOS.length).getValues();
  return valores.map((fila, i) => {
    const objeto = { _fila: i + 2 };
    ENCABEZADOS.forEach((clave, j) => { objeto[clave] = fila[j]; });
    return objeto;
  });
}

function buscarPorIdempotencyKey_(idempotencyKey) {
  const filas = obtenerFilasComoObjetos_();
  return filas.find((fila) => fila.idempotencyKey === idempotencyKey) || null;
}

function agregarFila_(fila) {
  const hoja = obtenerOCrearHoja_();
  hoja.appendRow(ENCABEZADOS.map((clave) => fila[clave]));
}

/* ==========================================================================
 * UTILIDADES: propiedades, validación, sanitización, respuestas
 * ========================================================================== */
function obtenerPropiedad_(clave, porDefecto) {
  const valor = PropertiesService.getScriptProperties().getProperty(clave);
  return valor === null || valor === undefined ? porDefecto : valor;
}

/**
 * Ejecútala UNA VEZ desde el editor de Apps Script cada vez que pegues una
 * versión nueva de este archivo. La descarga en PDF usa Google Slides y una
 * solicitud externa (UrlFetchApp) para exportar el PDF — permisos que las
 * versiones anteriores de este proyecto no necesitaban. Si no re-autorizas,
 * "Descargar álbum" en el panel fallará con un error de permisos la primera
 * vez que lo uses después de actualizar el código.
 */
function autorizarPermisosDelPanel() {
  obtenerOCrearCarpeta_();
  obtenerOCrearHoja_();
  const presentacionPrueba = SlidesApp.create('Verificación de permisos - puedes borrar esto');
  DriveApp.getFileById(presentacionPrueba.getId()).setTrashed(true);
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  Logger.log('Permisos verificados correctamente. Ya puedes usar "Descargar álbum" desde el panel.');
}

/**
 * Ejecutar UNA VEZ desde el editor de Apps Script para inicializar o actualizar
 * las propiedades del script. No borra DRIVE_FOLDER_ID ni SHEET_ID existentes.
 * Ver apps-script/README_SETUP.md para más detalle de cada propiedad.
 */
function configurarPropiedades() {
  const props = PropertiesService.getScriptProperties();

  // MODERATION_ENABLED se define UNA SOLA VEZ aquí (valor inicial recomendado).
  // Si ya existe — por ejemplo porque la cambiaron con el interruptor "Revisar
  // antes de publicar" del panel — NUNCA se pisa, aunque esta función se
  // vuelva a ejecutar más adelante (por ejemplo al actualizar el código).
  if (props.getProperty('MODERATION_ENABLED') === null) {
    props.setProperty('MODERATION_ENABLED', 'true');
  }

  props.setProperties({
    MAX_FILE_MB: '15',           // tamaño máximo por fotografía ya optimizada
    // EVENT_CODE: 'defina-un-codigo-aqui', // descomentar para activar el álbum privado
  }, false);
}

/**
 * Define la contraseña del panel de administración (admin.html) SIN dejarla
 * escrita de forma permanente en el código:
 *
 *   1. Reemplaza abajo 'CAMBIA_ESTO_POR_TU_CONTRASENA' por la contraseña real.
 *   2. Guarda el archivo y ejecuta esta función UNA VEZ desde el editor
 *      (menú de funciones, arriba → configurarPasswordAdmin → Ejecutar).
 *   3. Verás "Contraseña de administrador configurada" en el registro de ejecución.
 *   4. Vuelve a dejar el valor de ejemplo (o borra el texto) y guarda de nuevo.
 *
 * Lo único que queda guardado permanentemente es un hash SHA-256 en
 * PropertiesService — ni siquiera tú puedes volver a ver la contraseña en
 * texto plano desde ahí; solo sirve para comparar al iniciar sesión.
 */
function configurarPasswordAdmin() {
  const NUEVA_CONTRASENA = 'CAMBIA_ESTO_POR_TU_CONTRASENA';
  if (NUEVA_CONTRASENA === 'CAMBIA_ESTO_POR_TU_CONTRASENA') {
    throw new Error('Edita esta función y reemplaza CAMBIA_ESTO_POR_TU_CONTRASENA por tu contraseña real antes de ejecutarla.');
  }
  if (NUEVA_CONTRASENA.length < 6) {
    throw new Error('Usa una contraseña de al menos 6 caracteres.');
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', calcularHashSHA256_(NUEVA_CONTRASENA));
  Logger.log('Contraseña de administrador configurada correctamente. Ahora borra NUEVA_CONTRASENA del código y guarda.');
}

function calcularHashSHA256_(texto) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes.map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function sanitizarTexto_(valor, longitudMaxima) {
  if (!valor) return '';
  const sinEtiquetas = String(valor).replace(/<[^>]*>/g, '');
  return sinEtiquetas.trim().slice(0, longitudMaxima);
}

/**
 * Corrige automáticamente ortografía/gramática de una dedicatoria usando el
 * servicio público de LanguageTool (gratuito, sin necesidad de clave). Es un
 * mejor-esfuerzo: si el servicio no responde, tarda demasiado o cambia de
 * formato, se guarda el texto tal cual lo escribió el invitado — un fallo
 * aquí NUNCA debe impedir que la subida se complete. Solo se usa para
 * dedicatorias; los nombres de invitados no se tocan (podría desfigurar
 * nombres poco comunes).
 */
function corregirOrtografia_(texto) {
  const limpio = String(texto || '').trim();
  if (!limpio) return limpio;
  try {
    const respuesta = UrlFetchApp.fetch('https://api.languagetool.org/v2/check', {
      method: 'post',
      payload: { text: limpio, language: 'es' },
      muteHttpExceptions: true,
    });
    if (respuesta.getResponseCode() !== 200) return limpio;

    const datos = JSON.parse(respuesta.getContentText());
    const coincidencias = (datos.matches || [])
      .filter((m) => m.replacements && m.replacements.length && m.replacements[0].value)
      // de atrás hacia adelante: así el índice (offset) de cada corrección
      // pendiente no se corre al aplicar las anteriores.
      .sort((a, b) => b.offset - a.offset);

    let corregido = limpio;
    let limiteAnterior = Infinity; // inicio de la última corrección ya aplicada
    coincidencias.forEach((m) => {
      // Si esta corrección se solapa con una que ya se aplicó (LanguageTool a
      // veces marca el mismo tramo con dos reglas distintas), se ignora: aplicar
      // ambas sobre índices calculados contra el texto ORIGINAL corrompería el
      // resultado.
      if (m.offset + m.length > limiteAnterior) return;
      const sugerencia = m.replacements[0].value;
      corregido = corregido.slice(0, m.offset) + sugerencia + corregido.slice(m.offset + m.length);
      limiteAnterior = m.offset;
    });
    return corregido;
  } catch (err) {
    registrarIncidencia_('No se pudo corregir la ortografía de una dedicatoria (se guardó tal cual la escribió el invitado)', err);
    return limpio;
  }
}

function sanitizarIdentificador_(valor) {
  return String(valor || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
}

function generarNombreSeguro_(nombreOriginal, mimeType) {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const base = String(nombreOriginal).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60) || 'fotografia';
  return `${Date.now()}_${base}.${extension}`;
}

function clamp_(valor, minimo, maximo) {
  return Math.max(minimo, Math.min(maximo, valor));
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function errorPayload_(code, message) {
  return { ok: false, error: { code, message } };
}

/** Error controlado con código estable, para distinguir de errores internos inesperados. */
function ErrorControlado_(codigo, mensaje) {
  this.name = 'ErrorControlado_';
  this.codigo = codigo;
  this.message = mensaje;
}
ErrorControlado_.prototype = Object.create(Error.prototype);

function manejarErrorInterno_(err) {
  if (err instanceof ErrorControlado_) {
    return errorPayload_(err.codigo, err.message);
  }
  const mensaje = String((err && err.message) || '');
  if (/quota|rate limit/i.test(mensaje)) {
    registrarIncidencia_('Cuota de Google alcanzada', err);
    return errorPayload_('CUOTA_EXCEDIDA', 'El álbum alcanzó su límite de uso por hoy. Intenta más tarde.');
  }
  registrarIncidencia_('Error interno no controlado', err);
  return errorPayload_('ERROR_INTERNO', 'Ocurrió un problema inesperado. Intenta de nuevo más tarde.');
}

/** Registro seguro: solo va a los logs de Apps Script, nunca se envía al cliente. */
function registrarIncidencia_(contexto, err) {
  console.error(`${contexto}: ${(err && err.stack) || err}`);
}
