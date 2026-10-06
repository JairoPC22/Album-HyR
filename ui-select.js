'use strict';

/* ==========================================================================
   UiSelect — reemplazo accesible del <select> nativo (menú desplegable de
   escritorio/móvil). El <select> original se conserva oculto como "fuente de
   verdad" (su valor, `required`, `form.reset()` y el evento `change` siguen
   funcionando igual para el resto del código).

   Modos:
     'lista'    → botón + lista desplegable (en celular se abre como hoja inferior)
     'tarjetas' → opciones visibles como tarjetas de radio (ideal con 2-3 opciones)
   Teclado: flechas, Inicio/Fin, Enter/Espacio, Esc, escritura rápida.
   ========================================================================== */
const UiSelect = (() => {
  let contador = 0;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function icono(path, clase) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', clase);
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.7');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }
  const ICONO_CHEVRON = 'M6 9.5L12 15.5L18 9.5';
  const ICONO_CHECK = 'M5 12.5L10 17.5L19 7';

  function leerOpciones(select) {
    return Array.from(select.options).map((o) => ({
      valor: o.value, texto: o.textContent.trim(), desc: o.dataset.desc || '', deshabilitada: o.disabled,
    }));
  }

  function mejorar(select, config = {}) {
    if (!select || select.dataset.uiSelect === 'listo') return null;
    select.dataset.uiSelect = 'listo';
    const modo = config.modo || select.dataset.uiModo || 'lista';
    const id = `uis-${++contador}`;

    const raiz = document.createElement('div');
    raiz.className = `ui-select ui-select--${modo}`;
    select.after(raiz);
    select.classList.add('ui-select__nativo');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    // Etiqueta: un clic en el <label> enfoca el control nuevo.
    const etiqueta = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
    if (etiqueta && !etiqueta.id) etiqueta.id = `${id}-etiqueta`;

    let opciones = leerOpciones(select);
    let activo = Math.max(0, select.selectedIndex);
    let abierto = false;
    let buscar = '';
    let buscarTimer = null;
    let controlPrincipal = null;

    function indiceSeleccionado() { return Math.max(0, select.selectedIndex); }

    function elegir(i, { cerrar = true, enfocar = true } = {}) {
      const op = opciones[i];
      if (!op || op.deshabilitada) return;
      const cambio = select.selectedIndex !== i;
      select.selectedIndex = i;
      activo = i;
      if (cambio) select.dispatchEvent(new Event('change', { bubbles: true }));
      pintar();
      if (cerrar) cerrarLista(enfocar);
    }

    /* ------------------------------ modo tarjetas ------------------------------ */
    let botonesTarjeta = [];
    function construirTarjetas() {
      raiz.setAttribute('role', 'radiogroup');
      if (etiqueta) raiz.setAttribute('aria-labelledby', etiqueta.id);
      botonesTarjeta = opciones.map((op, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ui-select__tarjeta';
        b.setAttribute('role', 'radio');
        const marca = document.createElement('span');
        marca.className = 'ui-select__marca';
        marca.setAttribute('aria-hidden', 'true');
        marca.appendChild(icono(ICONO_CHECK, 'ui-select__marca-icono'));
        const textos = document.createElement('span');
        textos.className = 'ui-select__textos';
        const t = document.createElement('span');
        t.className = 'ui-select__titulo';
        t.textContent = op.texto;
        textos.appendChild(t);
        if (op.desc) {
          const d = document.createElement('span');
          d.className = 'ui-select__desc';
          d.textContent = op.desc;
          textos.appendChild(d);
        }
        b.append(marca, textos);
        b.addEventListener('click', () => elegir(i, { cerrar: false }));
        b.addEventListener('keydown', (e) => {
          const paso = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
          if (!paso) return;
          e.preventDefault();
          let n = i;
          do { n = (n + paso + opciones.length) % opciones.length; } while (opciones[n].deshabilitada && n !== i);
          elegir(n, { cerrar: false });
          botonesTarjeta[n].focus();
        });
        raiz.appendChild(b);
        return b;
      });
      controlPrincipal = botonesTarjeta[0];
    }

    /* ------------------------------- modo lista -------------------------------- */
    let boton = null; let valorEl = null; let lista = null; let velo = null; let items = [];
    function construirLista() {
      boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'ui-select__boton';
      boton.id = `${id}-boton`;
      boton.setAttribute('role', 'combobox');
      boton.setAttribute('aria-haspopup', 'listbox');
      boton.setAttribute('aria-expanded', 'false');
      boton.setAttribute('aria-controls', `${id}-lista`);
      if (etiqueta) boton.setAttribute('aria-labelledby', `${etiqueta.id} ${boton.id}`);
      valorEl = document.createElement('span');
      valorEl.className = 'ui-select__valor';
      boton.append(valorEl, icono(ICONO_CHEVRON, 'ui-select__chevron'));

      velo = document.createElement('div');
      velo.className = 'ui-select__velo';
      velo.hidden = true;
      velo.addEventListener('click', () => cerrarLista(true));

      lista = document.createElement('ul');
      lista.className = 'ui-select__lista';
      lista.id = `${id}-lista`;
      lista.setAttribute('role', 'listbox');
      lista.hidden = true;
      if (etiqueta) lista.setAttribute('aria-labelledby', etiqueta.id);
      items = opciones.map((op, i) => {
        const li = document.createElement('li');
        li.className = 'ui-select__opcion';
        li.id = `${id}-op-${i}`;
        li.setAttribute('role', 'option');
        if (op.deshabilitada) li.setAttribute('aria-disabled', 'true');
        const txt = document.createElement('span');
        txt.textContent = op.texto;
        li.append(txt, icono(ICONO_CHECK, 'ui-select__check'));
        li.addEventListener('pointermove', () => { if (activo !== i) { activo = i; marcarActivo(false); } });
        li.addEventListener('click', () => elegir(i));
        lista.appendChild(li);
        return li;
      });
      // pointerdown en la lista no debe quitarle el foco al botón
      lista.addEventListener('pointerdown', (e) => e.preventDefault());

      boton.addEventListener('click', () => (abierto ? cerrarLista(false) : abrirLista()));
      boton.addEventListener('keydown', onTeclado);
      boton.addEventListener('blur', () => { if (abierto) cerrarLista(false); });
      raiz.append(boton, velo, lista);
      controlPrincipal = boton;
    }

    function marcarActivo(desplazar = true) {
      items.forEach((li, i) => li.classList.toggle('es-activa', i === activo));
      if (abierto && items[activo]) {
        boton.setAttribute('aria-activedescendant', items[activo].id);
        if (desplazar) items[activo].scrollIntoView({ block: 'nearest' });
      }
    }

    function abrirLista() {
      if (abierto) return;
      abierto = true;
      activo = indiceSeleccionado();
      lista.hidden = false;
      velo.hidden = false;
      raiz.dataset.abierto = 'true';
      boton.setAttribute('aria-expanded', 'true');
      // Si abajo no cabe, se abre hacia arriba (solo escritorio; en celular es hoja inferior).
      raiz.classList.remove('ui-select--arriba');
      if (window.matchMedia('(min-width: 641px)').matches) {
        const r = boton.getBoundingClientRect();
        const alto = Math.min(lista.scrollHeight, 288) + 12;
        if (window.innerHeight - r.bottom < alto && r.top > alto) raiz.classList.add('ui-select--arriba');
      } else {
        document.body.classList.add('no-scroll');
      }
      marcarActivo();
    }

    function cerrarLista(enfocar) {
      if (!abierto) return;
      abierto = false;
      lista.hidden = true;
      velo.hidden = true;
      delete raiz.dataset.abierto;
      boton.setAttribute('aria-expanded', 'false');
      boton.removeAttribute('aria-activedescendant');
      if (window.matchMedia('(max-width: 640px)').matches) document.body.classList.remove('no-scroll');
      if (enfocar) boton.focus();
    }

    function onTeclado(e) {
      const k = e.key;
      if (k === 'Tab') return;
      if (k === 'Escape') { if (abierto) { e.preventDefault(); e.stopPropagation(); cerrarLista(true); } return; }
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        if (!abierto) { abrirLista(); return; }
        const paso = k === 'ArrowDown' ? 1 : -1;
        let n = activo;
        do { n = clamp(n + paso, 0, opciones.length - 1); } while (opciones[n].deshabilitada && n > 0 && n < opciones.length - 1);
        activo = n; marcarActivo(); return;
      }
      if (k === 'Home' || k === 'End') {
        if (!abierto) return;
        e.preventDefault(); activo = k === 'Home' ? 0 : opciones.length - 1; marcarActivo(); return;
      }
      if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        if (abierto) elegir(activo); else abrirLista();
        return;
      }
      if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buscar += k.toLowerCase();
        clearTimeout(buscarTimer);
        buscarTimer = setTimeout(() => { buscar = ''; }, 600);
        const i = opciones.findIndex((o) => !o.deshabilitada && o.texto.toLowerCase().startsWith(buscar));
        if (i !== -1) { if (abierto) { activo = i; marcarActivo(); } else elegir(i, { cerrar: false }); }
      }
    }

    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

    /* --------------------------------- común ---------------------------------- */
    function pintar() {
      const sel = indiceSeleccionado();
      if (modo === 'tarjetas') {
        botonesTarjeta.forEach((b, i) => {
          b.setAttribute('aria-checked', String(i === sel));
          b.tabIndex = i === sel ? 0 : -1;
        });
      } else {
        const op = opciones[sel];
        valorEl.textContent = op ? op.texto : '';
        raiz.classList.toggle('ui-select--vacio', !op || op.valor === '');
        items.forEach((li, i) => li.setAttribute('aria-selected', String(i === sel)));
      }
    }

    if (modo === 'tarjetas') construirTarjetas(); else construirLista();
    pintar();

    if (etiqueta) etiqueta.addEventListener('click', (e) => { e.preventDefault(); if (controlPrincipal) controlPrincipal.focus(); });
    // form.reset() cambia el valor del <select> sin avisar: se re-sincroniza.
    if (select.form) select.form.addEventListener('reset', () => setTimeout(() => { activo = indiceSeleccionado(); pintar(); }, 0));
    document.addEventListener('pointerdown', (e) => { if (abierto && !raiz.contains(e.target)) cerrarLista(false); });

    return {
      /** Vuelve a leer las <option> del <select> (por si se agregaron después). */
      actualizar() { /* se reconstruye por completo: es barato y evita estados viejos */
        raiz.textContent = '';
        opciones = leerOpciones(select);
        if (modo === 'tarjetas') construirTarjetas(); else construirLista();
        pintar();
      },
      sincronizar() { activo = indiceSeleccionado(); pintar(); },
    };
  }

  return { mejorar };
})();
