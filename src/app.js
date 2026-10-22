'use strict';
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { securityHeaders, requestId, requestLogger, noStore, checkOrigin } = require('./middlewares/security');
const { csrfProtection } = require('./middlewares/csrf');
const { apiLimiter } = require('./middlewares/rateLimiter');
const { requireAuth } = require('./middlewares/auth');
const { notFound, errorHandler } = require('./middlewares/error');

const app = express();

// Detrás del proxy de Render/Railway: necesario para IP real (rate limit) y cookies Secure.
if (config.isProd) app.set('trust proxy', 1);
app.disable('x-powered-by');

// Cadena de middleware, en orden:
app.use(requestId);                         // 1. ID único por petición
app.use(requestLogger);                     // 2. Log sin datos sensibles
app.use(securityHeaders);                   // 3. Helmet + CSP estricta
app.use(express.json({ limit: '10kb' }));   // 4. JSON con tope de tamaño
app.use(cookieParser());                    // 5. Lectura de cookies

app.get('/health', (req, res) => res.json({ ok: true }));

// API
app.use('/api', noStore, apiLimiter, checkOrigin, csrfProtection);  // 6-9. sin caché, rate limit, Origin, CSRF
app.use('/api/auth', require('./routes/auth'));
app.use('/api', requireAuth, require('./routes/finance'));          // 10. JWT obligatorio para datos
app.use('/api', notFound);

// Frontend
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));
app.use(notFound);
app.use(errorHandler);

module.exports = app;
