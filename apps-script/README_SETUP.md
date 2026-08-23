# Configuración del backend — Álbum de Héctor & Raquel

Este backend usa **Google Apps Script + Google Drive + Google Sheets**. No requiere ningún servidor propio, pero sí una implementación (deploy) activa como "aplicación web" dentro de tu cuenta de Google.

> **Importante — estado actual:** la URL que aparece en `config.js` (`CONFIG.API_URL`) ya existe, pero al día de escribir esto **no responde con el código de este proyecto** (el endpoint `?action=health` devuelve la página de error genérica de Google, no un JSON). Eso significa que el proyecto de Apps Script vinculado a esa implementación todavía no tiene el archivo `Code.gs` de esta carpeta. **Debes completar los pasos de abajo y volver a implementar** antes de que la subida de fotografías funcione. Mientras tanto, la página web sigue funcionando (hero, historia, navegación, animaciones), pero la galería y el formulario de subida mostrarán mensajes de "álbum en línea no disponible" — esto es intencional, no un error del frontend.

## 1. Crear o seleccionar la hoja de cálculo

No es necesario crearla a mano: `Code.gs` la crea automáticamente la primera vez que se ejecuta (función `obtenerOCrearHoja_`), con el nombre **"Boda Héctor y Raquel - Registro"** y la pestaña **"Fotografias"** con los encabezados correctos. Si prefieres usar una hoja ya existente, simplemente crea manualmente una hoja con ese nombre exacto antes del primer uso, o ejecuta primero `configurarPropiedades` y ajusta luego la propiedad `SHEET_ID` desde **Configuración del proyecto → Propiedades del script**.

## 2. Crear o seleccionar la carpeta de Drive

Igual que con la hoja: se crea sola la primera vez, con el nombre **"Boda Héctor y Raquel - Fotos"**. Si ya tienes una carpeta con ese nombre exacto en tu Drive, el script la reutilizará en vez de crear una nueva.

## 3. Copiar `Code.gs`

