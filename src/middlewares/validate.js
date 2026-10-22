'use strict';
const { z } = require('zod');
const ApiError = require('../utils/ApiError');

z.config(z.locales.es()); // mensajes de validación en español

// Valida body/params/query con zod. Los esquemas son .strict(): campos de más = rechazo.
// El resultado limpio queda en req.valid (Express 5 no permite reescribir req.query).
const validate = (schemas) => (req, res, next) => {
  req.valid = {};
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ campo: i.path.join('.'), error: i.message }));
      return next(new ApiError(400, 'Datos inválidos', details));
    }
    req.valid[part] = result.data;
  }
  next();
};

module.exports = validate;
