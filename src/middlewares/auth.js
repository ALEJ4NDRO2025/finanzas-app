'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const ApiError = require('../utils/ApiError');

// Verifica el JWT de acceso que viaja en cookie httpOnly (inaccesible para JS → protege de XSS).
function requireAuth(req, res, next) {
  const token = req.cookies.access_token;
  if (!token) return next(new ApiError(401, 'No autenticado'));
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: 'finanzas-app' });
    req.userId = Number(payload.sub);
    next();
  } catch {
    next(new ApiError(401, 'Sesión expirada'));
  }
}

module.exports = { requireAuth };
