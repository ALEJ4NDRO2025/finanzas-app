/* Versión publicada en Claude: los datos viven en la base del artifact, en el espacio
   privado de cada persona (data/users/<id>), que nadie más puede leer — ni el dueño. */
'use strict';
(async () => {
  const { h, mount } = FinanzasUI;
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
  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const ofKind = (k) => docs.filter((d) => d.kind === k);
  const check = (cond, msg) => { if (!cond) throw new Error(msg); };
  const okMoney = (n) => Number.isInteger(n) && n > 0 && n <= 100_000_000_000;
  const okDay = (s) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
  const okMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  const txOf = (m) => ofKind('tx').filter((t) => t.date.slice(0, 7) === m);
  const writeFail = (e) => { throw new Error(e?.code === 'quota_exceeded' ? 'Se llenó el espacio de datos. Borra movimientos viejos.' : 'No se pudo guardar. Intenta de nuevo.'); };

  const store = {
    onChange: (fn) => listeners.add(fn),
    async summary(m) {
      const txs = txOf(m);
      const income = txs.filter((t) => t.type === 'ingreso').reduce((a, t) => a + t.amount, 0);
      const expense = txs.filter((t) => t.type === 'gasto').reduce((a, t) => a + t.amount, 0);
      const cats = {};
      txs.filter((t) => t.type === 'gasto').forEach((t) => { cats[t.category] = (cats[t.category] || 0) + t.amount; });
      const byCategory = Object.entries(cats).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
      const [y, mo] = m.split('-').map(Number);
      const trend = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(y, mo - 6 + i, 1); const mm = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        const t = txOf(mm);
        return { month: mm, income: t.filter((x) => x.type === 'ingreso').reduce((a, x) => a + x.amount, 0), expense: t.filter((x) => x.type === 'gasto').reduce((a, x) => a + x.amount, 0) };
      });
      return { month: m, income, expense, balance: income - expense, byCategory, trend };
    },
    async listTx(m) {
      return txOf(m).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0)).map((t) => ({ ...t, id: t._id }));
    },
    async addTx(t) {
      check(['ingreso', 'gasto'].includes(t.type) && okMoney(t.amount) && okDay(t.date) && t.category, 'Revisa el valor y la fecha');
      let category = t.category; let goalId = null;
      if (t.goal_id) {
        // Igual que el servidor: solo gastos, a una meta tuya, y la categoría es el nombre de la meta.
        check(t.type === 'gasto', 'Solo los gastos se pueden mandar a una meta de ahorro');
        const goal = ofKind('goal').find((g) => g._id === t.goal_id);
        check(goal, 'Meta no encontrada');
        category = goal.name; goalId = goal._id;
      }
      // Progreso calculado antes de guardar: el snapshot puede tardar en traer el gasto nuevo.
      const before = goalId ? this.goalProgress(goalId) : null;
      await col.doc('tx-' + crypto.randomUUID()).set({ kind: 'tx', type: t.type, amount: t.amount, category, date: t.date, goal_id: goalId, description: String(t.description || '').slice(0, 140), createdAt: Date.now() }).catch(writeFail);
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
    async listBudgets(m) {
      const spent = {};
      txOf(m).filter((t) => t.type === 'gasto').forEach((t) => { spent[t.category] = (spent[t.category] || 0) + t.amount; });
      return ofKind('budget').filter((b) => b.month === m).sort((a, b) => a.category.localeCompare(b.category))
        .map((b) => ({ id: b._id, category: b.category, month: b.month, limit_amount: b.limit_amount, spent: spent[b.category] || 0 }));
    },
    async setBudget(b) {
      check(okMonth(b.month) && okMoney(b.limit_amount) && b.category, 'Revisa el límite');
      await col.doc(`b-${b.month}-${slug(b.category)}`).set({ kind: 'budget', ...b }).catch(writeFail);
    },
    deleteBudget: (id) => col.doc(id).delete().catch(writeFail),
    async listGoals() {
      return ofKind('goal').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map((g) => this.goalProgress(g._id));
    },
    async addGoal(g) {
      check(g.name && okMoney(g.target) && (!g.deadline || okDay(g.deadline)), 'Revisa el nombre y el valor');
      await col.doc('goal-' + crypto.randomUUID()).set({ kind: 'goal', name: g.name.slice(0, 60), target: g.target, saved: 0, deadline: g.deadline || null, createdAt: Date.now() }).catch(writeFail);
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

  mount(root, store, {});
})();
