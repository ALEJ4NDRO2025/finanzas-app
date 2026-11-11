/* Interfaz de Finanzas. No sabe de dónde vienen los datos: recibe un "store" con métodos async.
   Todo el texto del usuario se pinta con textContent (nunca innerHTML) → sin XSS. */
'use strict';
const FinanzasUI = (() => {
  const CATS = {
    gasto: ['Mercado', 'Almuerzos', 'Arriendo', 'Servicios', 'Transporte', 'Plan celular', 'Salud', 'Educación', 'Salidas', 'Ropa', 'Deudas', 'Otros'],
    ingreso: ['Salario', 'Freelance', 'Ventas', 'Prima', 'Otros'],
  };

  // Colores de categoría: tonos medios que se leen sobre la tinta del fondo.
  const PALETTE = ['#7c8cff', '#ffb35c', '#ff7eb6', '#4fc8f0', '#b99bff', '#f2d14c', '#5fd6b8', '#ff9f8a', '#a6dd5c', '#e79bff', '#9aa4b8'];
  const catColor = (c) => { if (CATS.ingreso.includes(c)) return '#34d39b'; const all = [...CATS.gasto, ...CATS.ingreso]; const i = all.indexOf(c); return PALETTE[(i >= 0 ? i : [...c].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % PALETTE.length]; };
  const cop = (n) => '$ ' + Math.round(n).toLocaleString('es-CO');
  const int = (n) => Math.round(Math.abs(n)).toLocaleString('es-CO');
  const compact = (n) => (n >= 1e6 ? (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M'
    : n >= 1e3 ? Math.round(n / 1e3) + ' mil' : String(Math.round(n)));
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const thisMonth = () => today().slice(0, 7);
  const shiftMonth = (m, k) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const monthName = (m, short) => { const [y, mo] = m.split('-').map(Number); const t = new Date(y, mo - 1, 1).toLocaleDateString('es-CO', short ? { month: 'short' } : { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
  const monthOnly = (m) => monthName(m).split(' ')[0].toLowerCase();
  // Semanas y categorías (misma lógica que src/utils/periods.js del servidor).
  const WEEK_SUFFIX = /^(.*?)[\s\-–—_:,.(]*\b(?:semana|sem|s)\.?\s*(\d{1,2})\)?\s*$/i;
  function splitWeek(category) {
    const m = String(category).trim().match(WEEK_SUFFIX);
    if (!m || !m[1].trim()) return { category: String(category).trim(), week: null };
    const base = m[1].trim().replace(/\s+/g, ' ');
    return { category: base.charAt(0).toUpperCase() + base.slice(1), week: `Semana ${Number(m[2])}` };
  }
  const isoUTC = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return isoUTC(d); };
  function weeksOfMonth(month) {
    const first = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const last = isoUTC(new Date(Date.UTC(y, m, 0)));
    const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
    const weeks = [];
    for (let start = addDays(first, -dow); start <= last; start = addDays(start, 7)) weeks.push({ n: weeks.length + 1, start, end: addDays(start, 6) });
    return weeks;
  }
  function referenceWeek(weeks, now) {
    const t = now ?? today();
    return weeks.find((w) => w.start <= t && t <= w.end) ?? (t > weeks.at(-1).end ? weeks.at(-1) : weeks[0]);
  }
  // "19–25 oct", o "28 sept – 4 oct" si la semana cruza de mes.
  function rangeLabel(start, end) {
    const f = (s, withMonth) => { const d = new Date(`${s}T12:00:00`); return withMonth ? `${d.getDate()} ${d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')}` : String(d.getDate()); };
    return start.slice(0, 7) === end.slice(0, 7) ? `${f(start)}–${f(end, true)}` : `${f(start, true)} – ${f(end, true)}`;
  }

  const digits = (s) => Number(String(s).replace(/\D/g, '')) || 0;

  // Crea elementos de forma segura.
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v; // CSSOM: permitido por la CSP estricta (setAttribute no)
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const svg = (tag, attrs = {}) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

  // Íconos dibujados a mano: trazo de 2 px, puntas redondas.
  const PATHS = {
    resumen: ['M4 19V10', 'M10 19V5', 'M16 19v-6', 'M21 19H3'],
    movimientos: ['M7 4v14', 'M3.5 14.5 7 18l3.5-3.5', 'M17 20V6', 'M13.5 9.5 17 6l3.5 3.5'],
    presupuestos: ['M4 18a8 8 0 1 1 16 0', 'M12 18l4-5'],
    metas: ['M6 21V4', 'M6 4h11l-2 4 2 4H6'],
    plus: ['M12 5v14', 'M5 12h14'],
    close: ['M6 6l12 12', 'M18 6 6 18'],
    prev: ['M15 6l-6 6 6 6'],
    next: ['M9 6l6 6-6 6'],
    out: ['M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4', 'M10 16l-4-4 4-4', 'M6 12h10'],
    copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  };
  const icon = (name, cls = 'ic') => {
    const el = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: cls });
    PATHS[name].forEach((d) => el.append(svg('path', { d })));
    return el;
  };
  // Triángulo de alza o baja, como en un tablero de bolsa.
  const tri = (up) => { const el = svg('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true', class: `tri ${up ? 'up' : 'down'}` }); el.append(svg('path', { d: up ? 'M5 1.5 9 8.5H1z' : 'M5 8.5 1 1.5h8z' })); return el; };
  // Marca: tres velas.
  function logo() {
    const el = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'logo' });
    [['M5 3v18', 'M3.5 8h3v8h-3z', 'up'], ['M12 2v16', 'M10.5 5h3v7h-3z', 'down'], ['M19 6v16', 'M17.5 10h3v9h-3z', 'up']].forEach(([wick, body, c]) => {
      el.append(svg('path', { d: wick, class: `wick ${c}` }), svg('path', { d: body, class: `body ${c}` }));
    });
    return el;
  }

  /* ---------- Movimiento (GSAP). Sin GSAP o con "reducir movimiento", todo aparece quieto. ---------- */
  const Motion = (() => {
    const g = () => window.gsap || null;
    const ok = () => !!g() && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const live = new Set();
    const keep = (t) => { live.add(t); return t; };
    return {
      ok,
      // Entrada de una vista: bloques en cascada y luego las barras crecen desde su base.
      enter(view) {
        if (!ok() || !view) return;
        const tl = keep(g().timeline({ defaults: { duration: 0.6, ease: 'expo.out' } }));
        tl.from(view.children, { y: 16, autoAlpha: 0, stagger: 0.06, clearProps: 'transform,opacity,visibility' })
          .from(view.querySelectorAll('.meter > span, .flowbar > span'), { scaleX: 0, transformOrigin: '0% 50%', duration: 0.9, stagger: 0.025 }, 0.12)
          .from(view.querySelectorAll('.chart .bar'), { scaleY: 0, transformOrigin: '50% 100%', duration: 0.8, stagger: 0.03 }, 0.18)
          .from(view.querySelectorAll('.wk-bar > span'), { scaleY: 0, transformOrigin: '50% 100%', duration: 0.7, stagger: 0.03 }, 0.25);
      },
      // Cifras que cuentan hasta su valor.
      count(el, from, to, fmt) {
        if (!ok() || from === to) { el.textContent = fmt(to); return; }
        const o = { v: from };
        keep(g().to(o, { v: to, duration: 1.1, ease: 'power3.out', onUpdate: () => { el.textContent = fmt(o.v); } }));
      },
      // Cinta tipo bolsa: corre sola si no cabe, se detiene al pasar el mouse o al enfocarla.
      ticker(box) {
        const track = box?.querySelector('.ticker-track');
        if (!track || !ok() || track.scrollWidth / 2 <= box.clientWidth) { box?.classList.add('static'); return; }
        const tw = keep(g().to(track, { xPercent: -50, ease: 'none', duration: track.scrollWidth / 2 / 38, repeat: -1 }));
        const pause = () => tw.pause(), play = () => tw.play();
        box.addEventListener('mouseenter', pause); box.addEventListener('mouseleave', play);
        box.addEventListener('focusin', pause); box.addEventListener('focusout', play);
      },
      sheetIn(back, panel, wide) {
        if (!ok()) return;
        keep(g().timeline({ defaults: { ease: 'expo.out' } })
          .from(back, { autoAlpha: 0, duration: 0.25, ease: 'none' })
          .from(panel, wide ? { xPercent: 100, duration: 0.55 } : { yPercent: 100, duration: 0.55 }, 0)
          .from(panel.querySelectorAll('.field, .sheet-cta'), { y: 10, autoAlpha: 0, duration: 0.4, stagger: 0.035, clearProps: 'all' }, 0.12));
      },
      sheetOut(back, panel, wide, done) {
        if (!ok()) return done();
        g().timeline({ onComplete: done, defaults: { ease: 'power3.in', duration: 0.28 } })
          .to(panel, wide ? { xPercent: 100 } : { yPercent: 100 })
          .to(back, { autoAlpha: 0, ease: 'none' }, 0.05);
      },
      // Reporte de meta: el anillo se llena mientras cuenta el porcentaje.
      report(dialog, ring, pctEl, pct) {
        if (!ok()) return;
        // Sin keep(): el reporte sobrevive al re-render de la vista que ocurre detrás.
        g().timeline({ defaults: { ease: 'expo.out' } })
          .from(dialog, { y: 40, autoAlpha: 0, scale: 0.97, duration: 0.5 })
          .fromTo(ring, { '--p': 0 }, { '--p': pct, duration: 1.2, ease: 'power3.out', onUpdate() { pctEl.textContent = `${Math.round(Number(ring.style.getPropertyValue('--p')) || 0)}%`; } }, 0.15)
          .from(dialog.querySelectorAll('.report-grid > div'), { x: -10, autoAlpha: 0, stagger: 0.07, duration: 0.45, clearProps: 'all' }, 0.35);
      },
      // Acceso: el panel sube y los campos aparecen en orden.
      auth(panel) {
        if (!ok() || !panel) return;
        keep(g().timeline({ defaults: { ease: 'expo.out' } })
          .from(panel, { y: 28, autoAlpha: 0, duration: 0.7 })
          .from(panel.querySelectorAll('.auth-brand, h1, .auth-intro, .field, .auth form > button, .auth-links, .recovery-code, .check-row'), { y: 12, autoAlpha: 0, stagger: 0.05, duration: 0.5, clearProps: 'all' }, 0.12));
      },
      killAll() { live.forEach((t) => t.kill()); live.clear(); },
    };
  })();

  // Campo de dinero que se formatea solo: 1250000 → 1.250.000
  function moneyInput(id, placeholder) {
    const input = h('input', { id, inputmode: 'numeric', autocomplete: 'off', placeholder, required: true, class: 'money' });
    input.addEventListener('input', () => { const n = digits(input.value); input.value = n ? n.toLocaleString('es-CO') : ''; });
    return input;
  }

  function toast(msg) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(t);
    if (Motion.ok()) window.gsap.from(t, { y: 16, autoAlpha: 0, duration: 0.4, ease: 'expo.out' });
    setTimeout(() => t.remove(), 2400);
  }

  // Borrado con confirmación dentro de la fila (los diálogos del navegador no siempre existen).
  function deleteButton(label, onConfirm) {
    const wrap = h('span', { class: 'del' });
    const ask = () => {
      wrap.replaceChildren(h('span', { class: 'inline-confirm' }, '¿Borrar?',
        h('button', { class: 'btn-danger btn-sm', onclick: onConfirm }, 'Sí'),
        h('button', { class: 'btn-ghost btn-sm', onclick: idle }, 'No')));
      wrap.querySelector('button').focus();
    };
    const idle = () => wrap.replaceChildren(h('button', { class: 'btn-ghost icon-btn', 'aria-label': label, title: label, onclick: ask }, icon('close')));
    idle();
    return wrap;
  }

  // Cuánto falta, en meses, para la fecha límite de una meta (mínimo 1).
  function monthsLeft(deadline) {
    const [y, m] = deadline.split('-').map(Number); const n = new Date();
    return Math.max(1, (y - n.getFullYear()) * 12 + (m - 1 - n.getMonth()));
  }

  // Mientras hay un diálogo abierto, el resto de la app queda inerte (ni foco ni clics).
  const setInert = (on) => { const app = document.getElementById('app'); if (app) app.inert = on; };

  // Reporte que aparece al mandar dinero a una meta: cuánto llevas y cuánto te falta.
  function goalReport(g, added) {
    const left = Math.max(0, g.target - g.saved);
    const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
    const done = left === 0;
    const close = h('button', { class: 'btn-primary', type: 'button' }, 'Listo');
    const pctEl = h('span', { class: 'num' }, `${pct}%`);
    const ring = h('div', { class: 'report-ring', style: `--p:${pct}` }, pctEl);
    const dialog = h('div', { class: 'report', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'report-title' },
      h('p', { class: 'report-added num' }, tri(true), `${cop(added)} a tu meta`),
      h('h2', { id: 'report-title', class: 'report-title' }, g.name),
      ring,
      h('dl', { class: 'report-grid' },
        h('div', {}, h('dt', {}, 'Llevas'), h('dd', { class: 'num' }, cop(g.saved))),
        h('div', {}, h('dt', {}, 'Meta'), h('dd', { class: 'num' }, cop(g.target))),
        h('div', { class: done ? 'done' : 'left' }, h('dt', {}, done ? 'Estado' : 'Te faltan'), h('dd', { class: 'num' }, done ? '¡Cumplida!' : cop(left)))),
      !done && g.deadline ? h('p', { class: 'report-note' }, `Ahorra ${cop(left / monthsLeft(g.deadline))} al mes para llegar a tiempo.`) : null,
      done ? h('p', { class: 'report-note' }, 'Llegaste a la meta. Lo que sigas mandando queda como extra.') : null,
      close);
    const back = h('div', { class: 'report-backdrop' }, dialog);
    const shut = () => { back.remove(); setInert(false); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') shut(); };
    close.addEventListener('click', shut);
    back.addEventListener('click', (e) => { if (e.target === back) shut(); });
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    setInert(true);
    close.focus();
    Motion.report(dialog, ring, pctEl, pct);
  }

  // Bolsillo sugerido: salario y prima → Sostenimiento; otros ingresos → Ahorro;
  // gastos → Sostenimiento; lo que va a una meta → Ahorro. (Las mismas reglas que usa el servidor.)
  const SALARY = ['Salario', 'Prima'];
  function defaultPocket(pockets, type, category, toGoal) {
    if (!pockets.length) return null;
    const find = (n) => pockets.find((p) => p.name.toLowerCase() === n);
    const living = find('sostenimiento') ?? pockets[0];
    const saving = find('ahorro') ?? pockets.at(-1);
    if (type === 'ingreso') return (SALARY.includes(category) ? living : saving).id;
    return (toGoal ? saving : living).id;
  }

  /* ---------- Hoja deslizante: abajo en celular, a la derecha en pantallas anchas ---------- */
  let sheet = null;
  const wideScreen = () => matchMedia('(min-width: 900px)').matches;
  function closeSheet(now) {
    if (!sheet) return;
    const { back, panel, wide, onKey, returnTo } = sheet;
    sheet = null;
    document.removeEventListener('keydown', onKey);
    setInert(false);
    const done = () => back.remove();
    if (now) done(); else Motion.sheetOut(back, panel, wide, done);
    if (returnTo?.isConnected) returnTo.focus();
  }
  function openSheet(title, body) {
    closeSheet(true);
    const wide = wideScreen();
    const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
      h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
      h('div', { class: 'sheet-head' }, h('h2', { id: 'sheet-title' }, title),
        h('button', { class: 'btn-ghost icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => closeSheet() }, icon('close'))),
      h('div', { class: 'sheet-body' }, body));
    const back = h('div', { class: 'sheet-backdrop' }, panel);
    back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); });
    const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
    document.addEventListener('keydown', onKey);
    sheet = { back, panel, wide, onKey, returnTo: document.activeElement };
    document.body.append(back);
    setInert(true);
    panel.querySelector('.sheet-body input, .sheet-body select, .sheet-body button')?.focus({ preventScroll: true });
    Motion.sheetIn(back, panel, wide);
  }

  function mount(root, store, opts = {}) {
    const state = { month: thisMonth(), tab: 'resumen', txType: 'gasto', customs: { gasto: new Set(), ingreso: new Set() }, goals: [], pockets: [], editPockets: false, budPeriod: 'mes', shown: null };
    const learnCustoms = (txs) => txs.forEach((t) => { if (!CATS[t.type].includes(t.category)) state.customs[t.type].add(t.category); });
    let busy = false;

    async function act(fn, okMsg) {
      try { await fn(); closeSheet(); if (okMsg) toast(okMsg); await render(); }
      catch (e) { toast(e.message || 'No se pudo guardar'); }
    }

    const TABS = [['resumen', 'Resumen'], ['movimientos', 'Movimientos'], ['presupuestos', 'Presupuestos'], ['metas', 'Metas']];
    // Una sola navegación: barra lateral en pantallas anchas, barra inferior con el botón + en celular.
    function nav() {
      return h('nav', { class: 'rail', 'aria-label': 'Secciones' },
        h('div', { class: 'rail-brand' }, logo(), h('span', {}, 'Mis Finanzas')),
        h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) =>
          h('button', { role: 'tab', class: `tab tab-${id}`, 'aria-selected': String(state.tab === id), onclick: () => { if (state.tab !== id) { go({ tab: id }); window.scrollTo({ top: 0 }); } } }, icon(id, 'ic tab-ic'), h('span', {}, label)))),
        h('button', { class: 'btn-primary add-btn', type: 'button', 'aria-label': 'Nuevo movimiento', onclick: openTx }, icon('plus'), h('span', {}, 'Nuevo movimiento')));
    }

    function header() {
      const first = opts.userName ? opts.userName.split(' ')[0] : null;
      return h('header', { class: 'top' },
        h('div', { class: 'hello' }, h('span', { class: 'hello-brand' }, logo(), 'Mis Finanzas'), h('h1', {}, first ? `Hola, ${first}` : 'Tus finanzas')),
        h('div', { class: 'top-tools' },
          h('div', { class: 'month', role: 'group', 'aria-label': 'Mes' },
            h('button', { class: 'icon-btn', 'aria-label': 'Mes anterior', onclick: () => go({ month: shiftMonth(state.month, -1) }) }, icon('prev')),
            h('strong', { 'aria-live': 'polite' }, monthName(state.month)),
            h('button', { class: 'icon-btn', 'aria-label': 'Mes siguiente', onclick: () => go({ month: shiftMonth(state.month, 1) }) }, icon('next'))),
          state.month !== thisMonth() ? h('button', { class: 'btn-ghost btn-sm', onclick: () => go({ month: thisMonth() }) }, 'Hoy') : null,
          opts.onLogout ? h('button', { class: 'btn-ghost icon-btn logout', 'aria-label': 'Salir', title: 'Salir', onclick: opts.onLogout }, icon('out')) : null));
    }

    /* ---------- Registrar movimiento (en la hoja) ---------- */
    async function openTx() {
      try {
        const [goals, pockets] = await Promise.all([store.listGoals(), store.listPockets()]);
        state.goals = goals; state.pockets = pockets;
      } catch { /* se usa lo que ya había */ }
      openSheet('Nuevo movimiento', txForm());
    }

    function txForm() {
      const err = h('p', { class: 'error', role: 'alert', hidden: true });
      const amount = moneyInput('tx-amount', '0');
      // En gastos, tus metas salen como "Ahorro: <meta>": el dinero se suma a esa meta.
      const goalOpts = state.txType === 'gasto' && state.goals.length
        ? h('optgroup', { label: 'Metas de ahorro' }, state.goals.map((g) => h('option', { value: `goal:${g.id}` }, `Ahorro: ${g.name}`)))
        : null;
      const cat = h('select', { id: 'tx-cat' }, CATS[state.txType].map((c) => h('option', {}, c)), goalOpts);
      const date = h('input', { id: 'tx-date', type: 'date', value: state.month === thisMonth() ? today() : `${state.month}-01`, required: true });
      // Bolsillo: se sugiere según el tipo y la categoría hasta que lo cambies a mano.
      const pocket = h('select', { id: 'tx-pocket' }, state.pockets.map((p) => h('option', { value: String(p.id) }, p.name)));
      let pocketTouched = false;
      const suggestPocket = () => {
        if (pocketTouched) return;
        const id = defaultPocket(state.pockets, state.txType, cat.value, cat.value.startsWith('goal:'));
        if (id) pocket.value = String(id);
      };
      pocket.addEventListener('change', () => { pocketTouched = true; });
      const desc = h('input', { id: 'tx-desc', maxlength: '140', placeholder: 'Opcional' });
      // "Otros" pide escribir qué fue; lo que escribas queda como categoría propia y se sugiere la próxima vez.
      const isGasto = state.txType === 'gasto';
      const other = h('input', { id: 'tx-other', maxlength: '40', autocomplete: 'off', list: 'tx-other-list', placeholder: isGasto ? 'Ej: Gimnasio, regalo, peluquería' : 'Ej: Bono, préstamo, reembolso' });
      const otherList = h('datalist', { id: 'tx-other-list' }, [...state.customs[state.txType]].map((c) => h('option', { value: c })));
      const otherField = h('div', { class: 'field span', hidden: true }, h('label', { for: 'tx-other' }, isGasto ? '¿En qué gastaste?' : '¿De dónde vino?'), other, otherList);
      cat.addEventListener('change', () => {
        const on = cat.value === 'Otros';
        otherField.hidden = !on; other.required = on;
        if (on) other.focus(); else other.value = '';
        suggestPocket();
      });
      suggestPocket();
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo' },
        ['gasto', 'ingreso'].map((t) => h('button', {
          type: 'button', class: t, 'aria-pressed': String(state.txType === t),
          onclick: () => { if (state.txType === t) return; state.txType = t; const next = txForm(); form.replaceWith(next); next.querySelector('#tx-amount').focus(); },
        }, t === 'gasto' ? 'Gasto' : 'Ingreso')));
      const form = h('form', {
        class: `quick tx-form ${state.txType}`, onsubmit: (e) => {
          e.preventDefault();
          const value = digits(amount.value);
          if (!value) { err.textContent = 'Escribe un valor mayor a 0.'; err.hidden = false; amount.focus(); return; }
          if (cat.value.startsWith('goal:')) {
            const goal = state.goals.find((g) => `goal:${g.id}` === cat.value);
            act(async () => {
              const r = await store.addTx({ type: 'gasto', amount: value, category: goal.name, goal_id: goal.id, description: desc.value.trim(), date: date.value, ...(pocket.value && { pocket_id: pocket.value }) });
              closeSheet(true);
              if (r?.goal) goalReport(r.goal, value);
            });
            return;
          }
          const category = cat.value === 'Otros' ? other.value.trim().replace(/\s+/g, ' ') : cat.value;
          if (!category) { err.textContent = isGasto ? 'Escribe en qué gastaste.' : 'Escribe de dónde vino.'; err.hidden = false; other.focus(); return; }
          const label = category.charAt(0).toUpperCase() + category.slice(1);
          act(() => store.addTx({ type: state.txType, amount: value, category: label, description: desc.value.trim(), date: date.value, ...(pocket.value && { pocket_id: pocket.value }) }),
            state.txType === 'gasto' ? 'Gasto registrado' : 'Ingreso registrado');
        },
      },
        h('div', { class: 'field span' }, seg),
        h('div', { class: 'field span field-amount' }, h('label', { for: 'tx-amount' }, 'Valor'), h('div', { class: 'amount-wrap' }, h('span', { class: 'cur', 'aria-hidden': 'true' }, '$'), amount)),
        h('div', { class: 'field' }, h('label', { for: 'tx-cat' }, 'Categoría'), cat),
        h('div', { class: 'field' }, h('label', { for: 'tx-date' }, 'Fecha'), date),
        otherField,
        state.pockets.length ? h('div', { class: 'field span' }, h('label', { for: 'tx-pocket' }, state.txType === 'ingreso' ? 'Va al bolsillo' : 'Sale del bolsillo'), pocket) : null,
        h('div', { class: 'field span' }, h('label', { for: 'tx-desc' }, 'Nota'), desc),
        err,
        h('button', { class: 'btn-primary sheet-cta span', type: 'submit' }, isGasto ? 'Registrar gasto' : 'Registrar ingreso'));
      return form;
    }

    /* ---------- Gráficas ---------- */
    function trendChart(trend) {
      const W = 600, H = 240, L = 58, B = 30, T = 14;
      const max = Math.max(1, ...trend.flatMap((t) => [t.income, t.expense]));
      const y = (v) => T + (H - T - B) * (1 - v / max);
      const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Ingresos y gastos de los últimos 6 meses' });
      for (const f of [0, 0.5, 1]) {
        const v = max * f;
        el.append(svg('line', { x1: L, x2: W, y1: y(v), y2: y(v), class: 'grid' }));
        const tx = svg('text', { x: L - 10, y: y(v) + 4, 'text-anchor': 'end' }); tx.textContent = compact(v); el.append(tx);
      }
      const band = (W - L) / trend.length, bw = Math.min(20, band / 3.4);
      trend.forEach((t, i) => {
        const cx = L + band * i + band / 2;
        const current = t.month === state.month;
        if (current) el.append(svg('rect', { x: cx - band / 2 + 6, y: T - 6, width: band - 12, height: H - T - B + 10, rx: 8, class: 'col-now' }));
        el.append(svg('rect', { x: cx - bw - 2, y: y(t.income), width: bw, height: Math.max(0, y(0) - y(t.income)), rx: 3, class: 'bar bar-in' }));
        el.append(svg('rect', { x: cx + 2, y: y(t.expense), width: bw, height: Math.max(0, y(0) - y(t.expense)), rx: 3, class: 'bar bar-out' }));
        const lab = svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: current ? 'now' : '' }); lab.textContent = monthName(t.month, true).replace('.', ''); el.append(lab);
      });
      return el;
    }

    function categoryBars(byCategory, total) {
      if (!byCategory.length) return h('p', { class: 'empty' }, 'Aún no hay gastos este mes.');
      const max = byCategory[0].total;
      return h('ol', { class: 'cats' }, byCategory.map((c) => h('li', { class: 'cat' },
        h('span', { class: 'cat-name' }, h('span', { class: 'cat-dot', style: `background:${catColor(c.category)}` }), c.category),
        h('span', { class: 'cat-v num' }, cop(c.total)),
        h('span', { class: 'cat-pct num' }, `${Math.round((c.total / total) * 100)}%`),
        h('div', { class: 'meter thin' }, h('span', { style: `transform:scaleX(${c.total / max});background:${catColor(c.category)}` })))));
    }

    // Cifra protagonista: lo disponible del mes, con la barra de flujo debajo (en qué se fue lo que entró).
    function hero(s) {
      const pct = s.income ? Math.round(((s.income - s.expense) / s.income) * 100) : null;
      const neg = s.balance < 0;
      const base = Math.max(s.income, s.expense + s.saved, 1);
      const seg = (cls, v, label) => (v > 0 ? h('span', { class: cls, style: `transform:scaleX(1);flex-grow:${v / base}`, title: `${label}: ${cop(v)}` }) : null);
      const intEl = h('span', { class: 'int', 'data-count': String(Math.abs(Math.round(s.balance))), 'data-from': String(Math.abs(Math.round(state.shown ?? 0))) }, int(s.balance));
      state.nextShown = s.balance;
      return h('section', { class: `hero${neg ? ' negative' : ''}`, 'aria-label': 'Disponible del mes' },
        h('div', { class: 'hero-label' }, h('span', {}, `Disponible en ${monthOnly(state.month)}`), h('span', { class: 'hero-cur' }, 'COP')),
        h('p', { class: 'hero-num num' }, neg ? h('span', { class: 'sign' }, '−') : null, h('span', { class: 'cur' }, '$'), intEl),
        h('p', { class: `hero-delta ${pct === null ? '' : neg ? 'down' : 'up'}` }, pct === null ? null : tri(!neg),
          pct === null ? 'Registra tu primer ingreso para ver cuánto ahorras'
            : neg ? 'Este mes salió más de lo que entró' : `Ahorras el ${Math.max(0, pct)}% de lo que entra`),
        h('div', { class: 'flowbar', role: 'img', 'aria-label': `De ${cop(s.income)} que entraron: ${cop(s.expense)} en gastos, ${cop(s.saved)} a metas y ${cop(Math.max(0, s.balance))} disponibles` },
          seg('f-out', s.expense, 'Gastos'), seg('f-goal', s.saved, 'A metas'), seg('f-free', Math.max(0, s.balance), 'Disponible')),
        h('dl', { class: 'flows' },
          h('div', { class: 'flow in' }, h('dt', {}, 'Entró'), h('dd', { class: 'num' }, cop(s.income))),
          h('div', { class: 'flow out' }, h('dt', {}, 'Gastaste'), h('dd', { class: 'num' }, cop(s.expense))),
          h('div', { class: 'flow goal' }, h('dt', {}, 'A metas'), h('dd', { class: 'num' }, cop(s.saved)))));
    }

    // Cinta de presupuestos (o de categorías si no hay presupuestos), como el tablero del acceso.
    function ticker(budgets, byCategory, total) {
      const items = budgets.length
        ? budgets.map((b) => { const p = b.spent / b.limit_amount; return { name: b.category + (b.period === 'semana' ? ' · sem' : ''), v: compact(b.spent), pct: `${Math.round(p * 100)}%`, lvl: p > 1 ? 'over' : p >= 0.8 ? 'warn' : 'ok' }; })
        : byCategory.map((c) => ({ name: c.category, v: compact(c.total), pct: `${Math.round((c.total / total) * 100)}%`, lvl: 'neutral' }));
      if (!items.length) return null;
      const row = (hidden) => h('ul', { class: 'ticker-row', 'aria-hidden': hidden ? 'true' : null }, items.map((it) => h('li', { class: `tk ${it.lvl}` },
        h('span', { class: 'tk-name' }, it.name), h('span', { class: 'tk-v num' }, it.v), h('span', { class: 'tk-p num' }, it.lvl === 'neutral' ? null : tri(it.lvl !== 'ok'), it.pct))));
      return h('section', { class: 'ticker', tabindex: '0', 'aria-label': budgets.length ? 'Cómo van tus presupuestos' : 'En qué se fue la plata' },
        h('span', { class: 'ticker-tag' }, budgets.length ? 'Presupuestos' : 'Gastos'),
        h('div', { class: 'ticker-window' }, h('div', { class: 'ticker-track' }, row(false), row(true))));
    }

    /* ---------- Bolsillos ---------- */
    function pocketCard(p) {
      const out = p.expense + p.saved;
      const pct = p.income ? Math.min(1, out / p.income) : (out ? 1 : 0);
      const over = p.left < 0;
      return h('article', { class: `pocket${over ? ' over' : ''}` },
        h('div', { class: 'pocket-head' }, h('h3', {}, p.name), h('span', { class: 'pocket-tag' }, over ? 'Te pasaste' : 'Te quedan')),
        h('p', { class: 'pocket-left num' }, (over ? '−' : '') + cop(Math.abs(p.left))),
        h('div', { class: `meter ${over ? 'over' : pct >= 0.8 ? 'warn' : ''}`, role: 'img', 'aria-label': `Usado ${Math.round(pct * 100)}% de lo que entró` }, h('span', { style: `transform:scaleX(${pct})` })),
        h('dl', { class: 'pocket-flows' },
          h('div', {}, h('dt', {}, 'Entró'), h('dd', { class: 'num' }, cop(p.income))),
          h('div', {}, h('dt', {}, 'Gastaste'), h('dd', { class: 'num' }, cop(p.expense))),
          p.saved ? h('div', {}, h('dt', {}, 'A metas'), h('dd', { class: 'num' }, cop(p.saved))) : null));
    }

    function pocketEditor(pockets) {
      const rows = pockets.map((p) => {
        const name = h('input', { id: `pk-${p.id}`, value: p.name, maxlength: '30', 'aria-label': `Nombre de ${p.name}` });
        const actions = h('div', { class: 'pk-actions' });
        // Al borrar, sus movimientos pasan a otro bolsillo que eliges ahí mismo.
        const ask = () => {
          const others = pockets.filter((o) => o.id !== p.id);
          const dest = h('select', { id: `pk-move-${p.id}`, 'aria-label': 'Pasar sus movimientos a' }, others.map((o) => h('option', { value: String(o.id) }, o.name)));
          actions.replaceChildren(h('span', { class: 'pk-ask' }, 'Sus movimientos pasan a:'), dest,
            h('button', { type: 'button', class: 'btn-ghost', onclick: idle }, 'Cancelar'),
            h('button', { type: 'button', class: 'btn-danger', onclick: () => act(() => store.deletePocket(p.id, dest.value), 'Bolsillo borrado') }, 'Sí, borrar'));
        };
        const idle = () => actions.replaceChildren(
          h('button', { type: 'button', onclick: () => {
            const v = name.value.trim(); if (!v || v === p.name) return;
            act(() => store.renamePocket(p.id, v), 'Bolsillo renombrado');
          } }, 'Guardar'),
          pockets.length > 1 ? h('button', { type: 'button', class: 'btn-danger', onclick: ask }, 'Borrar') : null);
        idle();
        return h('div', { class: 'pk-row' }, name, actions);
      });
      const fresh = h('input', { id: 'pk-new', maxlength: '30', placeholder: 'Ej: Inversión, Viajes, Emergencias', 'aria-label': 'Nombre del bolsillo nuevo' });
      return h('div', { class: 'pk-editor' }, rows,
        pockets.length < 8 ? h('form', { class: 'pk-row', onsubmit: (e) => {
          e.preventDefault(); const v = fresh.value.trim(); if (!v) return fresh.focus();
          act(() => store.addPocket(v), 'Bolsillo creado');
        } }, fresh, h('div', { class: 'pk-actions' }, h('button', { type: 'submit', class: 'btn-primary' }, 'Crear bolsillo'))) : null);
    }

    function pocketsSection(pockets) {
      const toggle = h('button', { class: 'btn-ghost btn-sm', 'aria-expanded': String(state.editPockets), onclick: () => { state.editPockets = !state.editPockets; render(); } },
        state.editPockets ? 'Listo' : 'Editar');
      return h('section', { class: 'panel a-pockets', 'aria-label': 'Tus bolsillos' },
        h('div', { class: 'panel-head' }, h('h2', {}, 'Bolsillos'), toggle),
        state.editPockets ? pocketEditor(pockets) : h('div', { class: 'pockets' }, pockets.map(pocketCard)));
    }

    /* ---------- Vistas ---------- */
    async function viewResumen() {
      const [s, budgets, goals] = await Promise.all([store.summary(state.month), store.listBudgets(state.month), store.listGoals()]);
      state.goals = goals;
      state.pockets = s.pockets || [];
      s.byCategory.forEach((c) => { if (!CATS.gasto.includes(c.category)) state.customs.gasto.add(c.category); });
      return [
        ticker(budgets, s.byCategory, s.expense),
        h('div', { class: 'a-hero' }, hero(s)),
        state.pockets.length ? pocketsSection(state.pockets) : null,
        h('section', { class: 'panel a-chart' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Últimos 6 meses'),
            h('div', { class: 'legend' }, h('span', { class: 'in' }, 'Ingresos'), h('span', { class: 'out' }, 'Gastos'))),
          trendChart(s.trend)),
        h('section', { class: 'panel a-cats' }, h('div', { class: 'panel-head' }, h('h2', {}, 'En qué se fue la plata'), s.expense ? h('span', { class: 'muted num' }, cop(s.expense)) : null), categoryBars(s.byCategory, s.expense)),
      ];
    }

    // Una fila por movimiento: se toca para ver el detalle completo y las acciones.
    function txItem(t) {
      const id = `tx-${t.id}`;
      const fecha = new Date(`${t.date}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
      const actions = h('div', { class: 'tx-actions' });
      const idle = () => actions.replaceChildren(h('button', { class: 'btn-danger btn-sm', onclick: ask }, 'Borrar'));
      const ask = () => {
        actions.replaceChildren(h('span', { class: 'tx-ask' }, '¿Borrar este movimiento?'),
          h('button', { class: 'btn-ghost btn-sm', onclick: idle }, 'Cancelar'),
          h('button', { class: 'btn-danger btn-sm', onclick: () => act(() => store.deleteTx(t.id), 'Movimiento borrado') }, 'Sí, borrar'));
        actions.lastChild.focus();
      };
      idle();
      const pocket = state.pockets.find((p) => String(p.id) === String(t.pocket_id));
      const detail = h('div', { class: 'tx-detail', id, hidden: true },
        h('dl', {},
          h('div', {}, h('dt', {}, 'Fecha'), h('dd', {}, fecha.charAt(0).toUpperCase() + fecha.slice(1))),
          h('div', {}, h('dt', {}, t.goal_id ? 'Meta' : 'Categoría'), h('dd', {}, t.goal_id ? `${t.category} (se suma a la meta)` : t.category)),
          pocket ? h('div', {}, h('dt', {}, 'Bolsillo'), h('dd', {}, pocket.name)) : null,
          t.description ? h('div', {}, h('dt', {}, 'Nota'), h('dd', {}, t.description)) : null),
        actions);
      const color = catColor(t.category);
      const row = h('button', {
        class: 'tx-row', 'aria-expanded': 'false', 'aria-controls': id,
        onclick: () => {
          const open = row.getAttribute('aria-expanded') === 'true';
          root.querySelectorAll('.tx-row[aria-expanded="true"]').forEach((r) => {
            r.setAttribute('aria-expanded', 'false'); document.getElementById(r.getAttribute('aria-controls')).hidden = true;
          });
          if (!open) {
            row.setAttribute('aria-expanded', 'true'); detail.hidden = false; idle();
            if (Motion.ok()) window.gsap.from(detail, { height: 0, autoAlpha: 0, duration: 0.35, ease: 'expo.out', clearProps: 'height,opacity,visibility' });
          }
        },
      },
        h('span', { class: 'avatar', style: `color:${color};background:${color}24`, 'aria-hidden': 'true' }, t.category.charAt(0).toUpperCase()),
        h('span', { class: 'tx-main' },
          h('span', { class: 'tx-title' }, t.description || (t.goal_id ? `Ahorro: ${t.category}` : t.category)),
          t.goal_id ? h('span', { class: 'tx-sub tx-goal' }, `Meta: ${t.category}`)
            : t.description ? h('span', { class: 'tx-sub' }, t.category) : null),
        h('span', { class: `tx-amount num ${t.goal_id ? 'goal' : t.type}` }, (t.type === 'gasto' ? '−' : '+') + ' ' + cop(t.amount)));
      return h('li', { class: 'tx' }, row, detail);
    }

    function dayLabel(d) {
      const t = today();
      const y = new Date(); y.setDate(y.getDate() - 1);
      if (d === t) return 'Hoy';
      if (d === `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`) return 'Ayer';
      const s = new Date(`${d}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric' });
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    const emptyAction = (text, label, onclick) => h('div', { class: 'empty' }, h('p', {}, text), h('button', { class: 'btn-primary btn-sm', onclick }, icon('plus'), label));

    async function viewMovimientos() {
      const [txs, goals, pockets] = await Promise.all([store.listTx(state.month), store.listGoals(), store.listPockets()]);
      state.goals = goals;
      state.pockets = pockets;
      learnCustoms(txs);
      const days = [];
      for (const t of txs) {
        if (days.at(-1)?.date !== t.date) days.push({ date: t.date, items: [] });
        days.at(-1).items.push(t);
      }
      const inc = txs.filter((t) => t.type === 'ingreso').reduce((a, t) => a + t.amount, 0);
      const exp = txs.filter((t) => t.type === 'gasto' && !t.goal_id).reduce((a, t) => a + t.amount, 0);
      const sav = txs.filter((t) => t.goal_id).reduce((a, t) => a + t.amount, 0);
      const biggest = txs.filter((t) => t.type === 'gasto' && !t.goal_id).sort((a, b) => b.amount - a.amount)[0];
      return [
        h('section', { class: 'panel a-list' },
          h('div', { class: 'panel-head' }, h('h2', {}, `Movimientos de ${monthOnly(state.month)}`), h('span', { class: 'muted' }, txs.length === 1 ? '1 movimiento' : `${txs.length} movimientos`)),
          txs.length ? h('div', { class: 'days' }, days.map((d) => {
            const net = d.items.reduce((a, t) => a + (t.type === 'ingreso' ? t.amount : -t.amount), 0);
            return h('section', { class: 'day', 'aria-label': dayLabel(d.date) },
              h('div', { class: 'day-head' }, h('span', {}, dayLabel(d.date)),
                h('span', { class: `num ${net >= 0 ? 'pos' : ''}` }, (net >= 0 ? '+' : '−') + ' ' + cop(Math.abs(net)))),
              h('ul', { class: 'tx-list' }, d.items.map(txItem)));
          }))
            : emptyAction('Sin movimientos este mes.', 'Registrar el primero', openTx)),
        h('aside', { class: 'panel a-side month-sheet', 'aria-label': 'Resumen de los movimientos' },
          h('h2', {}, 'El mes en cifras'),
          h('dl', { class: 'stat-list' },
            h('div', { class: 'in' }, h('dt', {}, 'Entró'), h('dd', { class: 'num' }, cop(inc))),
            h('div', { class: 'out' }, h('dt', {}, 'Salió en gastos'), h('dd', { class: 'num' }, cop(exp))),
            h('div', { class: 'goal' }, h('dt', {}, 'Fue a metas'), h('dd', { class: 'num' }, cop(sav))),
            h('div', {}, h('dt', {}, 'Neto'), h('dd', { class: `num ${inc - exp - sav < 0 ? 'neg' : ''}` }, (inc - exp - sav < 0 ? '−' : '') + cop(Math.abs(inc - exp - sav))))),
          biggest ? h('p', { class: 'side-note' }, 'El gasto más grande fue ', h('strong', {}, biggest.description || biggest.category), ` por ${cop(biggest.amount)}.`) : null),
      ];
    }

    function budgetForm() {
      const customs = [...state.customs.gasto].sort((a, b) => a.localeCompare(b, 'es'));
      const amount = moneyInput('bud-amount', 'Ej: 600.000');
      // Tus categorías propias (las que escribiste en "Otros") aparecen como opciones, antes de "Otros".
      const cat = h('select', { id: 'bud-cat' },
        CATS.gasto.filter((c) => c !== 'Otros').map((c) => h('option', {}, c)),
        customs.length ? h('optgroup', { label: 'Tus categorías' }, customs.map((c) => h('option', {}, c))) : null,
        h('option', {}, 'Otros'));
      const other = h('input', { id: 'bud-other', maxlength: '40', autocomplete: 'off', list: 'bud-other-list', placeholder: 'Ej: Gimnasio, mascotas, regalos' });
      const otherField = h('div', { class: 'field span', hidden: true }, h('label', { for: 'bud-other' }, '¿Para qué es?'), other,
        h('datalist', { id: 'bud-other-list' }, customs.map((c) => h('option', { value: c }))));
      cat.addEventListener('change', () => {
        const on = cat.value === 'Otros';
        otherField.hidden = !on; other.required = on;
        if (on) other.focus(); else other.value = '';
      });
      // Por mes o por semana. El semanal se repite solo cada semana desde este mes.
      const amountLabel = h('label', { for: 'bud-amount' });
      const hint = h('p', { class: 'hint span' });
      const setPeriod = (v) => {
        state.budPeriod = v;
        period.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
        amountLabel.textContent = v === 'semana' ? 'Límite semanal' : 'Límite del mes';
        amount.placeholder = v === 'semana' ? 'Ej: 50.000' : 'Ej: 600.000';
        hint.textContent = v === 'semana'
          ? 'Se repite cada semana, de lunes a domingo. Registra tus gastos solo con el nombre (ej: Almuerzos) y la fecha decide la semana.'
          : 'Si ya existe para este mes, se actualiza.';
      };
      const period = h('div', { class: 'seg plain', role: 'group', 'aria-label': 'Cada cuánto' },
        [['mes', 'Por mes'], ['semana', 'Por semana']].map(([v, label]) => h('button', {
          type: 'button', 'data-v': v, 'aria-pressed': String(state.budPeriod === v), onclick: () => setPeriod(v),
        }, label)));
      setPeriod(state.budPeriod);
      return h('form', {
        class: 'quick', onsubmit: (e) => {
          e.preventDefault();
          const v = digits(amount.value); if (!v) { amount.focus(); return toast('Escribe un límite mayor a 0'); }
          let category = cat.value;
          if (category === 'Otros') {
            category = other.value.trim().replace(/\s+/g, ' ');
            if (!category) { other.focus(); return toast('Escribe para qué es el presupuesto'); }
            category = category.charAt(0).toUpperCase() + category.slice(1);
          }
          act(() => store.setBudget({ category, month: state.month, limit_amount: v, period: state.budPeriod }), 'Presupuesto guardado');
        },
      },
        h('div', { class: 'field span' }, period),
        hint,
        h('div', { class: 'field span' }, h('label', { for: 'bud-cat' }, 'Categoría'), cat),
        otherField,
        h('div', { class: 'field span field-amount' }, amountLabel, h('div', { class: 'amount-wrap' }, h('span', { class: 'cur', 'aria-hidden': 'true' }, '$'), amount)),
        h('button', { class: 'btn-primary sheet-cta span', type: 'submit' }, 'Guardar límite'));
    }

    function budgetItem(b) {
      const pct = b.spent / b.limit_amount;
      const level = pct > 1 ? 'over' : pct >= 0.8 ? 'warn' : '';
      const isWeek = b.period === 'semana' && b.week;
      const weekStrip = isWeek ? h('ol', { class: 'week-strip', 'aria-label': 'Semanas del mes' }, b.weeks.map((w) => {
        const wp = w.spent / b.limit_amount;
        const st = w.spent === 0 ? 'wk-none' : wp > 1 ? 'over' : wp >= 0.8 ? 'warn' : 'ok';
        return h('li', { class: `wk ${st}${w.n === b.week.n ? ' current' : ''}`, title: `${rangeLabel(w.start, w.end)}: ${cop(w.spent)} de ${cop(b.limit_amount)}` },
          h('span', { class: 'wk-n' }, `S${w.n}`),
          h('span', { class: 'wk-bar' }, h('span', { style: `transform:scaleY(${Math.min(1, wp)})` })),
          h('span', { class: 'wk-v num' }, w.spent ? compact(w.spent) : '—'));
      })) : null;
      return h('article', { class: `budget ${level}` },
        h('div', { class: 'budget-head' },
          h('h3', {}, b.category),
          h('div', { class: 'budget-tags' }, isWeek ? h('span', { class: 'chip' }, 'Semanal') : null, level ? h('span', { class: `chip ${level}` }, level === 'over' ? 'Pasado' : 'Cerca del límite') : null,
            deleteButton('Borrar presupuesto', () => act(() => store.deleteBudget(b.id), 'Presupuesto borrado')))),
        h('div', { class: 'budget-figs' },
          h('span', { class: 'budget-spent num' }, cop(b.spent)),
          h('span', { class: 'budget-of num' }, `de ${cop(b.limit_amount)}`),
          h('span', { class: `budget-pct num ${level}` }, `${Math.round(pct * 100)}%`)),
        h('div', { class: `meter ${level}` }, h('span', { style: `transform:scaleX(${Math.min(1, pct)})` })),
        h('p', { class: 'budget-note' }, isWeek ? `Semana ${b.week.n} · ${rangeLabel(b.week.start, b.week.end)} · ` : null,
          pct > 1 ? `Te pasaste por ${cop(b.spent - b.limit_amount)}` : `Te quedan ${cop(b.limit_amount - b.spent)}${isWeek ? ' esta semana' : ''}`),
        weekStrip);
    }

    async function viewPresupuestos() {
      const [budgets, txs] = await Promise.all([store.listBudgets(state.month), store.listTx(state.month)]);
      learnCustoms(txs);
      budgets.forEach((b) => { if (!CATS.gasto.includes(b.category)) state.customs.gasto.add(b.category); });
      const openNew = () => openSheet('Nuevo límite', budgetForm());
      const copyPrev = h('button', {
        class: 'btn-ghost btn-sm', onclick: () => act(async () => {
          const prev = await store.listBudgets(shiftMonth(state.month, -1));
          const monthly = prev.filter((b) => b.period !== 'semana'); // los semanales ya se repiten solos
          if (!monthly.length) throw new Error('El mes anterior no tiene presupuestos mensuales para copiar');
          for (const b of monthly) await store.setBudget({ category: b.category, month: state.month, limit_amount: b.limit_amount, period: 'mes' });
        }, 'Copiados del mes anterior'),
      }, icon('copy'), 'Copiar del mes anterior');
      const totalLimit = budgets.filter((b) => b.period !== 'semana').reduce((a, b) => a + b.limit_amount, 0);
      const totalSpent = budgets.filter((b) => b.period !== 'semana').reduce((a, b) => a + b.spent, 0);
      return [
        h('section', { class: 'page-head' },
          h('div', {}, h('h2', {}, `Presupuestos de ${monthOnly(state.month)}`),
            totalLimit ? h('p', { class: 'muted num' }, `${cop(totalSpent)} de ${cop(totalLimit)} en límites mensuales`) : h('p', { class: 'muted' }, 'Ponle tope a lo que más se te va.')),
          h('div', { class: 'page-actions' }, copyPrev, h('button', { class: 'btn-primary btn-sm', id: 'bud-new', onclick: openNew }, icon('plus'), 'Nuevo límite'))),
        budgets.length ? h('div', { class: 'budgets' }, budgets.map(budgetItem))
          : emptyAction('Sin presupuestos este mes. Ponle límite a Mercado o Salidas para empezar.', 'Crear un límite', openNew),
      ];
    }

    function goalForm() {
      const GOALS = ['Fondo de emergencia', 'Viaje', 'Moto', 'Carro', 'Casa propia', 'Estudio', 'Celular o computador', 'Regalo', 'Otros'];
      const kind = h('select', { id: 'goal-kind' }, GOALS.map((g) => h('option', {}, g)));
      const name = h('input', { id: 'goal-name', maxlength: '60', autocomplete: 'off', placeholder: 'Ej: Gimnasio, boda, PlayStation' });
      const nameField = h('div', { class: 'field span', hidden: true }, h('label', { for: 'goal-name' }, '¿Para qué es?'), name);
      kind.addEventListener('change', () => {
        const on = kind.value === 'Otros';
        nameField.hidden = !on; name.required = on;
        if (on) name.focus(); else name.value = '';
      });
      const target = moneyInput('goal-target', 'Ej: 5.000.000');
      const deadline = h('input', { id: 'goal-deadline', type: 'date' });
      return h('form', {
        class: 'quick', onsubmit: (e) => {
          e.preventDefault();
          const v = digits(target.value); if (!v) { target.focus(); return toast('Escribe una meta mayor a 0'); }
          let goalName = kind.value;
          if (goalName === 'Otros') {
            goalName = name.value.trim().replace(/\s+/g, ' ');
            if (!goalName) { name.focus(); return toast('Escribe para qué es la meta'); }
            goalName = goalName.charAt(0).toUpperCase() + goalName.slice(1);
          }
          act(() => store.addGoal({ name: goalName, target: v, ...(deadline.value && { deadline: deadline.value }) }), 'Meta creada');
        },
      },
        h('div', { class: 'field span' }, h('label', { for: 'goal-kind' }, 'Para qué ahorras'), kind),
        nameField,
        h('div', { class: 'field span field-amount' }, h('label', { for: 'goal-target' }, 'Cuánto necesitas'), h('div', { class: 'amount-wrap' }, h('span', { class: 'cur', 'aria-hidden': 'true' }, '$'), target)),
        h('div', { class: 'field span' }, h('label', { for: 'goal-deadline' }, 'Para cuándo (opcional)'), deadline),
        h('button', { class: 'btn-primary sheet-cta span', type: 'submit' }, 'Crear meta'));
    }

    function goalItem(g) {
      const pct = Math.min(1, g.saved / g.target);
      const amt = moneyInput(`goal-amt-${g.id}`, 'Valor');
      amt.required = false;
      const left = Math.max(0, g.target - g.saved);
      const monthly = g.deadline && left ? `Ahorra ${cop(left / monthsLeft(g.deadline))} al mes para llegar a tiempo` : null;
      const move = (sign) => { const v = digits(amt.value); if (!v) { amt.focus(); return toast('Escribe un valor'); } act(() => store.contribute(g.id, sign * v), sign > 0 ? 'Aporte guardado' : 'Retiro guardado'); };
      return h('article', { class: `goal-card${pct >= 1 ? ' done' : ''}` },
        h('div', { class: 'budget-head' }, h('h3', {}, g.name),
          h('div', { class: 'budget-tags' }, pct >= 1 ? h('span', { class: 'chip ok' }, 'Cumplida') : null,
            deleteButton('Borrar meta', () => act(() => store.deleteGoal(g.id), 'Meta borrada')))),
        h('div', { class: 'budget-figs' },
          h('span', { class: 'budget-spent num' }, cop(g.saved)),
          h('span', { class: 'budget-of num' }, `de ${cop(g.target)}`),
          h('span', { class: 'budget-pct num goal-pct' }, `${Math.round(pct * 100)}%`)),
        h('div', { class: 'meter goal-meter' }, h('span', { style: `transform:scaleX(${pct})` })),
        h('p', { class: 'budget-note' }, left ? h('strong', {}, `Te faltan ${cop(left)}`) : 'Meta cumplida',
          g.tx_count ? ` · ${g.tx_count === 1 ? '1 gasto enlazado' : `${g.tx_count} gastos enlazados`}` : null),
        monthly ? h('p', { class: 'budget-note' }, monthly) : null,
        h('div', { class: 'goal-move' },
          h('div', { class: 'amount-wrap sm' }, h('span', { class: 'cur', 'aria-hidden': 'true' }, '$'), amt),
          h('button', { class: 'btn-sm', onclick: () => move(1) }, 'Aportar'),
          h('button', { class: 'btn-ghost btn-sm', onclick: () => move(-1) }, 'Retirar')));
    }

    async function viewMetas() {
      const goals = await store.listGoals();
      state.goals = goals;
      const openNew = () => openSheet('Nueva meta de ahorro', goalForm());
      const saved = goals.reduce((a, g) => a + g.saved, 0);
      const target = goals.reduce((a, g) => a + g.target, 0);
      return [
        h('section', { class: 'page-head' },
          h('div', {}, h('h2', {}, 'Metas de ahorro'),
            goals.length ? h('p', { class: 'muted num' }, `${cop(saved)} ahorrados de ${cop(target)}`) : h('p', { class: 'muted' }, 'Ponle nombre a lo que quieres y ve aportando.')),
          h('div', { class: 'page-actions' }, h('button', { class: 'btn-primary btn-sm', id: 'goal-new', onclick: openNew }, icon('plus'), 'Nueva meta'))),
        goals.length ? h('div', { class: 'budgets' }, goals.map(goalItem))
          : emptyAction('Sin metas aún. Crea una y ve aportando cada quincena.', 'Crear una meta', openNew),
      ];
    }

    /* ---------- Skeletons: la forma de cada sección mientras cargan los datos ---------- */
    const sk = (cls = '', style = '') => h('span', { class: `sk ${cls}`, style, 'aria-hidden': 'true' });
    const skPanel = (cls, ...kids) => h('section', { class: `panel ${cls}` }, sk('sk-line sk-title'), ...kids);
    const skRow = (w) => h('div', { class: 'sk-row' }, sk('sk-avatar'), h('div', { class: 'sk-stack' }, sk('sk-line', `width:${w}`), sk('sk-line', 'width:35%')), sk('sk-line', 'width:5.5em'));
    const skBudget = (w) => h('div', { class: 'budget' }, h('div', { class: 'budget-head' }, sk('sk-line', `width:${w}`), sk('sk-line', 'width:4em')), sk('sk-line sk-fig'), sk('sk-meter'), sk('sk-line', 'width:55%'));
    const skHead = () => h('section', { class: 'page-head' }, h('div', { class: 'sk-stack' }, sk('sk-line sk-title'), sk('sk-line', 'width:14em')), sk('sk-pill'));
    const SKELETONS = {
      resumen: () => [
        h('div', { class: 'ticker sk-ticker' }, sk('sk-line', 'width:6em'), sk('sk-line', 'width:60%')),
        h('div', { class: 'a-hero' }, h('section', { class: 'hero' }, sk('sk-line', 'width:10em'), sk('sk-big'), sk('sk-line', 'width:14em'), sk('sk-meter'),
          h('div', { class: 'flows' }, [0, 1, 2].map(() => h('div', { class: 'sk-stack' }, sk('sk-line', 'width:4em'), sk('sk-line', 'width:7em')))))),
        skPanel('a-pockets', h('div', { class: 'pockets' }, [0, 1].map(() => h('div', { class: 'pocket' }, sk('sk-line', 'width:7em'), sk('sk-line sk-fig'), sk('sk-meter'), sk('sk-line', 'width:80%'))))),
        skPanel('a-chart', sk('sk-chart')),
        skPanel('a-cats', ...['70%', '55%', '40%', '30%'].map((w) => h('div', { class: 'sk-stack' }, sk('sk-line', `width:${w}`), sk('sk-meter')))),
      ],
      movimientos: () => [
        skPanel('a-list', h('div', { class: 'days' }, h('div', { class: 'day-head' }, sk('sk-line', 'width:3em'), sk('sk-line', 'width:6em')), ...['60%', '45%', '70%', '50%', '40%'].map(skRow))),
        skPanel('a-side', ...[0, 1, 2, 3].map(() => h('div', { class: 'sk-pair' }, sk('sk-line', 'width:6em'), sk('sk-line', 'width:7em')))),
      ],
      presupuestos: () => [skHead(), h('div', { class: 'budgets' }, ['30%', '40%', '25%'].map(skBudget))],
      metas: () => [skHead(), h('div', { class: 'budgets' }, ['35%', '45%'].map(skBudget))],
    };
    const skeleton = () => SKELETONS[state.tab]();

    const views = { resumen: viewResumen, movimientos: viewMovimientos, presupuestos: viewPresupuestos, metas: viewMetas };
    let pending = null;
    const shell = (body, { enter = false, loading = false } = {}) => {
      Motion.killAll();
      const view = h('main', { class: `view view-${state.tab}`, id: 'view', 'aria-busy': loading ? 'true' : null, 'aria-label': loading ? 'Cargando' : null }, ...body);
      root.replaceChildren(h('div', { class: 'app' }, nav(), h('div', { class: 'main' }, header(), view)));
      if (loading) return;
      if (enter) Motion.enter(view);
      view.querySelectorAll('[data-count]').forEach((el) => Motion.count(el, enter ? 0 : Number(el.dataset.from), Number(el.dataset.count), int));
      Motion.ticker(view.querySelector('.ticker'));
      if ('nextShown' in state) { state.shown = state.nextShown; delete state.nextShown; }
    };
    // Al navegar se muestra el skeleton solo si los datos tardan más de 150 ms (así no parpadea).
    // Al guardar o borrar no hay skeleton: se queda la pantalla actual hasta que llegan los datos.
    async function render(opts = {}) {
      if (busy) { pending = opts.skeleton ? opts : (pending || opts); return; }
      busy = true;
      let timer = null;
      if (opts.skeleton) {
        if (opts.now) shell(skeleton(), { loading: true });
        else timer = setTimeout(() => shell(skeleton(), { loading: true }), 150);
      }
      try {
        const body = await views[state.tab]();
        clearTimeout(timer);
        const focusId = document.activeElement?.id;
        shell(body, { enter: !!opts.skeleton });
        if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
      } catch (e) {
        clearTimeout(timer);
        shell([h('p', { class: 'empty' }, e.message || 'No se pudieron cargar los datos.')]);
      } finally {
        busy = false;
        if (pending) { const next = pending; pending = null; render(next); }
      }
    }
    function go(changes) { Object.assign(state, changes); render({ skeleton: true }); }
    store.onChange?.(() => render());
    render({ skeleton: true, now: true });
    return { render };
  }

  return { mount, h, toast, logo, Motion, splitWeek, weeksOfMonth, referenceWeek };
})();
