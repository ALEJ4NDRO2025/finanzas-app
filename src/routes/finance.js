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
}).strict();

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
    ? db.prepare('SELECT id, type, amount, category, description, date, goal_id FROM transactions WHERE user_id = ? AND substr(date,1,7) = ? AND type = ? ORDER BY date DESC, id DESC').all(req.userId, m, type)
    : db.prepare('SELECT id, type, amount, category, description, date, goal_id FROM transactions WHERE user_id = ? AND substr(date,1,7) = ? ORDER BY date DESC, id DESC').all(req.userId, m);
  res.json({ transactions: rows });
});

router.post('/transactions', validate({ body: txBody }), (req, res) => {
  const t = linkGoal(req.valid.body, req.userId);
  const { lastInsertRowid } = db.prepare('INSERT INTO transactions (user_id, type, amount, category, description, date, goal_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, t.type, t.amount, t.category, t.description, t.date, t.goal_id);
  res.status(201).json({ transaction: { id: Number(lastInsertRowid), ...t }, goal: t.goal_id ? goalProgress(t.goal_id, req.userId) : undefined });
});

router.put('/transactions/:id', validate({ ...idParam, body: txBody }), (req, res) => {
  ownOr404('transactions', req.valid.params.id, req.userId);
  const t = linkGoal(req.valid.body, req.userId);
  db.prepare('UPDATE transactions SET type = ?, amount = ?, category = ?, description = ?, date = ?, goal_id = ? WHERE id = ? AND user_id = ?')
    .run(t.type, t.amount, t.category, t.description, t.date, t.goal_id, req.valid.params.id, req.userId);
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
      COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = b.user_id AND t.type = 'gasto'
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
router.get('/summary', validate({ query: z.object({ month: month.optional() }).strict() }), (req, res) => {
  const m = req.valid.query.month ?? currentMonth();
  const totals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='ingreso' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN type='gasto' THEN amount END),0) AS expense
    FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?`).get(req.userId, m);
  const byCategory = db.prepare(`SELECT category, SUM(amount) AS total FROM transactions
    WHERE user_id = ? AND type = 'gasto' AND substr(date,1,7) = ? GROUP BY category ORDER BY total DESC`).all(req.userId, m);

  // Últimos 6 meses terminando en el mes elegido.
  const [y, mo] = m.split('-').map(Number);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, mo - 6 + i, 1));
    return d.toISOString().slice(0, 7);
  });
  const trendRows = db.prepare(`SELECT substr(date,1,7) AS month,
      COALESCE(SUM(CASE WHEN type='ingreso' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN type='gasto' THEN amount END),0) AS expense
    FROM transactions WHERE user_id = ? AND substr(date,1,7) BETWEEN ? AND ? GROUP BY 1`).all(req.userId, months[0], months[5]);
  const trend = months.map((mm) => trendRows.find((r) => r.month === mm) ?? { month: mm, income: 0, expense: 0 })
    .map((r) => ({ month: r.month, income: r.income, expense: r.expense }));

  res.json({ month: m, income: totals.income, expense: totals.expense, balance: totals.income - totals.expense, byCategory, trend });
});

module.exports = router;
