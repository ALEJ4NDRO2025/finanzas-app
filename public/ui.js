/* Interfaz de Finanzas. No sabe de dónde vienen los datos: recibe un "store" con métodos async.
   Todo el texto del usuario se pinta con textContent (nunca innerHTML) → sin XSS. */
'use strict';
const FinanzasUI = (() => {
  const CATS = {
    gasto: ['Mercado', 'Arriendo', 'Servicios', 'Transporte', 'Plan celular', 'Salud', 'Educación', 'Salidas', 'Ropa', 'Deudas', 'Otros'],
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

  function mount(root, store, opts = {}) {
    const state = { month: thisMonth(), tab: 'resumen', txType: 'gasto' };
    let busy = false;

    async function act(fn, okMsg) {
      try { await fn(); if (okMsg) toast(okMsg); await render(); }
      catch (e) { toast(e.message || 'No se pudo guardar'); }
    }

    function header() {
      return h('header', { class: 'top' },
        h('div', { class: 'brand' }, h('h1', {}, opts.userName ? `Hola, ${opts.userName.split(' ')[0]}` : 'Mis Finanzas'), h('small', {}, 'Mis Finanzas')),
        h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, h('div', { class: 'month' },
          h('button', { class: 'icon-btn', 'aria-label': 'Mes anterior', onclick: () => { state.month = shiftMonth(state.month, -1); render(); } }, '‹'),
          h('strong', {}, monthName(state.month)),
          h('button', { class: 'icon-btn', 'aria-label': 'Mes siguiente', onclick: () => { state.month = shiftMonth(state.month, 1); render(); } }, '›'),
          state.month !== thisMonth() ? h('button', { class: 'btn-ghost', onclick: () => { state.month = thisMonth(); render(); } }, 'Hoy') : null),
          opts.onLogout ? h('button', { class: 'btn-ghost', onclick: opts.onLogout }, 'Salir') : null));
    }

    function tabs() {
      const t = [['resumen', 'Resumen'], ['movimientos', 'Movimientos'], ['presupuestos', 'Presupuestos'], ['metas', 'Metas']];
      return h('nav', { class: 'tabs', role: 'tablist' }, t.map(([id, label]) =>
        h('button', { role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => { state.tab = id; render(); } }, label)));
    }

    /* ---------- Registrar movimiento ---------- */
    function txForm() {
      const err = h('p', { class: 'error', hidden: true });
      const amount = moneyInput('tx-amount', '0');
      const cat = h('select', { id: 'tx-cat' }, CATS[state.txType].map((c) => h('option', {}, c)));
      const date = h('input', { id: 'tx-date', type: 'date', value: state.month === thisMonth() ? today() : `${state.month}-01`, required: true });
      const desc = h('input', { id: 'tx-desc', maxlength: '140', placeholder: 'Opcional' });
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
          act(() => store.addTx({ type: state.txType, amount: value, category: cat.value, description: desc.value.trim(), date: date.value }),
            state.txType === 'gasto' ? 'Gasto registrado' : 'Ingreso registrado');
        },
      },
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Tipo'), seg),
        h('div', { class: 'field' }, h('label', { for: 'tx-amount' }, 'Valor (COP)'), amount),
        h('div', { class: 'field' }, h('label', { for: 'tx-cat' }, 'Categoría'), cat),
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

    function balanceCard(s, gmf) {
      const rings = svg('svg', { viewBox: '0 0 300 300', class: 'rings', 'aria-hidden': 'true' });
      [140, 110, 80, 50].forEach((r) => rings.append(svg('circle', { cx: 150, cy: 150, r })));
      const pct = s.income ? Math.round((s.balance / s.income) * 100) : null;
      const [int] = [Math.abs(Math.round(s.balance)).toLocaleString('es-CO')];
      return h('section', { class: `balance-card${s.balance < 0 ? ' negative' : ''}`, 'aria-label': 'Balance del mes' }, rings,
        h('div', { class: 'card-top' }, h('span', {}, `Balance de ${monthName(state.month).split(' ')[0].toLowerCase()}`), h('span', {}, 'COP')),
        h('div', {},
          h('div', { class: 'big num' }, s.balance < 0 ? '−' : null, h('span', { class: 'cur' }, '$'), int),
          h('div', { class: 'sub' }, pct === null ? 'Registra tu primer ingreso para ver cuánto ahorras' : pct >= 0 ? `Ahorras el ${pct}% de lo que entra` : 'Este mes gastaste más de lo que entró')),
        h('div', { class: 'flows' },
          h('div', { class: 'flow' }, h('span', {}, '↓ Entró'), h('span', { class: 'v num' }, cop(s.income))),
          h('div', { class: 'flow' }, h('span', {}, '↑ Salió'), h('span', { class: 'v num' }, cop(s.expense)),
            s.expense ? h('span', { class: 'gmf' }, `4×1000 aprox. ${cop(gmf)}`) : null)));
    }

    /* ---------- Vistas ---------- */
    async function viewResumen() {
      const [s, budgets] = await Promise.all([store.summary(state.month), store.listBudgets(state.month)]);
      const alerts = budgets.filter((b) => b.spent / b.limit_amount >= 0.8);
      const gmf = Math.round(s.expense * 0.004);
      return [
        balanceCard(s, gmf),
        h('section', { class: 'panel', 'aria-label': 'Registrar movimiento' }, h('h2', {}, 'Registrar movimiento'), txForm()),
        alerts.length ? h('section', { class: 'panel' }, h('h2', {}, 'Ojo con estos presupuestos'),
          h('div', { class: 'badge-row' }, alerts.map((b) => h('span', { class: `chip ${b.spent > b.limit_amount ? 'over' : 'warn'}` },
            `${b.category}: ${Math.round((b.spent / b.limit_amount) * 100)}%`)))) : null,
        h('div', { class: 'grid2' },
          h('section', { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h2', {}, 'Últimos 6 meses'),
              h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--income)' }), 'Ingresos'), h('span', {}, h('i', { style: 'background:var(--expense)' }), 'Gastos'))),
            trendChart(s.trend)),
          h('section', { class: 'panel' }, h('h2', {}, 'En qué se fue la plata'), categoryBars(s.byCategory, s.expense))),
      ];
    }

    async function viewMovimientos() {
      const txs = await store.listTx(state.month);
      return [
        h('section', { class: 'panel' }, h('h2', {}, 'Registrar movimiento'), txForm()),
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, `Movimientos de ${monthName(state.month)}`), h('span', { class: 'muted' }, `${txs.length} en total`)),
          txs.length ? h('div', { class: 'list' }, txs.map((t) => h('div', { class: 'row' },
            h('span', { class: 'avatar', style: `background:${catColor(t.category)}`, 'aria-hidden': 'true' }, t.category.charAt(0)),
            h('div', { class: 'what' }, h('div', { style: 'font-weight:700' }, t.description || t.category),
              h('div', { class: 'sub' }, `${t.description ? t.category + ', ' : ''}${Number(t.date.slice(8))} de ${monthName(t.date.slice(0, 7)).split(' ')[0].toLowerCase()}`)),
            h('span', { class: `amount num ${t.type}` }, (t.type === 'gasto' ? '− ' : '+ ') + cop(t.amount)),
            deleteButton('Borrar movimiento', () => act(() => store.deleteTx(t.id), 'Movimiento borrado')))))
            : h('div', { class: 'empty' }, 'Sin movimientos este mes. Registra el primero arriba.')),
      ];
    }

    async function viewPresupuestos() {
      const budgets = await store.listBudgets(state.month);
      const amount = moneyInput('bud-amount', 'Ej: 600.000');
      const cat = h('select', { id: 'bud-cat' }, CATS.gasto.map((c) => h('option', {}, c)));
      const form = h('form', {
        class: 'quick', onsubmit: (e) => {
          e.preventDefault();
          const v = digits(amount.value); if (!v) return toast('Escribe un límite mayor a 0');
          act(() => store.setBudget({ category: cat.value, month: state.month, limit_amount: v }), 'Presupuesto guardado');
        },
      },
        h('div', { class: 'field' }, h('label', { for: 'bud-cat' }, 'Categoría'), cat),
        h('div', { class: 'field' }, h('label', { for: 'bud-amount' }, 'Límite del mes (COP)'), amount),
        h('button', { class: 'btn-primary', type: 'submit' }, 'Guardar límite'));
      const copyPrev = h('button', {
        class: 'btn-ghost', onclick: () => act(async () => {
          const prev = await store.listBudgets(shiftMonth(state.month, -1));
          if (!prev.length) throw new Error('El mes anterior no tiene presupuestos');
          for (const b of prev) await store.setBudget({ category: b.category, month: state.month, limit_amount: b.limit_amount });
        }, 'Copiados del mes anterior'),
      }, 'Copiar del mes anterior');
      return [
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Ponerle límite a una categoría'), copyPrev),
          h('p', { class: 'muted', style: 'margin:0' }, 'Si ya existe para este mes, se actualiza.'), form),
        h('section', { class: 'panel' }, h('h2', {}, `Presupuestos de ${monthName(state.month)}`),
          budgets.length ? h('div', { class: 'list' }, budgets.map((b) => {
            const pct = b.spent / b.limit_amount;
            const level = pct > 1 ? 'over' : pct >= 0.8 ? 'warn' : '';
            return h('div', { class: 'item' },
              h('div', { class: 'item-head' },
                h('span', {}, b.category, ' ', level ? h('span', { class: `chip ${level}` }, level === 'over' ? 'Pasado' : 'Cerca del límite') : null),
                h('span', {}, h('span', { class: 'num' }, `${cop(b.spent)} de ${cop(b.limit_amount)}`),
                  deleteButton('Borrar presupuesto', () => act(() => store.deleteBudget(b.id), 'Presupuesto borrado')))),
              h('div', { class: `meter ${level}` }, h('span', { style: `width:${Math.min(100, pct * 100)}%` })),
              h('span', { class: 'muted', style: 'font-size:.82rem' }, pct > 1 ? `Te pasaste por ${cop(b.spent - b.limit_amount)}` : `Te quedan ${cop(b.limit_amount - b.spent)}`));
          })) : h('div', { class: 'empty' }, 'Sin presupuestos este mes. Ponle límite a Mercado o Salidas para empezar.')),
      ];
    }

    async function viewMetas() {
      const goals = await store.listGoals();
      const name = h('input', { id: 'goal-name', maxlength: '60', placeholder: 'Ej: Moto, fondo de emergencia', required: true });
      const target = moneyInput('goal-target', 'Ej: 5.000.000');
      const deadline = h('input', { id: 'goal-deadline', type: 'date' });
      const form = h('form', {
        class: 'quick', onsubmit: (e) => {
          e.preventDefault();
          const v = digits(target.value); if (!v) return toast('Escribe una meta mayor a 0');
          act(() => store.addGoal({ name: name.value.trim(), target: v, ...(deadline.value && { deadline: deadline.value }) }), 'Meta creada');
        },
      },
        h('div', { class: 'field' }, h('label', { for: 'goal-name' }, 'Para qué ahorras'), name),
        h('div', { class: 'field' }, h('label', { for: 'goal-target' }, 'Cuánto necesitas (COP)'), target),
        h('div', { class: 'field' }, h('label', { for: 'goal-deadline' }, 'Para cuándo'), deadline),
        h('button', { class: 'btn-primary', type: 'submit' }, 'Crear meta'));

      const goalItem = (g) => {
        const pct = Math.min(1, g.saved / g.target);
        const amt = moneyInput(`goal-amt-${g.id}`, 'Valor');
        let monthly = null;
        if (g.deadline && g.saved < g.target) {
          const [y, m] = g.deadline.split('-').map(Number); const n = new Date();
          const months = Math.max(1, (y - n.getFullYear()) * 12 + (m - 1 - n.getMonth()));
          monthly = `Ahorra ${cop((g.target - g.saved) / months)} al mes para llegar a tiempo`;
        }
        const move = (sign) => { const v = digits(amt.value); if (!v) return toast('Escribe un valor'); act(() => store.contribute(g.id, sign * v), sign > 0 ? 'Aporte guardado' : 'Retiro guardado'); };
        return h('div', { class: 'item' },
          h('div', { class: 'item-head' }, h('h3', { style: 'font-size:1rem' }, g.name, pct >= 1 ? ' ' : null, pct >= 1 ? h('span', { class: 'chip' }, 'Cumplida') : null),
            h('span', {}, h('span', { class: 'num' }, `${cop(g.saved)} / ${cop(g.target)}`), deleteButton('Borrar meta', () => act(() => store.deleteGoal(g.id), 'Meta borrada')))),
          h('div', { class: 'meter' }, h('span', { style: `width:${pct * 100}%` })),
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

    const views = { resumen: viewResumen, movimientos: viewMovimientos, presupuestos: viewPresupuestos, metas: viewMetas };
    let pending = false;
    async function render() {
      if (busy) { pending = true; return; }
      busy = true;
      try {
        const body = await views[state.tab]();
        const focusId = document.activeElement?.id;
        root.replaceChildren(h('div', { class: 'wrap' }, header(), tabs(), body));
        if (focusId) document.getElementById(focusId)?.focus();
      } catch (e) {
        root.replaceChildren(h('div', { class: 'wrap' }, header(), tabs(), h('div', { class: 'empty' }, e.message || 'No se pudieron cargar los datos.')));
      } finally {
        busy = false;
        if (pending) { pending = false; render(); }
      }
    }
    store.onChange?.(render);
    render();
    return { render };
  }

  return { mount, h, toast };
})();
