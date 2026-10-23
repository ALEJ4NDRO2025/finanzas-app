'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Montos en pesos enteros (COP) — nunca floats para dinero.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('ingreso','gasto')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  month TEXT NOT NULL,
  limit_amount INTEGER NOT NULL CHECK (limit_amount > 0),
  UNIQUE (user_id, category, month)
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target > 0),
  saved INTEGER NOT NULL DEFAULT 0 CHECK (saved >= 0),
  deadline TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  event TEXT NOT NULL,
  ip TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

CREATE_EXTRA();
function CREATE_EXTRA() {
  // Intentos fallidos por correo+IP y por correo (no depende de que la cuenta exista → no revela correos).
  db.exec(`CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL, locked_until INTEGER
  );`);
  // Migración: momento en que se rotó cada refresh token (para tolerar dos pestañas renovando a la vez).
  const cols = db.prepare('PRAGMA table_info(refresh_tokens)').all().map((c) => c.name);
  if (!cols.includes('rotated_at')) db.exec('ALTER TABLE refresh_tokens ADD COLUMN rotated_at INTEGER');
  const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!ucols.includes('recovery_hash')) db.exec('ALTER TABLE users ADD COLUMN recovery_hash TEXT');
  // Movimientos que alimentan una meta de ahorro. Si la meta se borra, el movimiento queda sin meta.
  const tcols = db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name);
  if (!tcols.includes('goal_id')) db.exec('ALTER TABLE transactions ADD COLUMN goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL');
  // Bolsillos: cada movimiento entra o sale de uno (Sostenimiento, Ahorro, los que cree la persona).
  db.exec(`CREATE TABLE IF NOT EXISTS pockets (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, name COLLATE NOCASE)
  );`);
  if (!tcols.includes('pocket_id')) db.exec('ALTER TABLE transactions ADD COLUMN pocket_id INTEGER REFERENCES pockets(id) ON DELETE SET NULL');
  // Presupuestos: 'mes' (un límite para el mes) o 'semana' (un límite por semana que se repite desde ese mes).
  const bcols = db.prepare('PRAGMA table_info(budgets)').all().map((c) => c.name);
  if (!bcols.includes('period')) db.exec("ALTER TABLE budgets ADD COLUMN period TEXT NOT NULL DEFAULT 'mes'");
}

// Limpieza: tokens vencidos e intentos viejos no se acumulan para siempre.
function purge() {
  const t = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM login_attempts WHERE window_start < ? AND (locked_until IS NULL OR locked_until < ?)').run(t - 86400, t);
}
purge();
setInterval(purge, 60 * 60 * 1000).unref();

module.exports = db;