1. Ve a [script.google.com](https://script.google.com) y abre el proyecto vinculado a la implementación existente (o crea uno nuevo: **Nuevo proyecto**).
2. Borra el contenido del archivo `Code.gs` por defecto y pega el contenido completo del `apps-script/Code.gs` de este repositorio.
3. Guarda (`Ctrl+S` / ícono de guardar).

## 4. Configurar las propiedades

1. En el editor, abre el archivo `Code.gs`, selecciona la función `configurarPropiedades` en el menú desplegable de funciones (arriba) y presiona **Ejecutar**.
2. Esto crea las propiedades `MODERATION_ENABLED` (`false` por defecto) y `MAX_FILE_MB` (`15` por defecto) sin borrar `DRIVE_FOLDER_ID` ni `SHEET_ID` si ya existían.
3. Para activar moderación previa: ve a **Configuración del proyecto (ícono de engranaje) → Propiedades del script** y cambia `MODERATION_ENABLED` a `true`. Las fotos nuevas quedarán con estado `pendiente` y no aparecerán en la galería hasta que cambies manualmente su columna `status` a `publicada` en la hoja de cálculo.
4. Para activar el álbum privado con código de evento: en la misma pantalla de propiedades, agrega manualmente la propiedad `EVENT_CODE` con el código que quieras compartir con tus invitados (por ejemplo `RyR2026`). **Nunca lo escribas en `config.js` ni en `admin.js`** — solo vive en esta propiedad del servidor. Mientras `EVENT_CODE` no exista, `CONFIG.FEATURES.accessCodeEnabled` en el frontend debe quedar en `false` (así viene por defecto).
5. Para cambiar el tamaño máximo por fotografía, edita la propiedad `MAX_FILE_MB` (entre `1` y `50`).

## 5. Autorizar permisos

Al ejecutar `configurarPropiedades` por primera vez (o al hacer la primera implementación), Google mostrará una pantalla de autorización:

1. **Revisar permisos** → elige tu cuenta de Google.
2. Verás una advertencia de "Google no verificó esta app" (normal en proyectos personales) → **Configuración avanzada** → **Ir a [nombre del proyecto] (no seguro)**.
3. Acepta los permisos de Drive y Hojas de cálculo que solicita el script.

## 6. Implementar como aplicación web

1. Botón **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. Descripción: por ejemplo `Álbum Héctor y Raquel v1`.
4. **Ejecutar como:** `Yo` (tu cuenta) — así el script usa tus permisos de Drive/Sheets, no los del visitante.
5. **Quién puede acceder:** `Cualquier usuario` (necesario para que los invitados puedan subir fotos sin iniciar sesión en Google). Recuerda: esta URL pública **no es un mecanismo de autenticación**; si quieres restringir el acceso, usa el código de evento (paso 4.4) además de compartir el enlace solo con tus invitados.
6. Presiona **Implementar** y autoriza de nuevo si te lo pide.

## 7. Seleccionar quién puede acceder

Ya cubierto en el paso anterior (`Cualquier usuario`). No uses `Solo yo` ni `Cualquier usuario de [tu organización]`, porque los invitados no podrán subir fotografías.

## 8. Actualizar una implementación existente

Si la URL en `config.js` ya existe y solo quieres actualizar el código (recomendado, para no tener que cambiar la URL):

1. **Implementar → Gestionar implementaciones**.
2. Junto a la implementación activa, presiona el ícono de lápiz (editar).
3. En **Versión**, elige **Nueva versión**.
4. Presiona **Implementar**.

La URL (`/exec`) se mantiene igual; no es necesario tocar `config.js`.

## 9. Copiar la URL correcta

En el diálogo de implementación, copia la **URL de la aplicación web** (termina en `/exec`, no en `/dev`). Debe verse así:

```
https://script.google.com/macros/s/AKfycb.../exec
```

## 10. Configurarla en `config.js`

Abre `config.js` en la raíz del proyecto y edita **una sola línea** dentro del objeto `CONFIG` (lo usan tanto `script.js` como `admin.js`):

```js
API_URL: 'https://script.google.com/macros/s/TU_ID_DE_IMPLEMENTACION/exec',
```

No hay ninguna otra referencia a esta URL en el resto del código: todo el frontend la consume desde `CONFIG.API_URL`.

## 11. Probar `?action=health`

Pega en el navegador: `TU_URL/exec?action=health`. Debe devolver algo como:

```json
{"ok":true,"data":{"status":"ok","time":"2026-08-21T12:00:00.000Z","moderationEnabled":false}}
```

Si en cambio ves una página HTML de error o de inicio de sesión de Google, revisa que la implementación esté configurada con acceso "Cualquier usuario" (paso 6).

## 12. Verificar una subida

1. Abre el sitio (`index.html`) en un navegador con la `API_URL` ya actualizada.
2. Ve a "Súmate a nuestra historia", selecciona una fotografía de prueba, elige una categoría y presiona "Compartir fotografías".
3. Debe pasar por "Optimizando…" → "Subiendo…" → "Compartida con éxito", y aparecer de inmediato en la galería (se inserta sin recargar la página).

## 13. Revisar los registros en la hoja

Abre la hoja "Boda Héctor y Raquel - Registro" (búscala en tu Google Drive) y confirma que apareció una fila nueva con `status = publicada` (o `pendiente` si activaste moderación) y un `driveFileId` válido. El archivo correspondiente debe estar en la carpeta "Boda Héctor y Raquel - Fotos" de tu Drive.

## 14. Resolver errores comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `action=health` devuelve HTML en vez de JSON | La implementación no tiene el código actualizado, o el acceso no es "Cualquier usuario" | Repite los pasos 3, 6 y 8 |
| La subida falla con "El álbum está ocupado" | Dos invitados subiendo al mismo tiempo agotaron el `LockService` (10 segundos) | El cliente ya reintenta automáticamente; si persiste, es una subida muy concurrente, vuelve a intentarlo en unos segundos |
| Las imágenes no cargan en la galería (aparece el marcador dorado) | El archivo de Drive no quedó compartido como "Cualquier persona con el enlace" | Revisa permisos del archivo en Drive, o que `setSharing` no haya fallado (ver Registros de ejecución) |
| Error de permisos al ejecutar funciones | No se completó la pantalla de autorización | Repite el paso 5 |
| Las fotos nuevas no aparecen aunque la subida fue exitosa | `MODERATION_ENABLED` está en `true` | Cambia manualmente la columna `status` a `publicada` en la hoja, o desactiva la moderación |
| El código de evento nunca es válido | La propiedad `EVENT_CODE` no está configurada en el servidor | Agrégala en Propiedades del script (paso 4.4) |

## 15. Panel de administración (`admin.html`) — solo para Héctor y Raquel

El archivo `admin.html` en la raíz del proyecto es un panel privado donde pueden ver **todas** las fotografías (incluidas las pendientes y las ocultas), aprobarlas u ocultarlas, eliminarlas definitivamente, y generar un **PDF** descargable del álbum con las fotos acomodadas en cuadrícula. No aparece enlazado desde ningún lugar del sitio de invitados — solo ustedes conocen la dirección.

> **Importante si ya tenías el backend desplegado desde antes:** la descarga en PDF usa Google Slides y una solicitud externa para exportar el PDF — permisos que las versiones anteriores de `Code.gs` no pedían. Después de pegar el código actualizado, ejecuta **una vez** la función `autorizarPermisosDelPanel` desde el editor de Apps Script (mismo procedimiento que el paso 5: te pedirá autorizar de nuevo, acepta los permisos nuevos). Si no haces esto, el botón "Descargar álbum" fallará con un error de permisos la primera vez que lo uses.

### 15.1 Definir la contraseña sin dejarla escrita en el código

1. Abre `Code.gs` en el editor de Apps Script y busca la función `configurarPasswordAdmin`.
2. Reemplaza `'CAMBIA_ESTO_POR_TU_CONTRASENA'` por la contraseña real que quieran usar (mínimo 6 caracteres). Ejemplo:
   ```js
   const NUEVA_CONTRASENA = 'MiContraseñaSecreta2026';
   ```
3. Guarda el archivo y ejecuta esa función una vez: selecciónala en el menú desplegable de funciones (arriba del editor) y presiona **Ejecutar**. La primera vez te pedirá autorización (igual que en el paso 5).
4. En **Ver → Registros de ejecución** debe aparecer "Contraseña de administrador configurada correctamente".
5. **Vuelve a dejar el valor de ejemplo** (`'CAMBIA_ESTO_POR_TU_CONTRASENA'`) en esa línea y guarda de nuevo. Lo único que queda guardado de forma permanente es un hash SHA-256 en las Propiedades del script — ni siquiera abriendo esa pantalla se puede recuperar la contraseña en texto plano; solo sirve para comparar al iniciar sesión. Si vuelven a ejecutar la función más adelante con una contraseña distinta, la reemplaza.
6. **Vuelve a implementar** (paso 8) para que el cambio quede activo en la URL pública.

### 15.2 Entrar al panel

Abre `admin.html` (la misma carpeta donde vive `index.html`) en el navegador — por ejemplo, si publicas el sitio en `https://tu-dominio.com/index.html`, el panel estará en `https://tu-dominio.com/admin.html`. Ingresa la contraseña que configuraste. La sesión dura 6 horas (el máximo que permite Apps Script) y luego pide iniciar sesión de nuevo; también pueden cerrarla manualmente con el botón "Cerrar sesión".

### 15.3 Qué pueden hacer desde ahí

- Ver el resumen (total, pendientes, publicadas, ocultas) y filtrar por estado.
- **Aprobar** una fotografía pendiente u oculta (queda visible en la galería pública).
- **Ocultar** una fotografía publicada (deja de verse en la galería pública, pero no se borra).
- **Eliminar** definitivamente una fotografía (borra el archivo de Drive y la fila de la hoja; pide confirmación porque no se puede deshacer).
- **Foto de portada del PDF**: sube un archivo llamado **`portada`** (con extensión `.jpg`, `.jpeg` o `.png` — cualquiera de las tres funciona) a la carpeta "Boda Héctor y Raquel - Fotos" de Drive (la misma carpeta principal del proyecto, no la de "Descargas del álbum"). Esa es la foto que va a salir arriba en la portada del PDF. Si no subes ese archivo, la portada sale sin foto (solo el monograma y los nombres) — no rompe nada, pero se ve más bonita con foto. Para cambiarla más adelante, solo reemplaza ese archivo en Drive por otro con el mismo nombre; no hay que tocar el código.
- **Descargar el álbum**: genera un único **PDF** en una carpeta "Descargas del álbum" dentro de la carpeta de Drive del proyecto, y la descarga arranca sola en cuanto está listo. Tiene una portada con la foto de `portada.jpg` (ver punto anterior) y el monograma, y luego las fotografías repartidas en páginas de 1 a 6 según cuántas fotos queden y de qué forma sean (una foto muy panorámica o muy alargada siempre va sola en su página; el resto se agrupa en la plantilla que menos las recorte). Cuando una fotografía tiene dedicatoria, se muestra junto a ella en el lugar que mejor le quede según el tamaño de su celda: debajo de la foto si hay espacio de sobra, o en una franja translúcida sobre el propio borde inferior si la celda es chica. Pueden elegir entre "solo publicadas" o "todas". Con muchas fotografías puede tardar uno o varios minutos — el panel espera hasta 5 minutos y medio antes de avisar que algo salió mal. Si alguna fotografía no se pudo incluir (por ejemplo porque el archivo ya no existe en Drive), el mensaje final lo indica ("X de Y incluidas") en vez de fallar en silencio. Solo se conserva el PDF más reciente; el anterior se borra únicamente después de que el nuevo se generó con éxito, para nunca quedarse sin ningún archivo descargable. Internamente se arma con una presentación de Google Slides temporal, que se borra automáticamente al terminar — solo queda el PDF.
- **Corrección ortográfica automática de las dedicatorias**: cuando un invitado escribe una dedicatoria, el servidor la corrige (acentos, ortografía, errores comunes) usando el servicio público y gratuito [LanguageTool](https://languagetool.org/) antes de guardarla — así lo que ven ustedes y lo que sale en el PDF ya está corregido, sin que nadie tenga que revisarlo a mano. Es un mejor esfuerzo: si el servicio no responde (está caído, o se alcanzó su límite de uso gratuito), la dedicatoria se guarda tal cual la escribió el invitado — nunca bloquea la subida. No necesita ninguna clave ni configuración adicional.

### 15.4 Seguridad — qué tan protegido está esto realmente

- La contraseña nunca se guarda en el código ni se envía en texto plano por la red sin cifrar (viaja por HTTPS); en el servidor solo se compara su hash.
- No hay límite de intentos de inicio de sesión (Apps Script no permite identificar de forma confiable la IP de quien llama). Para una boda esto es un riesgo aceptable, pero **no comuniques la dirección de `admin.html` públicamente** — solo compártanla entre ustedes dos.
- Si alguna vez sospechan que alguien más tiene la contraseña, repitan el paso 15.1 con una nueva.

## Limitaciones reales de Apps Script (no se pueden evitar, solo mitigar)

- **Cuota de ejecución:** las cuentas gratuitas de Google tienen un límite diario de tiempo de ejecución de scripts y de llamadas a servicios de Drive/Sheets. Un evento con cientos de invitados subiendo fotos simultáneamente puede acercarse a ese límite; el frontend maneja el error `CUOTA_EXCEDIDA` mostrando un mensaje claro en vez de fallar en silencio.
- **Tiempo máximo por ejecución:** 6 minutos por invocación. La subida de una sola fotografía optimizada nunca debería acercarse a ese límite, pero si Drive/Sheets responden muy lento, la petición puede expirar (el frontend lo trata como error recuperable y reintenta).
- **Sin `doOptions`:** Apps Script no permite responder a preflight CORS (`OPTIONS`). Por eso el frontend envía las subidas con `Content-Type: text/plain` en vez de `application/json`: así el navegador la trata como "solicitud simple" y no dispara preflight. No cambies ese `Content-Type` en `script.js` ni en `admin.js` sin volver a probar la integración completa.
- **Latencia de "cold start":** después de publicar una nueva versión, la primera solicitud puede tardar unos segundos más de lo normal mientras Google inicializa el proyecto.
- **Hotlinking de imágenes de Drive:** las URLs `drive.google.com/uc?export=view` y `drive.google.com/thumbnail` funcionan bien para un álbum de boda con tráfico moderado, pero Google puede limitar temporalmente el acceso directo si hay picos de tráfico muy altos en poco tiempo.
- **Caché de listado:** los resultados de `?action=list` se cachean 60 segundos por combinación de categoría/página para reducir lecturas a Sheets. Una fotografía recién subida por *otro* invitado puede tardar hasta un minuto en aparecer si tú no fuiste quien la subió (quien sube su propia foto la ve al instante, porque el frontend la inserta directamente sin esperar al listado).
- **Subidas concurrentes de varios invitados:** `LockService` solo protege la comprobación de duplicados y el registro final en la hoja (operación rápida), no la subida a Drive en sí (la parte lenta). Esto permite que varias fotografías se suban a Drive en paralelo; solo se serializa el instante de anotarlas en la hoja. Aun así, Apps Script sigue siendo un backend de un solo proceso: para una boda con decenas de invitados subiendo al mismo tiempo funciona bien, pero no es un servidor pensado para miles de solicitudes por segundo. Si una subida no logra el bloqueo en 10 segundos (evento con MUCHA gente subiendo exactamente a la vez), el archivo ya subido a Drive se descarta automáticamente y el frontend reintenta solo; no quedan huérfanos ni duplicados.
- **Tamaño de la hoja con el tiempo:** cada subida hace una lectura completa de la hoja para revisar duplicados (dos veces: una comprobación rápida sin bloqueo y una definitiva dentro del bloqueo). Con cientos de fotografías esto es instantáneo; si el álbum crece a varios miles de filas y notas que las subidas empiezan a tardar más, es momento de archivar las fotografías más antiguas en otra hoja.
- **Generar el PDF del álbum tiene el mismo límite de 6 minutos por ejecución**, y además requiere crear una presentación de Slides temporal y exportarla — es más lento que simplemente empaquetar archivos. Con las fotografías ya comprimidas por los invitados (unos pocos MB cada una), varios cientos de fotos deberían generarse sin problema. Si el álbum llega a tener miles de fotografías y la descarga empieza a fallar por tiempo agotado, descarga la carpeta de Drive directamente desde drive.google.com en vez de usar el botón del panel.
