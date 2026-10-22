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

  // Nunca se filtran stack traces ni mensajes internos al cliente.
  res.status(status).json({
    error: err.isOperational ? err.message : 'Error interno',
    ...(err.details && { detalles: err.details }),
    requestId: req.id,
  });
}

module.exports = { notFound, errorHandler };
