'use strict';
const config = require('../config');
const ApiError = require('../utils/ApiError');

function notFound(req, res, next) {
  next(new ApiError(404, 'Ruta no encontrada'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // JSON mal formado o cuerpo demasiado grande
  if (err.type === 'entity.parse.failed') err = new ApiError(400, 'JSON inválido');
  if (err.type === 'entity.too.large') err = new ApiError(413, 'Cuerpo demasiado grande');

  const status = err.isOperational ? err.status : 500;
  if (status >= 500 && !config.isTest) console.error(req.id, err);

  // Navegador pidiendo una página (no la API): 404 o 500 con la marca y el status correcto.
  const pages = req.app.locals.pages;
  const wantsPage = pages && !req.originalUrl.startsWith('/api') && ['GET', 'HEAD'].includes(req.method)
    && req.accepts(['json', 'html']) === 'html';
  if (wantsPage && (status === 404 || status >= 500)) {
    const html = status === 404 ? pages[404] : pages[500].replace('__REQ__', String(req.id ?? '').replace(/[^\w-]/g, ''));
    return res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  }

  // Nunca se filtran stack traces ni mensajes internos al cliente.
  res.status(status).json({
    error: err.isOperational ? err.message : 'Error interno',
    ...(err.details && { detalles: err.details }),
    requestId: req.id,
  });
}

module.exports = { notFound, errorHandler };
