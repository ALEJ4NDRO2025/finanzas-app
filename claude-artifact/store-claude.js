/* Versión publicada en Claude: los datos viven en la base del artifact, en el espacio
   privado de cada persona (data/users/<id>), que nadie más puede leer — ni el dueño. */
'use strict';
(async () => {
  const { h, mount, splitWeek, weeksOfMonth, referenceWeek } = FinanzasUI;
  const root = document.getElementById('app');
  const notice = (title, text) => root.replaceChildren(h('div', { class: 'wrap' },
    h('main', { class: 'auth panel' }, h('h1', {}, title), h('p', { class: 'muted', style: 'margin:0' }, text))));

  const [db, user] = await Promise.all([window.claude?.use?.('db'), window.claude?.use?.('user')]);
  const uid = user ? await user.id() : null;
  if (!db || !uid) return notice('Mis Finanzas', 'Inicia sesión en Claude para guardar tus finanzas. Tus datos quedan privados en tu cuenta.');

  const col = db.collection('data/users/' + uid);
  let docs = [];
  const listeners = new Set();
  let firstLoad;
  const loaded = new Promise((r) => { firstLoad = r; });
  col.onSnapshot((snap) => {
    docs = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
    firstLoad();
    listeners.forEach((fn) => fn());
  }, () => notice('Mis Finanzas', 'Se perdió la conexión con tus datos. Recarga la página.'));
  await loaded;

  const pad = (n) => String(n).padStart(2, '0');
  // Id único para documentos nuevos (randomUUID solo existe en https; respaldo con getRandomValues).
  const newId = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const ofKind = (k) => docs.filter((d) => d.kind === k);
  const check = (cond, msg) => { if (!cond) throw new Error(msg); };
  const okMoney = (n) => Number.isInteger(n) && n > 0 && n <= 100_000_000_000;
  const okDay = (s) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
  const okMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  const txOf = (m) => ofKind('tx').filter((t) => t.date.slice(0, 7) === m);
  // Bolsillos: arrancan con Sostenimiento y Ahorro (ids fijos, así dos pestañas no los duplican).
  // Los movimientos sin bolsillo se reparten al leer, con las mismas reglas del servidor.
  const SALARY = ['Salario', 'Prima'];
  const fold = (n) => n.normalize('NFC').toLocaleLowerCase('es');
  const pocketsList = () => ofKind('pocket').sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((p) => ({ id: p._id, name: p.name }));
  const defaultPocketId = (t, pockets) => {
    const find = (n) => pockets.find((p) => fold(p.name) === n);
    const living = find('sostenimiento') ?? pockets[0];
    const saving = find('ahorro') ?? pockets.at(-1);
    if (t.type === 'ingreso') return (SALARY.includes(t.category) ? living : saving).id;
    return (t.goal_id ? saving : living).id;
  };
  const pocketOf = (t, pockets = pocketsList()) => (pockets.some((p) => p.id === t.pocket_id) ? t.pocket_id : defaultPocketId(t, pockets));
  const FLOWS = (txs) => ({
    income: txs.filter((t) => t.type === 'ingreso').reduce((a, t) => a + t.amount, 0),
    expense: txs.filter((t) => t.type === 'gasto' && !t.goal_id).reduce((a, t) => a + t.amount, 0),
    saved: txs.filter((t) => t.type === 'gasto' && t.goal_id).reduce((a, t) => a + t.amount, 0),
  });

  const writeFail = (e) => { throw new Error(e?.code === 'quota_exceeded' ? 'Se llenó el espacio de datos. Borra movimientos viejos.' : 'No se pudo guardar. Intenta de nuevo.'); };

  const store = {
    onChange: (fn) => listeners.add(fn),
    async summary(m) {
      const txs = txOf(m);
      const { income, expense, saved } = FLOWS(txs);
      const cats = {};
      txs.filter((t) => t.type === 'gasto' && !t.goal_id).forEach((t) => { cats[t.category] = (cats[t.category] || 0) + t.amount; });
      const byCategory = Object.entries(cats).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
      const list = pocketsList();
      const pockets = list.map((p) => {
        const f = FLOWS(txs.filter((t) => pocketOf(t, list) === p.id));
        return { id: p.id, name: p.name, ...f, left: f.income - f.expense - f.saved };
      });
      const [y, mo] = m.split('-').map(Number);
      const trend = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(y, mo - 6 + i, 1); const mm = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        return { month: mm, ...FLOWS(txOf(mm)) };
      });
      return { month: m, income, expense, saved, balance: income - expense - saved, byCategory, pockets, trend };
    },
    async listTx(m) {
      const list = pocketsList();
      return txOf(m).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0)).map((t) => ({ ...t, id: t._id, pocket_id: pocketOf(t, list) }));
    },
    async addTx(t) {
      check(['ingreso', 'gasto'].includes(t.type) && okMoney(t.amount) && okDay(t.date) && t.category, 'Revisa el valor y la fecha');
      // "Almuerzos semana 2" → "Almuerzos"; la semana queda como nota si no había nota.
      const parts = splitWeek(t.category);
      let category = parts.category; let goalId = null;
      const description = String(t.description || '').slice(0, 140) || (t.goal_id ? '' : parts.week || '');
      if (t.goal_id) {
        // Igual que el servidor: solo gastos, a una meta tuya, y la categoría es el nombre de la meta.
        check(t.type === 'gasto', 'Solo los gastos se pueden mandar a una meta de ahorro');
        const goal = ofKind('goal').find((g) => g._id === t.goal_id);
        check(goal, 'Meta no encontrada');
        category = goal.name; goalId = goal._id;
      }
      const list = pocketsList();
      let pocketId = t.pocket_id || null;
      if (pocketId) check(list.some((p) => p.id === pocketId), 'Bolsillo no encontrado');
      else pocketId = defaultPocketId({ ...t, goal_id: goalId }, list);
      // Progreso calculado antes de guardar: el snapshot puede tardar en traer el gasto nuevo.
      const before = goalId ? this.goalProgress(goalId) : null;
      await col.doc('tx-' + newId()).set({ kind: 'tx', type: t.type, amount: t.amount, category, date: t.date, goal_id: goalId, pocket_id: pocketId, description, createdAt: Date.now() }).catch(writeFail);
      return before ? { goal: { ...before, saved: before.saved + t.amount, from_tx: before.from_tx + t.amount, tx_count: before.tx_count + 1 } } : {};
    },
    // Lo ahorrado = aportes manuales + gastos enlazados (calculado, así borrar un movimiento ajusta la meta).
    goalProgress(id) {
      const g = ofKind('goal').find((x) => x._id === id);
      const linked = ofKind('tx').filter((t) => t.goal_id === id && t.type === 'gasto');
      const fromTx = linked.reduce((a, t) => a + t.amount, 0);
      return { id, name: g.name, target: g.target, deadline: g.deadline, saved: g.saved + fromTx, from_tx: fromTx, tx_count: linked.length };
    },
    deleteTx: (id) => col.doc(id).delete().catch(writeFail),
    async listPockets() { return pocketsList(); },
    async addPocket(name) {
      const n = String(name).trim().slice(0, 30); check(n, 'Ponle un nombre');
      const label = n.charAt(0).toUpperCase() + n.slice(1);
      const list = pocketsList();
      check(list.length < 8, 'Puedes tener hasta 8 bolsillos');
      check(!list.some((p) => fold(p.name) === fold(label)), 'Ya tienes un bolsillo con ese nombre');
      await col.doc('pk-' + newId()).set({ kind: 'pocket', name: label, position: list.length }).catch(writeFail);
    },
    async renamePocket(id, name) {
      const n = String(name).trim().slice(0, 30); check(n, 'Ponle un nombre');
      const label = n.charAt(0).toUpperCase() + n.slice(1);
      check(!pocketsList().some((p) => p.id !== id && fold(p.name) === fold(label)), 'Ya tienes un bolsillo con ese nombre');
      await col.doc(id).update({ name: label }).catch(writeFail);
    },
    // Sus movimientos pasan al bolsillo elegido (uno por uno: la base no tiene escrituras en lote).
    async deletePocket(id, moveTo) {
      const list = pocketsList();
      check(list.length > 1, 'Necesitas al menos un bolsillo');
      check(moveTo && moveTo !== id && list.some((p) => p.id === moveTo), 'Elige a qué bolsillo pasar sus movimientos');
      for (const t of ofKind('tx').filter((x) => pocketOf(x, list) === id)) {
        await col.doc(t._id).update({ pocket_id: moveTo }).catch(writeFail);
      }
      await col.doc(id).delete().catch(writeFail);
    },
    // Mensual: límite del mes. Semanal: límite por semana (lunes a domingo) que se repite desde su mes.
    async listBudgets(m) {
      const gastos = ofKind('tx').filter((t) => t.type === 'gasto' && !t.goal_id);
      const spentBetween = (cat, from, to) => gastos.filter((t) => t.category === cat && t.date >= from && t.date <= to).reduce((a, t) => a + t.amount, 0);
      const all = ofKind('budget');
      const monthly = all.filter((b) => (b.period || 'mes') === 'mes' && b.month === m);
      const weekly = all.filter((b) => b.period === 'semana' && b.month <= m && !monthly.some((x) => x.category === b.category));
      const weeks = weeksOfMonth(m);
      const ref = referenceWeek(weeks);
      return [
        ...monthly.map((b) => ({ id: b._id, category: b.category, month: b.month, limit_amount: b.limit_amount, period: 'mes', spent: spentBetween(b.category, `${m}-01`, `${m}-31`) })),
        ...weekly.map((b) => {
          const list = weeks.map((w) => ({ ...w, spent: spentBetween(b.category, w.start, w.end) }));
          const cur = list.find((w) => w.n === ref.n);
          return { id: b._id, category: b.category, month: b.month, limit_amount: b.limit_amount, period: 'semana', spent: cur.spent, week: { n: cur.n, start: cur.start, end: cur.end }, weeks: list };
        }),
      ].sort((a, b) => a.category.localeCompare(b.category, 'es'));
    },
    async setBudget(b) {
      check(okMonth(b.month) && okMoney(b.limit_amount) && b.category, 'Revisa el límite');
      const period = b.period === 'semana' ? 'semana' : 'mes';
      const category = splitWeek(b.category).category;
      if (period === 'semana') {
        // Un solo semanal por categoría: se reemplaza el anterior.
        for (const old of ofKind('budget').filter((x) => x.period === 'semana' && x.category === category && x.month !== b.month)) {
          await col.doc(old._id).delete().catch(writeFail);
        }
      }
      await col.doc(`b-${b.month}-${slug(category)}`).set({ kind: 'budget', category, month: b.month, limit_amount: b.limit_amount, period }).catch(writeFail);
    },
    deleteBudget: (id) => col.doc(id).delete().catch(writeFail),
    async listGoals() {
      return ofKind('goal').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map((g) => this.goalProgress(g._id));
    },
    async addGoal(g) {
      check(g.name && okMoney(g.target) && (!g.deadline || okDay(g.deadline)), 'Revisa el nombre y el valor');
      await col.doc('goal-' + newId()).set({ kind: 'goal', name: g.name.slice(0, 60), target: g.target, saved: 0, deadline: g.deadline || null, createdAt: Date.now() }).catch(writeFail);
    },
    async contribute(id, amount) {
      const g = docs.find((d) => d._id === id);
      check(g, 'Meta no encontrada');
      const manual = g.saved + amount;
      if (manual < 0) {
        const p = this.goalProgress(id);
        check(false, p.from_tx > 0 && p.saved + amount >= 0 ? 'Ese dinero entró por movimientos: para sacarlo, borra el movimiento' : 'No puedes retirar más de lo ahorrado');
      }
      await col.doc(id).update({ saved: manual }).catch(writeFail);
    },
    deleteGoal: (id) => col.doc(id).delete().catch(writeFail),
  };

  // Gastos viejos con la semana en el nombre ("Almuerzos SEMANA 2") → "Almuerzos" + nota "Semana 2".
  for (const t of ofKind('tx').filter((x) => !x.goal_id)) {
    const { category, week } = splitWeek(t.category);
    if (week) await col.doc(t._id).update({ category, description: t.description || week }).catch(() => {});
  }
  if (!ofKind('pocket').length) {
    await col.doc('pk-sostenimiento').set({ kind: 'pocket', name: 'Sostenimiento', position: 0 }).catch(() => {});
    await col.doc('pk-ahorro').set({ kind: 'pocket', name: 'Ahorro', position: 1 }).catch(() => {});
  }

  mount(root, store, {});
})();
