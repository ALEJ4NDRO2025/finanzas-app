'use strict';
const crypto = require('node:crypto');

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

// En producción nunca arrancamos con un secreto inventado: si falta, falla el arranque.
if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET es obligatorio en producción (mínimo 32 caracteres).');
}

module.exports = {
  env,
  isProd,
  isTest: env === 'test',
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || (env === 'test' ? ':memory:' : './data/finanzas.db'),
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex'),
  accessTtlSec: 15 * 60, // 15 minutos
  refreshTtlSec: 7 * 24 * 60 * 60, // 7 días
  bcryptRounds: env === 'test' ? 4 : 12,
  maxFailedLogins: 5,
  lockMinutes: 15,
  // Orígenes permitidos para peticiones que modifican datos (defensa extra contra CSRF)
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};
