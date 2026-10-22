'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

const dbPath = process.env.DB_PATH || (env === 'test' ? ':memory:' : './data/finanzas.db');

// Secreto para firmar sesiones. Orden: variable JWT_SECRET (si tiene 32+ caracteres) →
// archivo jwt.key junto a la base (se genera solo la primera vez, nunca sale del servidor).
function loadSecret() {
  const fromEnv = process.env.JWT_SECRET || '';
  if (fromEnv.length >= 32) return fromEnv;
  if (fromEnv) throw new Error('JWT_SECRET debe tener mínimo 32 caracteres (o déjalo vacío para usar el archivo).');
  if (dbPath === ':memory:') return crypto.randomBytes(48).toString('hex');
  const keyPath = path.join(path.dirname(path.resolve(dbPath)), 'jwt.key');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  try { return fs.readFileSync(keyPath, 'utf8').trim(); } catch { /* primera vez */ }
  const key = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(keyPath, key, { mode: 0o600, flag: 'wx' });
  return key;
}

module.exports = {
  env,
  isProd,
  isTest: env === 'test',
  port: Number(process.env.PORT) || 3000,
  dbPath,
  jwtSecret: loadSecret(),
  accessTtlSec: 15 * 60, // 15 minutos
  refreshTtlSec: 7 * 24 * 60 * 60, // 7 días
  bcryptRounds: env === 'test' ? 4 : 12,
  maxFailedLogins: 5, // por correo + IP
  maxFailedPerEmail: 100, // por correo desde cualquier IP, por hora (fuerza bruta distribuida)
  refreshGraceSec: 10,
  lockMinutes: 15,
  // Orígenes permitidos para peticiones que modifican datos (defensa extra contra CSRF)
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};
