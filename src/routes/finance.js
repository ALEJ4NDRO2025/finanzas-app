'use strict';
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const ApiError = require('../utils/ApiError');
const validate = require('../middlewares/validate');

const router = express.Router();

// Todas las consultas filtran por user_id: un usuario jamás puede leer o tocar datos de otro (anti-IDOR).

const money = z.coerce.number().int('Usa pesos enteros').positive('Debe ser mayor a 0').max(100_000_000_000);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato AAAA-MM');
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Formato AAAA-MM-DD');
const category = z.string().trim().min(1).max(40);
const idParam = { params: z.object({ id: z.coerce.number().int().positive() }).strict() };
const currentMonth = () => new Date().toISOString().slice(0, 7);

function ownOr404(table, id, userId) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!row) throw new ApiError(404, 'No encontrado');
  return row;
}

/* ---------- Movimientos ---------- */
const txBody = z.object({
  type: z.enum(['ingreso', 'gasto']),
  amount: money,
  category,
  description: z.string().trim().max(140).default(''),
  date: day,
  goal_id: z.coerce.number().int().positive().optional(),
  pocket_id: z.coerce.number().int().positive().optional(),
}).strict();

/* ---------- Bolsillos ---------- */
// Cada usuario arranca con Sostenimiento y Ahorro. Sus movimientos sin bolsillo se reparten con las
// mismas reglas que usa la app por defecto: salario y prima → Sostenimiento; otros ingresos → Ahorro;
// gastos normales → Sostenimiento; lo que va a una meta → Ahorro.
const MAX_POCKETS = 8;
const SALARY = ['Salario', 'Prima'];
const seeded = new Set();
const listPockets = (userId) => db.prepare('SELECT id, name FROM pockets WHERE user_id = ? ORDER BY position, id').all(userId);

function pocketRoles(pockets) {
  const find = (n) => pockets.find((p) => p.name.toLowerCase() === n);
  return { living: find('sostenimiento') ?? pockets[0], saving: find('ahorro') ?? pockets.at(-1) };
}
function defaultPocketId(t, pockets) {
  const { living, saving } = pocketRoles(pockets);
  if (t.type === 'ingreso') return (SALARY.includes(t.category) ? living : saving).id;
  return (t.goal_id ? saving : living).id;
}

