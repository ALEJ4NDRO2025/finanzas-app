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
const { authLimiter, registerLimiter } = require('../middlewares/rateLimiter');
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
  const access = jwt.sign({ sid: family }, config.jwtSecret, {
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
// bcrypt solo usa los primeros 72 bytes: más largo daría una falsa sensación de seguridad.
const max72 = (s) => Buffer.byteLength(s, 'utf8') <= 72;
const password = z.string()
  .min(10, 'Mínimo 10 caracteres')
  .refine(max72, 'Máximo 72 caracteres')
  .regex(/[a-z]/, 'Debe tener una minúscula')
  .regex(/[A-Z]/, 'Debe tener una mayúscula')
  .regex(/\d/, 'Debe tener un número');

// El frontend pide aquí su token CSRF al cargar.
router.get('/csrf', (req, res) => res.json({ csrfToken: issueCsrf(res) }));

router.post('/register', registerLimiter, validate({
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
  body: z.object({ email, password: z.string().min(1).refine(max72, 'Correo o contraseña incorrectos') }).strict(),
}), async (req, res) => {
  const { email: mail, password: pass } = req.valid.body;
  // Bloqueo por correo+IP: un atacante desde otra red no puede bloquearle la cuenta a su dueño.
  // Se cuenta igual exista o no el correo, así la respuesta no revela qué correos están registrados.
  const keys = [`p:${mail}|${req.ip}`, `e:${mail}`];
  const t = now();
  const rows = keys.map((k) => db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(k));
  if (rows.some((r) => r?.locked_until > t)) {
    audit(null, 'login_throttled', req);
    throw new ApiError(429, `Demasiados intentos. Espera ${config.lockMinutes} minutos e intenta de nuevo.`);
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
  const ok = await bcrypt.compare(pass, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    const limits = [config.maxFailedLogins, config.maxFailedPerEmail];
    keys.forEach((k, i) => {
      const r = rows[i];
      const fresh = !r || r.window_start < t - 3600;
      const fails = (fresh ? 0 : r.fails) + 1;
      const lock = fails >= limits[i] ? t + config.lockMinutes * 60 : null;
      db.prepare(`INSERT INTO login_attempts (key, fails, window_start, locked_until) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start, locked_until = excluded.locked_until`)
        .run(k, lock ? 0 : fails, fresh ? t : r.window_start, lock);
    });
    if (user) audit(user.id, 'login_failed', req);
    throw new ApiError(401, 'Correo o contraseña incorrectos'); // mismo mensaje exista o no el correo
  }

  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(keys[0]);
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
  if (row.revoked && row.rotated_at && now() - row.rotated_at <= config.refreshGraceSec) {
    // Otra pestaña acaba de renovar con este mismo token: no es robo, el navegador ya tiene las cookies nuevas.
    return res.status(409).json({ error: 'Sesión renovada en otra pestaña', retry: true });
  }
  if (row.revoked) {
    // Un token ya usado volvió a aparecer: alguien lo copió. Se cierra toda esa cadena de sesión.
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE family = ?').run(row.family);
    audit(row.user_id, 'refresh_reuse_detected', req);
    clearSession(res);
    throw new ApiError(401, 'Sesión invalidada por seguridad');
  }
  db.prepare('UPDATE refresh_tokens SET revoked = 1, rotated_at = ? WHERE id = ?').run(now(), row.id);
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
