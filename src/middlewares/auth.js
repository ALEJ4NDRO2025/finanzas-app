'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const ApiError = require('../utils/ApiError');

// Verifica el JWT de acceso que viaja en cookie httpOnly (inaccesible para JS → protege de XSS).
function requireAuth(req, res, next) {
  const token = req.cookies.access_token;
  if (!token) return next(new ApiError(401, 'No autenticado'));
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: 'finanzas-app' });
    // El JWT lleva el id de la sesión: si se cerró (logout o robo detectado) deja de servir al instante.
    const alive = db.prepare('SELECT 1 FROM refresh_tokens WHERE family = ? AND revoked = 0 AND expires_at > ? LIMIT 1')
      .get(String(payload.sid), Math.floor(Date.now() / 1000));
    if (!alive) return next(new ApiError(401, 'Sesión cerrada'));
    req.userId = Number(payload.sub);
    next();
  } catch {
    next(new ApiError(401, 'Sesión expirada'));
  }
}

module.exports = { requireAuth };
