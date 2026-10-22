'use strict';
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const validate = require('../middlewares/validate');
const { requireAuth } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimiter');
const { issueCsrf } = require('../middlewares/csrf');

const router = express.Router();
const now = () => Math.floor(Date.now() / 1000);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Hash ficticio para comparar aunque el usuario no exista (evita enumerar correos por tiempo de respuesta).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-no-real', config.bcryptRounds);

const cookieBase = { httpOnly: true, sameSite: 'strict', secure: config.isProd };

function audit(userId, event, req) {
  db.prepare('INSERT INTO audit_log (user_id, event, ip) VALUES (?, ?, ?)').run(userId ?? null, event, req.ip ?? null);
}

function startSession(res, userId, family = crypto.randomUUID()) {
  const access = jwt.sign({}, config.jwtSecret, {
    subject: String(userId), expiresIn: config.accessTtlSec, issuer: 'finanzas-app', algorithm: 'HS256',
  });
  const refresh = crypto.randomBytes(48).toString('hex');
  // En la base solo guardamos el hash del refresh token, nunca el token.
  db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at) VALUES (?, ?, ?, ?)')
    .run(userId, sha256(refresh), family, now() + config.refreshTtlSec);

  res.cookie('access_token', access, { ...cookieBase, path: '/api', maxAge: config.accessTtlSec * 1000 });
  res.cookie('refresh_token', refresh, { ...cookieBase, path: '/api/auth', maxAge: config.refreshTtlSec * 1000 });
  issueCsrf(res);
}

function clearSession(res) {
  res.clearCookie('access_token', { ...cookieBase, path: '/api' });
  res.clearCookie('refresh_token', { ...cookieBase, path: '/api/auth' });
}

const email = z.string().trim().toLowerCase().email('Correo inválido').max(254);
const password = z.string()
  .min(10, 'Mínimo 10 caracteres')
  .max(128)
  .regex(/[a-z]/, 'Debe tener una minúscula')
  .regex(/[A-Z]/, 'Debe tener una mayúscula')
  .regex(/\d/, 'Debe tener un número');

// El frontend pide aquí su token CSRF al cargar.
router.get('/csrf', (req, res) => res.json({ csrfToken: issueCsrf(res) }));

router.post('/register', authLimiter, validate({
  body: z.object({ name: z.string().trim().min(2).max(60), email, password }).strict(),
}), async (req, res) => {
  const { name, email: mail, password: pass } = req.valid.body;
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail);
  if (exists) throw new ApiError(409, 'No se pudo crear la cuenta con ese correo');
  const hash = await bcrypt.hash(pass, config.bcryptRounds);
  const { lastInsertRowid } = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(mail, name, hash);
  audit(Number(lastInsertRowid), 'register', req);
  startSession(res, Number(lastInsertRowid));
  res.status(201).json({ user: { id: Number(lastInsertRowid), name, email: mail } });
});

router.post('/login', authLimiter, validate({
  body: z.object({ email, password: z.string().min(1).max(128) }).strict(),
}), async (req, res) => {
  const { email: mail, password: pass } = req.valid.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);

  if (user?.locked_until && user.locked_until > now()) {
    audit(user.id, 'login_locked', req);
    throw new ApiError(423, `Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${config.lockMinutes} minutos.`);
  }

  const ok = await bcrypt.compare(pass, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    if (user) {
      const fails = user.failed_logins + 1;
      const lock = fails >= config.maxFailedLogins ? now() + config.lockMinutes * 60 : null;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, user.id);
      audit(user.id, lock ? 'account_locked' : 'login_failed', req);
    }
    throw new ApiError(401, 'Correo o contraseña incorrectos'); // mismo mensaje exista o no el correo
  }

  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
  audit(user.id, 'login', req);
  startSession(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

// Rotación de refresh tokens con detección de reutilización (robo de token).
router.post('/refresh', (req, res) => {
  const token = req.cookies.refresh_token;
  if (!token) throw new ApiError(401, 'No autenticado');
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(sha256(token));
  if (!row || row.expires_at < now()) {
    clearSession(res);
    throw new ApiError(401, 'Sesión expirada');
  }
  if (row.revoked) {
    // Un token ya usado volvió a aparecer: alguien lo copió. Se cierra toda esa cadena de sesión.
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE family = ?').run(row.family);
    audit(row.user_id, 'refresh_reuse_detected', req);
    clearSession(res);
    throw new ApiError(401, 'Sesión invalidada por seguridad');
  }
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id);
  startSession(res, row.user_id, row.family);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const token = req.cookies.refresh_token;
  if (token) {
    const row = db.prepare('SELECT family, user_id FROM refresh_tokens WHERE token_hash = ?').get(sha256(token));
    if (row) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE family = ?').run(row.family);
      audit(row.user_id, 'logout', req);
    }
  }
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.userId);
  if (!user) throw new ApiError(401, 'No autenticado');
  res.json({ user });
});

module.exports = router;
