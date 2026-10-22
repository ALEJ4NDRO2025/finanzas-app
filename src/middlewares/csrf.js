'use strict';
const crypto = require('node:crypto');
const config = require('../config');
const ApiError = require('../utils/ApiError');

const COOKIE = 'csrf_token';
const HEADER = 'x-csrf-token';

function issueCsrf(res) {
  const token = crypto.randomBytes(32).toString('hex');
  // Legible por JS (no httpOnly) para que el frontend lo copie en la cabecera.
  res.cookie(COOKIE, token, { sameSite: 'strict', secure: config.isProd, path: '/' });
  return token;
}

// Patrón "double submit": la cookie y la cabecera deben coincidir.
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookie = req.cookies[COOKIE];
  const header = req.get(HEADER);
  if (!cookie || !header || cookie.length !== header.length) {
    return next(new ApiError(403, 'Token CSRF inválido'));
  }
  if (!crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    return next(new ApiError(403, 'Token CSRF inválido'));
  }
  next();
}

module.exports = { issueCsrf, csrfProtection };
