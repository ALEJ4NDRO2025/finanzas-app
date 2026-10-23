'use strict';
const crypto = require('node:crypto');
const helmet = require('helmet');
const config = require('../config');
const ApiError = require('../utils/ApiError');

// Cabeceras HTTP seguras. CSP estricta: sin scripts inline ni de terceros.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
    },
  },
  strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'no-referrer' },
});

// ID por petición para rastrear errores en logs sin exponer datos.
function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

// Log mínimo: método, ruta, estado y tiempo. Nunca cuerpos ni cookies.
function requestLogger(req, res, next) {
  if (config.isTest) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${req.id} ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}

// Las rutas de la API no deben quedar en caché de navegador ni de proxies.
function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

// Defensa extra contra CSRF: en peticiones que modifican, el Origin debe ser el propio.
function checkOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // clientes sin navegador; el token CSRF sigue siendo obligatorio
  const self = `${req.protocol}://${req.get('host')}`;
  if (origin === self || config.allowedOrigins.includes(origin)) return next();
  return next(new ApiError(403, 'Origen no permitido'));
}

// Clientes desactualizados: la página vieja sigue llamando a la API. Si no envía la versión actual,
// el servidor le indica recargar y le pide al navegador borrar la caché de este sitio (no las cookies).
function versionCheck(req, res, next) {
  const current = req.app.locals.version;
  if (current && req.get('x-app-version') !== current) {
    res.setHeader('X-App-Reload', '1');
    res.setHeader('Clear-Site-Data', '"cache"');
  }
  next();
}

module.exports = { securityHeaders, requestId, requestLogger, noStore, checkOrigin, versionCheck };
