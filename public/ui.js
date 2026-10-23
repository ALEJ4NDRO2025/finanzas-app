/* Interfaz de Finanzas. No sabe de dónde vienen los datos: recibe un "store" con métodos async.
   Todo el texto del usuario se pinta con textContent (nunca innerHTML) → sin XSS. */
'use strict';
const FinanzasUI = (() => {
  const CATS = {
    gasto: ['Mercado', 'Almuerzos', 'Arriendo', 'Servicios', 'Transporte', 'Plan celular', 'Salud', 'Educación', 'Salidas', 'Ropa', 'Deudas', 'Otros'],
    ingreso: ['Salario', 'Freelance', 'Ventas', 'Prima', 'Otros'],
  };

  const PALETTE = ['#8b9cff', '#ffb86b', '#ff8fc7', '#6fd6ff', '#c8a6ff', '#ffd86b', '#7ee0c3', '#ff9f8f', '#b5e86b', '#f0a6ff', '#a3a5b8'];
  const catColor = (c) => { if (CATS.ingreso.includes(c)) return '#5fd3a8'; const all = [...CATS.gasto, ...CATS.ingreso]; const i = all.indexOf(c); return PALETTE[(i >= 0 ? i : [...c].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % PALETTE.length]; };
  const cop = (n) => '$\u00a0' + Math.round(n).toLocaleString('es-CO');
  const compact = (n) => (n >= 1e6 ? (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M'
    : n >= 1e3 ? Math.round(n / 1e3) + ' mil' : String(n));
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const thisMonth = () => today().slice(0, 7);
  const shiftMonth = (m, k) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const monthName = (m, short) => { const [y, mo] = m.split('-').map(Number); const t = new Date(y, mo - 1, 1).toLocaleDateString('es-CO', short ? { month: 'short' } : { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
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

  // Campo de dinero que se formatea solo: 1250000 → 1.250.000
  function moneyInput(id, placeholder) {
    const input = h('input', { id, inputmode: 'numeric', autocomplete: 'off', placeholder, required: true });
    input.addEventListener('input', () => { const n = digits(input.value); input.value = n ? n.toLocaleString('es-CO') : ''; });
    return input;
  }

  function toast(msg) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2200);
  }

  // Borrado con confirmación dentro de la fila (los diálogos del navegador no siempre existen).
  function deleteButton(label, onConfirm) {
    const wrap = h('span');
    const ask = () => {
      wrap.replaceChildren(h('span', { class: 'inline-confirm' }, '¿Borrar?',
        h('button', { class: 'icon-btn', onclick: onConfirm }, 'Sí'),
        h('button', { class: 'icon-btn btn-ghost', onclick: idle }, 'No')));
    };
    const idle = () => wrap.replaceChildren(h('button', { class: 'btn-ghost icon-btn', 'aria-label': label, title: label, onclick: ask }, '×'));
    idle();
    return wrap;
  }

  // Cuánto falta, en meses, para la fecha límite de una meta (mínimo 1).
  function monthsLeft(deadline) {
    const [y, m] = deadline.split('-').map(Number); const n = new Date();
    return Math.max(1, (y - n.getFullYear()) * 12 + (m - 1 - n.getMonth()));
  }

  // Reporte que aparece al mandar dinero a una meta: cuánto llevas y cuánto te falta.
  function goalReport(g, added) {
    const left = Math.max(0, g.target - g.saved);
    const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
    const done = left === 0;
    const close = h('button', { class: 'btn-primary', type: 'button' }, 'Listo');
    const sheet = h('div', { class: 'report-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'report-title' },
      h('div', { class: 'report' },
        h('span', { class: 'report-kicker' }, `+ ${cop(added)} a tu meta`),
        h('h2', { id: 'report-title', class: 'report-title' }, g.name),
        h('div', { class: 'report-ring', style: `--p:${pct}` }, h('span', { class: 'num' }, `${pct}%`)),
        h('dl', { class: 'report-grid' },
          h('div', {}, h('dt', {}, 'Llevas'), h('dd', { class: 'num' }, cop(g.saved))),
          h('div', {}, h('dt', {}, 'Meta'), h('dd', { class: 'num' }, cop(g.target))),
          h('div', { class: done ? 'done' : 'left' }, h('dt', {}, done ? 'Estado' : 'Te faltan'), h('dd', { class: 'num' }, done ? '¡Cumplida!' : cop(left)))),
        !done && g.deadline ? h('p', { class: 'report-note' }, `Ahorra ${cop(left / monthsLeft(g.deadline))} al mes para llegar a tiempo.`) : null,
        done ? h('p', { class: 'report-note' }, 'Llegaste a la meta. Lo que sigas mandando queda como extra.') : null,
        close));
    const shut = () => { sheet.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') shut(); };
    close.addEventListener('click', shut);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) shut(); });
    document.addEventListener('keydown', onKey);
    document.body.append(sheet);
    close.focus();
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

  function mount(root, store, opts = {}) {
    const state = { month: thisMonth(), tab: 'resumen', txType: 'gasto', customs: { gasto: new Set(), ingreso: new Set() }, goals: [], pockets: [], editPockets: false, budPeriod: 'mes' };
    const learnCustoms = (txs) => txs.forEach((t) => { if (!CATS[t.type].includes(t.category)) state.customs[t.type].add(t.category); });
    let busy = false;

    async function act(fn, okMsg) {
      try { await fn(); if (okMsg) toast(okMsg); await render(); }
      catch (e) { toast(e.message || 'No se pudo guardar'); }
    }

    function header() {
      return h('header', { class: 'top' },
        h('div', { class: 'brand' }, h('h1', {}, opts.userName ? `Hola, ${opts.userName.split(' ')[0]}` : 'Mis Finanzas'), h('small', {}, 'Mis Finanzas')),
        h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, h('div', { class: 'month' },
          h('button', { class: 'icon-btn', 'aria-label': 'Mes anterior', onclick: () => go({ month: shiftMonth(state.month, -1) }) }, '‹'),
          h('strong', {}, monthName(state.month)),
          h('button', { class: 'icon-btn', 'aria-label': 'Mes siguiente', onclick: () => go({ month: shiftMonth(state.month, 1) }) }, '›'),
          state.month !== thisMonth() ? h('button', { class: 'btn-ghost', onclick: () => go({ month: thisMonth() }) }, 'Hoy') : null),
          opts.onLogout ? h('button', { class: 'btn-ghost', onclick: opts.onLogout }, 'Salir') : null));
    }

    // Íconos de las pestañas: solo se ven en celular, donde las pestañas pasan a una barra inferior.
    const ICONS = {
      resumen: ['M4 11.5 12 5l8 6.5', 'M6 10v9h12v-9', 'M10 19v-5h4v5'],
      movimientos: ['M7 4v14', 'M3.5 14.5 7 18l3.5-3.5', 'M17 20V6', 'M13.5 9.5 17 6l3.5 3.5'],
      presupuestos: ['M4 18a8 8 0 1 1 16 0', 'M12 18l4-5', 'M12 18h.01'],
      metas: ['M6 21V4', 'M6 4h11l-2 4 2 4H6'],
    };
    const icon = (id) => {
      const el = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'tab-icon' });
      ICONS[id].forEach((d) => el.append(svg('path', { d })));
      return el;
    };

    function tabs() {
      const t = [['resumen', 'Resumen'], ['movimientos', 'Movimientos'], ['presupuestos', 'Presupuestos'], ['metas', 'Metas']];
      return h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Secciones' }, t.map(([id, label]) =>
        h('button', { role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => { go({ tab: id }); window.scrollTo({ top: 0 }); } }, icon(id), h('span', {}, label))));
    }

    /* ---------- Registrar movimiento ---------- */
    function txForm() {
      const err = h('p', { class: 'error', hidden: true });
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
      const otherField = h('div', { class: 'field', hidden: true }, h('label', { for: 'tx-other' }, isGasto ? '¿En qué gastaste?' : '¿De dónde vino?'), other, otherList);
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
          onclick: () => { state.txType = t; form.replaceWith(txForm()); },
        }, t === 'gasto' ? 'Gasto' : 'Ingreso')));
      const form = h('form', {
        class: 'quick', onsubmit: (e) => {
          e.preventDefault();
          const value = digits(amount.value);
          if (!value) { err.textContent = 'Escribe un valor mayor a 0.'; err.hidden = false; return; }
          if (cat.value.startsWith('goal:')) {
            const goal = state.goals.find((g) => `goal:${g.id}` === cat.value);
            act(async () => {
              const r = await store.addTx({ type: 'gasto', amount: value, category: goal.name, goal_id: goal.id, description: desc.value.trim(), date: date.value, ...(pocket.value && { pocket_id: pocket.value }) });
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
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Tipo'), seg),
        h('div', { class: 'field' }, h('label', { for: 'tx-amount' }, 'Valor (COP)'), amount),
        h('div', { class: 'field' }, h('label', { for: 'tx-cat' }, 'Categoría'), cat),
        otherField,
        state.pockets.length ? h('div', { class: 'field' }, h('label', { for: 'tx-pocket' }, state.txType === 'ingreso' ? 'Va al bolsillo' : 'Sale del bolsillo'), pocket) : null,
        h('div', { class: 'field' }, h('label', { for: 'tx-date' }, 'Fecha'), date),
        h('div', { class: 'field' }, h('label', { for: 'tx-desc' }, 'Nota'), desc),
        h('button', { class: 'btn-primary', type: 'submit' }, 'Registrar'),
        err);
      return form;
    }

    /* ---------- Gráficas ---------- */
    function trendChart(trend) {
      const W = 600, H = 240, L = 64, B = 30, T = 14;
      const max = Math.max(1, ...trend.flatMap((t) => [t.income, t.expense]));
      const y = (v) => T + (H - T - B) * (1 - v / max);
      const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Ingresos y gastos de los últimos 6 meses' });
      for (const f of [0, 0.5, 1]) {
        const v = max * f;
        el.append(svg('line', { x1: L, x2: W, y1: y(v), y2: y(v), class: 'grid' }));
        const tx = svg('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }); tx.textContent = compact(v); el.append(tx);
      }
      const band = (W - L) / trend.length, bw = Math.min(22, band / 3.2);
      trend.forEach((t, i) => {
        const cx = L + band * i + band / 2;
        el.append(svg('rect', { x: cx - bw - 2, y: y(t.income), width: bw, height: Math.max(0, y(0) - y(t.income)), rx: Math.min(6, bw / 2), class: 'bar-in' }));
        el.append(svg('rect', { x: cx + 2, y: y(t.expense), width: bw, height: Math.max(0, y(0) - y(t.expense)), rx: Math.min(6, bw / 2), class: 'bar-out' }));
        const lab = svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }); lab.textContent = monthName(t.month, true).replace('.', ''); el.append(lab);
      });
      return h('div', { style: 'overflow-x:auto' }, el);
    }

    function categoryBars(byCategory, total) {
      if (!byCategory.length) return h('div', { class: 'empty' }, 'Aún no hay gastos este mes.');
      const max = byCategory[0].total;
      return h('div', { class: 'list' }, byCategory.map((c) => h('div', { class: 'item' },
        h('div', { class: 'item-head' }, h('span', { class: 'cat-name' }, h('span', { class: 'cat-dot', style: `background:${catColor(c.category)}` }), c.category),
          h('span', { class: 'num', style: 'font-weight:800' }, cop(c.total), h('span', { class: 'muted', style: 'font-weight:600' }, `  ${Math.round((c.total / total) * 100)}%`))),
        h('div', { class: 'meter' }, h('span', { style: `width:${(c.total / max) * 100}%;background:${catColor(c.category)}` })))));
    }

    function balanceCard(s) {
      const rings = svg('svg', { viewBox: '0 0 300 300', class: 'rings', 'aria-hidden': 'true' });
      [140, 110, 80, 50].forEach((r) => rings.append(svg('circle', { cx: 150, cy: 150, r })));
      // "Ahorras" = lo que no se gastó (incluye lo enviado a metas), sobre lo que entró.
      const pct = s.income ? Math.round(((s.income - s.expense) / s.income) * 100) : null;
      const int = Math.abs(Math.round(s.balance)).toLocaleString('es-CO');
      return h('section', { class: `balance-card${s.balance < 0 ? ' negative' : ''}`, 'aria-label': 'Disponible del mes' }, rings,
        h('div', { class: 'card-top' }, h('span', {}, `Disponible en ${monthName(state.month).split(' ')[0].toLowerCase()}`), h('span', {}, 'COP')),
        h('div', {},
          h('div', { class: 'big num' }, s.balance < 0 ? '−' : null, h('span', { class: 'cur' }, '$'), int),
          h('div', { class: 'sub' }, pct === null ? 'Registra tu primer ingreso para ver cuánto ahorras'
            : s.balance < 0 ? 'Este mes salió más de lo que entró' : `Ahorras el ${Math.max(0, pct)}% de lo que entra`)),
        h('div', { class: `flows${s.saved ? ' three' : ''}` },
          h('div', { class: 'flow' }, h('span', {}, '↓ Entró'), h('span', { class: 'v num' }, cop(s.income))),
          h('div', { class: 'flow' }, h('span', {}, '↑ Gastaste'), h('span', { class: 'v num' }, cop(s.expense))),
          s.saved ? h('div', { class: 'flow' }, h('span', {}, '★ A metas'), h('span', { class: 'v num' }, cop(s.saved))) : null));
    }

    /* ---------- Bolsillos ---------- */
    function pocketCard(p) {
      const out = p.expense + p.saved;
      const pct = p.income ? Math.min(100, (out / p.income) * 100) : (out ? 100 : 0);
      const over = p.left < 0;
      return h('article', { class: `pocket${over ? ' over' : ''}` },
        h('div', { class: 'pocket-head' }, h('h3', {}, p.name), h('span', { class: 'pocket-tag' }, over ? 'Te pasaste' : 'Te quedan')),
        h('div', { class: 'pocket-left num' }, (over ? '−' : '') + cop(Math.abs(p.left))),
        h('div', { class: `meter ${over ? 'over' : pct >= 80 ? 'warn' : ''}`, role: 'img', 'aria-label': `Usado ${Math.round(pct)}% de lo que entró` }, h('span', { style: `width:${pct}%` })),
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
      const toggle = h('button', { class: 'btn-ghost', 'aria-expanded': String(state.editPockets), onclick: () => { state.editPockets = !state.editPockets; render(); } },
        state.editPockets ? 'Listo' : 'Editar');
      return h('section', { class: 'panel', 'aria-label': 'Tus bolsillos' },
        h('div', { class: 'panel-head' }, h('h2', {}, 'Tus bolsillos'), toggle),
        state.editPockets ? pocketEditor(pockets) : h('div', { class: 'pockets' }, pockets.map(pocketCard)));
    }

    /* ---------- Vistas ---------- */
    async function viewResumen() {
      const [s, budgets, goals] = await Promise.all([store.summary(state.month), store.listBudgets(state.month), store.listGoals()]);
      state.goals = goals;
      state.pockets = s.pockets || [];
      const alerts = budgets.filter((b) => b.spent / b.limit_amount >= 0.8);
      s.byCategory.forEach((c) => { if (!CATS.gasto.includes(c.category)) state.customs.gasto.add(c.category); });
      return [
        balanceCard(s),
        state.pockets.length ? pocketsSection(state.pockets) : null,
        h('section', { class: 'panel', 'aria-label': 'Registrar movimiento' }, h('h2', {}, 'Registrar movimiento'), txForm()),
        alerts.length ? h('section', { class: 'panel' }, h('h2', {}, 'Ojo con estos presupuestos'),
          h('div', { class: 'badge-row' }, alerts.map((b) => h('span', { class: `chip ${b.spent > b.limit_amount ? 'over' : 'warn'}` },
            `${b.category}${b.period === 'semana' ? ' (esta semana)' : ''}: ${Math.round((b.spent / b.limit_amount) * 100)}%`)))) : null,
        h('div', { class: 'grid2' },
          h('section', { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h2', {}, 'Últimos 6 meses'),
              h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--income)' }), 'Ingresos'), h('span', {}, h('i', { style: 'background:var(--expense)' }), 'Gastos'))),
            trendChart(s.trend)),
          h('section', { class: 'panel' }, h('h2', {}, 'En qué se fue la plata'), categoryBars(s.byCategory, s.expense))),
      ];
    }

    // Una fila por movimiento: se toca para ver el detalle completo y las acciones.
    // Así el título tiene todo el ancho y borrar nunca aplasta la fila.
    function txItem(t) {
      const id = `tx-${t.id}`;
      const fecha = new Date(`${t.date}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
      const actions = h('div', { class: 'tx-actions' });
      const idle = () => actions.replaceChildren(
        h('button', { class: 'btn-danger', onclick: ask }, 'Borrar'));
      const ask = () => {
        actions.replaceChildren(h('span', { class: 'tx-ask' }, '¿Borrar este movimiento?'),
          h('button', { class: 'btn-ghost', onclick: idle }, 'Cancelar'),
          h('button', { class: 'btn-danger', onclick: () => act(() => store.deleteTx(t.id), 'Movimiento borrado') }, 'Sí, borrar'));
        actions.lastChild.focus();
      };
      idle();
      const detail = h('div', { class: 'tx-detail', id, hidden: true },
        h('dl', {},
          h('div', {}, h('dt', {}, 'Fecha'), h('dd', {}, fecha.charAt(0).toUpperCase() + fecha.slice(1))),
          h('div', {}, h('dt', {}, t.goal_id ? 'Meta' : 'Categoría'), h('dd', {}, t.goal_id ? `${t.category} (se suma a la meta)` : t.category)),
          state.pockets.find((p) => String(p.id) === String(t.pocket_id))
            ? h('div', {}, h('dt', {}, 'Bolsillo'), h('dd', {}, state.pockets.find((p) => String(p.id) === String(t.pocket_id)).name)) : null,
          t.description ? h('div', {}, h('dt', {}, 'Nota'), h('dd', {}, t.description)) : null),
        actions);
      const row = h('button', {
        class: 'tx-row', 'aria-expanded': 'false', 'aria-controls': id,
        onclick: () => {
          const open = row.getAttribute('aria-expanded') === 'true';
          root.querySelectorAll('.tx-row[aria-expanded="true"]').forEach((r) => {
            r.setAttribute('aria-expanded', 'false'); document.getElementById(r.getAttribute('aria-controls')).hidden = true;
          });
          if (!open) { row.setAttribute('aria-expanded', 'true'); detail.hidden = false; idle(); }
        },
      },
        h('span', { class: 'avatar', style: `background:${catColor(t.category)}`, 'aria-hidden': 'true' }, t.category.charAt(0).toUpperCase()),
        h('span', { class: 'tx-main' },
          h('span', { class: 'tx-title' }, t.description || (t.goal_id ? `Ahorro: ${t.category}` : t.category)),
          t.goal_id ? h('span', { class: 'tx-sub tx-goal' }, `Meta: ${t.category}`)
            : t.description ? h('span', { class: 'tx-sub' }, t.category) : null),
        h('span', { class: `tx-amount num ${t.type}` }, (t.type === 'gasto' ? '− ' : '+ ') + cop(t.amount)));
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
      return [
        h('section', { class: 'panel' }, h('h2', {}, 'Registrar movimiento'), txForm()),
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, `Movimientos de ${monthName(state.month)}`), h('span', { class: 'muted' }, txs.length === 1 ? '1 movimiento' : `${txs.length} movimientos`)),
          txs.length ? h('div', { class: 'days' }, days.map((d) => {
            const net = d.items.reduce((a, t) => a + (t.type === 'ingreso' ? t.amount : -t.amount), 0);
            return h('section', { class: 'day', 'aria-label': dayLabel(d.date) },
              h('div', { class: 'day-head' }, h('span', {}, dayLabel(d.date)),
                h('span', { class: `num ${net >= 0 ? 'pos' : ''}` }, (net >= 0 ? '+ ' : '− ') + cop(Math.abs(net)))),
              h('ul', { class: 'tx-list' }, d.items.map(txItem)));
          }))
            : h('div', { class: 'empty' }, 'Sin movimientos este mes. Registra el primero arriba.')),
      ];
    }

    async function viewPresupuestos() {
      const [budgets, txs] = await Promise.all([store.listBudgets(state.month), store.listTx(state.month)]);
      learnCustoms(txs);
      budgets.forEach((b) => { if (!CATS.gasto.includes(b.category)) state.customs.gasto.add(b.category); });
      const amount = moneyInput('bud-amount', 'Ej: 600.000');
      // Tus categorías propias (las que escribiste en "Otros") aparecen como opciones, antes de "Otros".
      const customs = [...state.customs.gasto].sort((a, b) => a.localeCompare(b, 'es'));
      const cat = h('select', { id: 'bud-cat' },
        CATS.gasto.filter((c) => c !== 'Otros').map((c) => h('option', {}, c)),
        customs.length ? h('optgroup', { label: 'Tus categorías' }, customs.map((c) => h('option', {}, c))) : null,
        h('option', {}, 'Otros'));
      const other = h('input', { id: 'bud-other', maxlength: '40', autocomplete: 'off', list: 'bud-other-list', placeholder: 'Ej: Gimnasio, mascotas, regalos' });
      const otherField = h('div', { class: 'field', hidden: true }, h('label', { for: 'bud-other' }, '¿Para qué es?'), other,
        h('datalist', { id: 'bud-other-list' }, customs.map((c) => h('option', { value: c }))));
      cat.addEventListener('change', () => {
        const on = cat.value === 'Otros';
        otherField.hidden = !on; other.required = on;
        if (on) other.focus(); else other.value = '';
      });
      // Por mes o por semana. El semanal se repite solo cada semana desde este mes.
      const amountLabel = h('label', { for: 'bud-amount' });
      const hint = h('p', { class: 'muted', style: 'margin:0' });
      const setPeriod = (v) => {
        state.budPeriod = v;
        period.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
        amountLabel.textContent = v === 'semana' ? 'Límite semanal' : 'Límite del mes';
        amount.placeholder = v === 'semana' ? 'Ej: 50.000' : 'Ej: 600.000';
        hint.textContent = v === 'semana'
          ? 'Se repite cada semana, de lunes a domingo. Registra tus gastos solo con el nombre (ej: Almuerzos) y la fecha decide la semana.'
          : 'Si ya existe para este mes, se actualiza.';
      };
      const period = h('div', { class: 'seg', role: 'group', 'aria-label': 'Cada cuánto' },
        [['mes', 'Por mes'], ['semana', 'Por semana']].map(([v, label]) => h('button', {
          type: 'button', 'data-v': v, 'aria-pressed': String(state.budPeriod === v), onclick: () => setPeriod(v),
        }, label)));
      setPeriod(state.budPeriod);
      const form = h('form', {
        class: 'quick', onsubmit: (e) => {
          e.preventDefault();
          const v = digits(amount.value); if (!v) return toast('Escribe un límite mayor a 0');
          let category = cat.value;
          if (category === 'Otros') {
            category = other.value.trim().replace(/\s+/g, ' ');
            if (!category) { other.focus(); return toast('Escribe para qué es el presupuesto'); }
            category = category.charAt(0).toUpperCase() + category.slice(1);
          }
          act(() => store.setBudget({ category, month: state.month, limit_amount: v, period: state.budPeriod }), 'Presupuesto guardado');
        },
      },
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Cada cuánto'), period),
        h('div', { class: 'field' }, h('label', { for: 'bud-cat' }, 'Categoría'), cat),
        otherField,
        h('div', { class: 'field' }, amountLabel, amount),
        h('button', { class: 'btn-primary', type: 'submit' }, 'Guardar límite'));
      const copyPrev = h('button', {
        class: 'btn-ghost', onclick: () => act(async () => {
          const prev = await store.listBudgets(shiftMonth(state.month, -1));
          const monthly = prev.filter((b) => b.period !== 'semana'); // los semanales ya se repiten solos
          if (!monthly.length) throw new Error('El mes anterior no tiene presupuestos mensuales para copiar');
          for (const b of monthly) await store.setBudget({ category: b.category, month: state.month, limit_amount: b.limit_amount, period: 'mes' });
        }, 'Copiados del mes anterior'),
      }, 'Copiar del mes anterior');
      return [
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Ponerle límite a una categoría'), copyPrev),
          hint, form),
        h('section', { class: 'panel' }, h('h2', {}, `Presupuestos de ${monthName(state.month)}`),
          budgets.length ? h('div', { class: 'list' }, budgets.map((b) => {
            const pct = b.spent / b.limit_amount;
            const level = pct > 1 ? 'over' : pct >= 0.8 ? 'warn' : '';
            const isWeek = b.period === 'semana' && b.week;
            const weekStrip = isWeek ? h('ol', { class: 'week-strip', 'aria-label': 'Semanas del mes' }, b.weeks.map((w) => {
              const wp = w.spent / b.limit_amount;
              const st = w.spent === 0 ? 'empty' : wp > 1 ? 'over' : wp >= 0.8 ? 'warn' : 'ok';
              return h('li', { class: `wk ${st}${w.n === b.week.n ? ' current' : ''}`, title: `${rangeLabel(w.start, w.end)}: ${cop(w.spent)} de ${cop(b.limit_amount)}` },
                h('span', { class: 'wk-n' }, `Sem ${w.n}`),
                h('span', { class: 'wk-bar' }, h('span', { style: `height:${Math.min(100, wp * 100)}%` })),
                h('span', { class: 'wk-v num' }, w.spent ? compact(w.spent) : '—'));
            })) : null;
            return h('div', { class: 'item' },
              h('div', { class: 'item-head' },
                h('span', {}, b.category, ' ', isWeek ? h('span', { class: 'chip' }, 'Semanal') : null, ' ', level ? h('span', { class: `chip ${level}` }, level === 'over' ? 'Pasado' : 'Cerca del límite') : null),
                h('span', {}, h('span', { class: 'num' }, `${cop(b.spent)} de ${cop(b.limit_amount)}`),
                  deleteButton('Borrar presupuesto', () => act(() => store.deleteBudget(b.id), 'Presupuesto borrado')))),
              isWeek ? h('span', { class: 'muted', style: 'font-size:.82rem;margin-top:-4px' }, `Semana ${b.week.n} · ${rangeLabel(b.week.start, b.week.end)}`) : null,
              h('div', { class: `meter ${level}` }, h('span', { style: `width:${Math.min(100, pct * 100)}%` })),
              h('span', { class: 'muted', style: 'font-size:.82rem' }, pct > 1 ? `Te pasaste por ${cop(b.spent - b.limit_amount)}` : `Te quedan ${cop(b.limit_amount - b.spent)}${isWeek ? ' esta semana' : ''}`),
              weekStrip);
          })) : h('div', { class: 'empty' }, 'Sin presupuestos este mes. Ponle límite a Mercado o Salidas para empezar.')),
      ];
    }

    async function viewMetas() {
      const goals = await store.listGoals();
      state.goals = goals;
      const GOALS = ['Fondo de emergencia', 'Viaje', 'Moto', 'Carro', 'Casa propia', 'Estudio', 'Celular o computador', 'Regalo', 'Otros'];
      const kind = h('select', { id: 'goal-kind' }, GOALS.map((g) => h('option', {}, g)));
      const name = h('input', { id: 'goal-name', maxlength: '60', autocomplete: 'off', placeholder: 'Ej: Gimnasio, boda, PlayStation' });
      const nameField = h('div', { class: 'field', hidden: true }, h('label', { for: 'goal-name' }, '¿Para qué es?'), name);
      kind.addEventListener('change', () => {
        const on = kind.value === 'Otros';
        nameField.hidden = !on; name.required = on;
        if (on) name.focus(); else name.value = '';
      });
      const target = moneyInput('goal-target', 'Ej: 5.000.000');
      const deadline = h('input', { id: 'goal-deadline', type: 'date' });
      const form = h('form', {
        class: 'quick', onsubmit: (e) => {
          e.preventDefault();
          const v = digits(target.value); if (!v) return toast('Escribe una meta mayor a 0');
          let goalName = kind.value;
          if (goalName === 'Otros') {
            goalName = name.value.trim().replace(/\s+/g, ' ');
            if (!goalName) { name.focus(); return toast('Escribe para qué es la meta'); }
            goalName = goalName.charAt(0).toUpperCase() + goalName.slice(1);
          }
          act(() => store.addGoal({ name: goalName, target: v, ...(deadline.value && { deadline: deadline.value }) }), 'Meta creada');
        },
      },
        h('div', { class: 'field' }, h('label', { for: 'goal-kind' }, 'Para qué ahorras'), kind),
        nameField,
        h('div', { class: 'field' }, h('label', { for: 'goal-target' }, 'Cuánto necesitas (COP)'), target),
        h('div', { class: 'field' }, h('label', { for: 'goal-deadline' }, 'Para cuándo'), deadline),
        h('button', { class: 'btn-primary', type: 'submit' }, 'Crear meta'));

      const goalItem = (g) => {
        const pct = Math.min(1, g.saved / g.target);
        const amt = moneyInput(`goal-amt-${g.id}`, 'Valor');
        const left = Math.max(0, g.target - g.saved);
        const monthly = g.deadline && left ? `Ahorra ${cop(left / monthsLeft(g.deadline))} al mes para llegar a tiempo` : null;
        const move = (sign) => { const v = digits(amt.value); if (!v) return toast('Escribe un valor'); act(() => store.contribute(g.id, sign * v), sign > 0 ? 'Aporte guardado' : 'Retiro guardado'); };
        return h('div', { class: 'item' },
          h('div', { class: 'item-head' }, h('h3', { style: 'font-size:1rem' }, g.name, pct >= 1 ? ' ' : null, pct >= 1 ? h('span', { class: 'chip' }, 'Cumplida') : null),
            h('span', {}, h('span', { class: 'num' }, `${cop(g.saved)} / ${cop(g.target)}`), deleteButton('Borrar meta', () => act(() => store.deleteGoal(g.id), 'Meta borrada')))),
          h('div', { class: 'meter' }, h('span', { style: `width:${pct * 100}%` })),
          h('div', { class: 'goal-facts' },
            left ? h('span', { class: 'goal-left' }, `Te faltan ${cop(left)}`, h('span', { class: 'muted' }, `  ${Math.round(Math.min(1, g.saved / g.target) * 100)}%`)) : null,
            g.tx_count ? h('span', { class: 'muted' }, g.tx_count === 1 ? '1 gasto enlazado' : `${g.tx_count} gastos enlazados`) : null),
          monthly ? h('span', { class: 'muted', style: 'font-size:.82rem' }, monthly) : null,
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, h('div', { style: 'flex:1;min-width:120px' }, amt),
            h('button', { onclick: () => move(1) }, 'Aportar'), h('button', { class: 'btn-ghost', onclick: () => move(-1) }, 'Retirar')));
      };
      return [
        h('section', { class: 'panel' }, h('h2', {}, 'Nueva meta de ahorro'), form),
        h('section', { class: 'panel' }, h('h2', {}, 'Tus metas'),
          goals.length ? h('div', { class: 'list' }, goals.map(goalItem)) : h('div', { class: 'empty' }, 'Sin metas aún. Crea una arriba y ve aportando cada quincena.')),
      ];
    }

    /* ---------- Skeletons: la forma de cada sección mientras cargan los datos ---------- */
    const sk = (cls = '', style = '') => h('span', { class: `sk ${cls}`, style, 'aria-hidden': 'true' });
    const skLines = (...w) => w.map((x) => sk('sk-line', `width:${x}`));
    const skForm = (fields, wideFirst) => h('div', { class: 'quick sk-form' },
      Array.from({ length: fields }, (_, i) => h('div', { class: `field${i === 0 && wideFirst ? ' sk-wide' : ''}` }, sk('sk-line sk-label'), sk('sk-input'))),
      sk('sk-button'));
    const skPanel = (...kids) => h('section', { class: 'panel' }, sk('sk-line sk-title'), ...kids);
    const skRow = (w) => h('div', { class: 'sk-row' }, sk('sk-avatar'), h('div', { class: 'sk-stack' }, ...skLines(w, '35%')), sk('sk-line', 'width:5.5em'));
    const skItem = (w) => h('div', { class: 'item' }, h('div', { class: 'item-head' }, sk('sk-line', `width:${w}`), sk('sk-line', 'width:9em')), sk('sk-meter'), sk('sk-line', 'width:40%'));
    const SKELETONS = {
      resumen: () => [
        h('section', { class: 'balance-card sk-card' }, h('div', { class: 'card-top' }, sk('sk-line', 'width:9em'), sk('sk-line', 'width:2.5em')),
          h('div', { class: 'sk-stack' }, sk('sk-big'), sk('sk-line', 'width:14em')),
          h('div', { class: 'flows' }, sk('sk-flow'), sk('sk-flow'))),
        skPanel(h('div', { class: 'pockets' }, [0, 1].map(() => h('div', { class: 'pocket' }, sk('sk-line', 'width:7em'), sk('sk-line', 'width:9em;height:1.5em'), sk('sk-meter'), sk('sk-line', 'width:80%'))))),
        skPanel(skForm(5, true)),
        h('div', { class: 'grid2' }, skPanel(sk('sk-chart')), skPanel(...['70%', '55%', '40%'].map((w) => h('div', { class: 'item' }, h('div', { class: 'item-head' }, sk('sk-line', `width:${w}`), sk('sk-line', 'width:6em')), sk('sk-meter'))))),
      ],
      movimientos: () => [
        skPanel(skForm(5, true)),
        skPanel(h('div', { class: 'days' }, h('div', { class: 'day-head' }, sk('sk-line', 'width:3em'), sk('sk-line', 'width:6em')), ...['60%', '45%', '70%', '50%', '40%'].map(skRow))),
      ],
      presupuestos: () => [skPanel(skForm(2)), skPanel(h('div', { class: 'list' }, ...['30%', '40%', '25%'].map(skItem)))],
      metas: () => [skPanel(skForm(3, true)), skPanel(h('div', { class: 'list' }, ...['35%', '45%'].map(skItem)))],
    };
    const skeleton = () => h('div', { class: 'sk-view', 'aria-busy': 'true', 'aria-label': 'Cargando' }, SKELETONS[state.tab]());

    const views = { resumen: viewResumen, movimientos: viewMovimientos, presupuestos: viewPresupuestos, metas: viewMetas };
    let pending = null;
    // Al navegar se muestra el skeleton solo si los datos tardan más de 150 ms (así no parpadea).
    // Al guardar o borrar no hay skeleton: se queda la pantalla actual hasta que llegan los datos.
    async function render(opts = {}) {
      if (busy) { pending = opts.skeleton ? opts : (pending || opts); return; }
      busy = true;
      const shell = (...body) => root.replaceChildren(h('div', { class: 'wrap' }, header(), tabs(), ...body));
      let timer = null;
      if (opts.skeleton) {
        if (opts.now) shell(skeleton());
        else timer = setTimeout(() => shell(skeleton()), 150);
      }
      try {
        const body = await views[state.tab]();
        clearTimeout(timer);
        const focusId = document.activeElement?.id;
        shell(body);
        if (focusId) document.getElementById(focusId)?.focus();
      } catch (e) {
        clearTimeout(timer);
        shell(h('div', { class: 'empty' }, e.message || 'No se pudieron cargar los datos.'));
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

  return { mount, h, toast, splitWeek, weeksOfMonth, referenceWeek };
})();
