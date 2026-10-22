'use strict';
const { rateLimit } = require('express-rate-limit');
const config = require('../config');

const common = { standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Demasiadas peticiones, intenta más tarde' } };

// Límite general para toda la API.
const apiLimiter = rateLimit({ ...common, windowMs: 60 * 1000, limit: config.isTest ? 1000 : 120 });

// Login/registro: solo cuentan los intentos fallidos (frena fuerza bruta).
const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 50 : 10,
  skipSuccessfulRequests: true,
});

module.exports = { apiLimiter, authLimiter };
