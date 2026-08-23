# Fotografías de Héctor y Raquel

Coloca aquí las fotografías reales con estos nombres exactos (definidos en `CONFIG.PHOTOS` dentro de `config.js`), **reemplazando el archivo que ya existe con el mismo nombre**:

| Archivo | Dónde se usa |
|---|---|
| `hero.jpg` | Fondo del hero principal |
| `historia-principal.jpg` | Fotografía grande de la sección "Una historia escrita entre todos" |
| `historia-secundaria.jpg` | Fotografía pequeña superpuesta en la misma sección |
| `cierre.jpg` | Fondo de la sección de cierre "Gracias por vivirlo con nosotros" |
| `og-cover.jpg` | Vista previa al compartir el enlace en WhatsApp/redes (recomendado 1200×630px). Referenciada directamente en `<meta property="og:image">` de `index.html`, no en `CONFIG.PHOTOS`. Mientras no exista, simplemente no se muestra imagen en la vista previa del enlace (no rompe nada). |

**Los cuatro primeros archivos ya existen** — son degradados de la misma paleta del sitio (marfil/champagne/rosa empolvado), generados como marcador temporal para que la página no muestre ningún error de "archivo no encontrado" mientras no hay fotos reales. En cuanto tengas las fotografías reales, simplemente **sobrescribe cada archivo con el mismo nombre** (mismo `.jpg`); no hace falta tocar ningún código. Si de todos modos un archivo llegara a faltar en el futuro, la página también sabe recuperarse sola mostrando un marcador con el monograma "H & R" en vez de un ícono roto.

Recomendaciones:
- Formato JPG o WebP, ya recortado/orientado como quieras que se vea (el sitio usa `object-fit: cover`, así que recorta pensando en composición, no en tamaño exacto).
- Resolución suficiente para pantallas grandes (~2000px en el lado más largo es suficiente; no hace falta más).
- No es necesario comprimir manualmente antes de subirlas aquí; son archivos estáticos del sitio, no pasan por la cola de subida de invitados.
