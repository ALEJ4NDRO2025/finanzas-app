'use strict';
const app = require('./app');
const config = require('./config');

const server = app.listen(config.port, () => {
  console.log(`Finanzas lista en http://localhost:${config.port} (${config.env})`);
});

// Cierre ordenado (Render envía SIGTERM al redesplegar).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
