'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { securityHeaders, requestId, requestLogger, noStore, checkOrigin, versionCheck } = require('./middlewares/security');
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
app.use('/api', noStore, versionCheck, apiLimiter, checkOrigin, csrfProtection);  // 6-9. sin caché, rate limit, Origin, CSRF
app.use('/api/auth', require('./routes/auth'));
app.use('/api', requireAuth, require('./routes/finance'));          // 10. JWT obligatorio para datos
app.use('/api', notFound);

// Frontend
// La versión es un hash de los archivos del frontend: cambia sola en cada despliegue que los toque.
const PUBLIC = path.join(__dirname, '..', 'public');
const VERSION = crypto.createHash('sha256')
  .update(['index.html', 'styles.css', 'ui.js', 'api.js'].map((f) => fs.readFileSync(path.join(PUBLIC, f))).join(''))
  .digest('hex').slice(0, 10);
const INDEX = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replaceAll('__V__', VERSION);
app.locals.version = VERSION;

// El HTML nunca se guarda en caché; JS y CSS llevan ?v=<hash> en su URL, así que se pueden guardar un año:
// cuando cambian, cambia la URL y el navegador los descarga de nuevo.
const sendIndex = (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('html').send(INDEX); };
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(PUBLIC, {
  index: false,
  setHeaders(res, filePath, stat) {
    const media = /[\\/]media[\\/]/.test(filePath);
    res.setHeader('Cache-Control', media ? 'public, max-age=604800' : 'public, max-age=31536000, immutable');
  },
}));
app.use(notFound);
app.use(errorHandler);

module.exports = app;