function ensurePockets(userId) {
  if (seeded.has(userId)) return;
  db.exec('BEGIN');
  try {
    if (!listPockets(userId).length) {
      const ins = db.prepare('INSERT INTO pockets (user_id, name, position) VALUES (?, ?, ?)');
      ins.run(userId, 'Sostenimiento', 0);
      ins.run(userId, 'Ahorro', 1);
    }
    const pockets = listPockets(userId);
    const orphans = db.prepare('SELECT id, type, category, goal_id FROM transactions WHERE user_id = ? AND pocket_id IS NULL').all(userId);
    const upd = db.prepare('UPDATE transactions SET pocket_id = ? WHERE id = ? AND user_id = ?');
    for (const t of orphans) upd.run(defaultPocketId(t, pockets), t.id, userId);
    db.exec('COMMIT');
    seeded.add(userId);
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
router.use((req, res, next) => { ensurePockets(req.userId); next(); });

function pocketFor(t, userId) {
  if (t.pocket_id) { ownOr404('pockets', t.pocket_id, userId); return t.pocket_id; }
  return defaultPocketId(t, listPockets(userId));
}

const pocketName = z.string().trim().min(1, 'Ponle un nombre').max(30).transform((n) => n.charAt(0).toUpperCase() + n.slice(1));
// Comparación sin mayúsculas ni tildes de por medio ("INVERSIÓN" = "Inversión"); SQLite solo pliega ASCII.
const fold = (n) => n.normalize('NFC').toLocaleLowerCase('es');
const nameTaken = (userId, name, exceptId = 0) =>
  listPockets(userId).some((p) => p.id !== exceptId && fold(p.name) === fold(name));

router.get('/pockets', (req, res) => res.json({ pockets: listPockets(req.userId) }));

router.post('/pockets', validate({ body: z.object({ name: pocketName }).strict() }), (req, res) => {
  const pockets = listPockets(req.userId);
  if (pockets.length >= MAX_POCKETS) throw new ApiError(400, `Puedes tener hasta ${MAX_POCKETS} bolsillos`);
  if (nameTaken(req.userId, req.valid.body.name)) throw new ApiError(409, 'Ya tienes un bolsillo con ese nombre');
  const { lastInsertRowid } = db.prepare('INSERT INTO pockets (user_id, name, position) VALUES (?, ?, ?)')
    .run(req.userId, req.valid.body.name, pockets.length);
  res.status(201).json({ pocket: { id: Number(lastInsertRowid), name: req.valid.body.name } });
});

router.patch('/pockets/:id', validate({ ...idParam, body: z.object({ name: pocketName }).strict() }), (req, res) => {
  ownOr404('pockets', req.valid.params.id, req.userId);
  if (nameTaken(req.userId, req.valid.body.name, req.valid.params.id)) throw new ApiError(409, 'Ya tienes un bolsillo con ese nombre');
  db.prepare('UPDATE pockets SET name = ? WHERE id = ? AND user_id = ?').run(req.valid.body.name, req.valid.params.id, req.userId);
  res.json({ pocket: { id: req.valid.params.id, name: req.valid.body.name } });
});

// Borrar un bolsillo: sus movimientos pasan al bolsillo que elijas (move_to). Siempre queda al menos uno.
router.delete('/pockets/:id', validate({
  ...idParam, query: z.object({ move_to: z.coerce.number().int().positive().optional() }).strict(),
}), (req, res) => {
  const { id } = req.valid.params;
  ownOr404('pockets', id, req.userId);
  if (listPockets(req.userId).length <= 1) throw new ApiError(400, 'Necesitas al menos un bolsillo');
  const used = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE pocket_id = ? AND user_id = ?').get(id, req.userId).n;
  const moveTo = req.valid.query.move_to;
  if (used && !moveTo) throw new ApiError(409, 'Ese bolsillo tiene movimientos: elige a qué bolsillo pasarlos');
  if (moveTo) {
    if (moveTo === id) throw new ApiError(400, 'Elige otro bolsillo');
    ownOr404('pockets', moveTo, req.userId);
  }
  db.exec('BEGIN');
  try {
    if (used) db.prepare('UPDATE transactions SET pocket_id = ? WHERE pocket_id = ? AND user_id = ?').run(moveTo, id, req.userId);
    db.prepare('DELETE FROM pockets WHERE id = ? AND user_id = ?').run(id, req.userId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.status(204).end();
});

// Lo ahorrado en una meta = aportes manuales + gastos registrados con esa meta como categoría.
// Se calcula siempre, así borrar o editar un movimiento ajusta la meta solo.
const GOAL_SQL = `SELECT g.id, g.name, g.target, g.deadline, g.saved AS manual,
    COALESCE(SUM(t.amount), 0) AS from_tx, COUNT(t.id) AS tx_count
  FROM goals g LEFT JOIN transactions t ON t.goal_id = g.id AND t.user_id = g.user_id AND t.type = 'gasto'
  WHERE g.user_id = ?`;
const shapeGoal = (g) => g && ({ id: g.id, name: g.name, target: g.target, deadline: g.deadline, saved: g.manual + g.from_tx, from_tx: g.from_tx, tx_count: g.tx_count });
const goalProgress = (id, userId) => shapeGoal(db.prepare(`${GOAL_SQL} AND g.id = ? GROUP BY g.id`).get(userId, id));

// Si el movimiento va a una meta: debe ser un gasto, la meta debe ser tuya y la categoría es el nombre de la meta.
function linkGoal(t, userId) {
  if (!t.goal_id) return { ...t, goal_id: null };
  if (t.type !== 'gasto') throw new ApiError(400, 'Solo los gastos se pueden mandar a una meta de ahorro');
  const goal = ownOr404('goals', t.goal_id, userId);
  return { ...t, category: goal.name };
}

router.get('/transactions', validate({
  query: z.object({ month: month.optional(), type: z.enum(['ingreso', 'gasto']).optional() }).strict(),
}), (req, res) => {
  const { month: m = currentMonth(), type } = req.valid.query;
  const rows = type
    ? db.prepare('SELECT id, type, amount, category, description, date, goal_id, pocket_id FROM transactions WHERE user_id = ? AND substr(date,1,7) = ? AND type = ? ORDER BY date DESC, id DESC').all(req.userId, m, type)
    : db.prepare('SELECT id, type, amount, category, description, date, goal_id, pocket_id FROM transactions WHERE user_id = ? AND substr(date,1,7) = ? ORDER BY date DESC, id DESC').all(req.userId, m);
  res.json({ transactions: rows });
});

router.post('/transactions', validate({ body: txBody }), (req, res) => {
  const t = linkGoal(req.valid.body, req.userId);
  t.pocket_id = pocketFor(t, req.userId);
  const { lastInsertRowid } = db.prepare('INSERT INTO transactions (user_id, type, amount, category, description, date, goal_id, pocket_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, t.type, t.amount, t.category, t.description, t.date, t.goal_id, t.pocket_id);
  res.status(201).json({ transaction: { id: Number(lastInsertRowid), ...t }, goal: t.goal_id ? goalProgress(t.goal_id, req.userId) : undefined });
});

router.put('/transactions/:id', validate({ ...idParam, body: txBody }), (req, res) => {
  ownOr404('transactions', req.valid.params.id, req.userId);
  const t = linkGoal(req.valid.body, req.userId);
  t.pocket_id = pocketFor(t, req.userId);
  db.prepare('UPDATE transactions SET type = ?, amount = ?, category = ?, description = ?, date = ?, goal_id = ?, pocket_id = ? WHERE id = ? AND user_id = ?')
    .run(t.type, t.amount, t.category, t.description, t.date, t.goal_id, t.pocket_id, req.valid.params.id, req.userId);
  res.json({ transaction: { id: req.valid.params.id, ...t } });
});

router.delete('/transactions/:id', validate(idParam), (req, res) => {
  ownOr404('transactions', req.valid.params.id, req.userId);
  db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.valid.params.id, req.userId);
  res.status(204).end();
});

/* ---------- Presupuestos ---------- */
router.get('/budgets', validate({ query: z.object({ month: month.optional() }).strict() }), (req, res) => {
  const m = req.valid.query.month ?? currentMonth();
  const rows = db.prepare(`
    SELECT b.id, b.category, b.month, b.limit_amount,
      COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = b.user_id AND t.type = 'gasto' AND t.goal_id IS NULL
        AND t.category = b.category AND substr(t.date,1,7) = b.month), 0) AS spent
    FROM budgets b WHERE b.user_id = ? AND b.month = ? ORDER BY b.category`).all(req.userId, m);
  res.json({ budgets: rows });
});

// Crear o actualizar (un presupuesto por categoría y mes).
router.put('/budgets', validate({
  body: z.object({ category, month, limit_amount: money }).strict(),
}), (req, res) => {
  const b = req.valid.body;
  db.prepare(`INSERT INTO budgets (user_id, category, month, limit_amount) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, category, month) DO UPDATE SET limit_amount = excluded.limit_amount`)
    .run(req.userId, b.category, b.month, b.limit_amount);
  res.json({ budget: b });
});

router.delete('/budgets/:id', validate(idParam), (req, res) => {
  ownOr404('budgets', req.valid.params.id, req.userId);
  db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(req.valid.params.id, req.userId);
  res.status(204).end();
});

/* ---------- Metas de ahorro ---------- */
router.get('/goals', (req, res) => {
  res.json({ goals: db.prepare(`${GOAL_SQL} GROUP BY g.id ORDER BY g.id`).all(req.userId).map(shapeGoal) });
});

router.post('/goals', validate({
  body: z.object({ name: z.string().trim().min(1).max(60), target: money, deadline: day.optional() }).strict(),
}), (req, res) => {
  const g = req.valid.body;
  const { lastInsertRowid } = db.prepare('INSERT INTO goals (user_id, name, target, deadline) VALUES (?, ?, ?, ?)')
    .run(req.userId, g.name, g.target, g.deadline ?? null);
  res.status(201).json({ goal: goalProgress(Number(lastInsertRowid), req.userId) });
});

// Aportar (positivo) o retirar (negativo) de una meta.
router.post('/goals/:id/contributions', validate({
  ...idParam,
  body: z.object({ amount: z.coerce.number().int().refine((n) => n !== 0, 'No puede ser 0').refine((n) => Math.abs(n) <= 100_000_000_000) }).strict(),
}), (req, res) => {
  const goal = ownOr404('goals', req.valid.params.id, req.userId);
  const manual = goal.saved + req.valid.body.amount;
  if (manual < 0) {
    const p = goalProgress(goal.id, req.userId);
    throw new ApiError(400, p.from_tx > 0 && p.saved + req.valid.body.amount >= 0
      ? 'Ese dinero entró por movimientos: para sacarlo, borra el movimiento'
      : 'No puedes retirar más de lo ahorrado');
  }
  db.prepare('UPDATE goals SET saved = ? WHERE id = ? AND user_id = ?').run(manual, goal.id, req.userId);
  res.json({ goal: goalProgress(goal.id, req.userId) });
});

router.delete('/goals/:id', validate(idParam), (req, res) => {
  ownOr404('goals', req.valid.params.id, req.userId);
  db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(req.valid.params.id, req.userId);
  res.status(204).end();
});

/* ---------- Resumen para el dashboard ---------- */
// Lo que se manda a una meta no es un gasto: es plata que se guarda. Se cuenta aparte como "ahorrado".
const FLOWS = `COALESCE(SUM(CASE WHEN type = 'ingreso' THEN amount END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'gasto' AND goal_id IS NULL THEN amount END), 0) AS expense,
      COALESCE(SUM(CASE WHEN type = 'gasto' AND goal_id IS NOT NULL THEN amount END), 0) AS saved`;

router.get('/summary', validate({ query: z.object({ month: month.optional() }).strict() }), (req, res) => {
  const m = req.valid.query.month ?? currentMonth();
  const totals = db.prepare(`SELECT ${FLOWS} FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?`).get(req.userId, m);
  const byCategory = db.prepare(`SELECT category, SUM(amount) AS total FROM transactions
    WHERE user_id = ? AND type = 'gasto' AND goal_id IS NULL AND substr(date,1,7) = ? GROUP BY category ORDER BY total DESC`).all(req.userId, m);

  // Cada bolsillo: lo que entró, lo que se gastó, lo que se mandó a metas y lo que queda este mes.
  const flowsByPocket = db.prepare(`SELECT pocket_id, ${FLOWS} FROM transactions
    WHERE user_id = ? AND substr(date,1,7) = ? GROUP BY pocket_id`).all(req.userId, m);
  const pockets = listPockets(req.userId).map((p) => {
    const f = flowsByPocket.find((r) => r.pocket_id === p.id) ?? { income: 0, expense: 0, saved: 0 };
    return { id: p.id, name: p.name, income: f.income, expense: f.expense, saved: f.saved, left: f.income - f.expense - f.saved };
  });

  // Últimos 6 meses terminando en el mes elegido.
  const [y, mo] = m.split('-').map(Number);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, mo - 6 + i, 1));
    return d.toISOString().slice(0, 7);
  });
  const trendRows = db.prepare(`SELECT substr(date,1,7) AS month, ${FLOWS}
    FROM transactions WHERE user_id = ? AND substr(date,1,7) BETWEEN ? AND ? GROUP BY 1`).all(req.userId, months[0], months[5]);
  const trend = months.map((mm) => trendRows.find((r) => r.month === mm) ?? { month: mm, income: 0, expense: 0, saved: 0 })
    .map((r) => ({ month: r.month, income: r.income, expense: r.expense, saved: r.saved }));

  res.json({
    month: m, income: totals.income, expense: totals.expense, saved: totals.saved,
    balance: totals.income - totals.expense - totals.saved, byCategory, pockets, trend,
  });
});

module.exports = router;
