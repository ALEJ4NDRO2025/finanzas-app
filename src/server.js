'use strict';
const app = require('./app');
const config = require('./config');
const db = require('./db');

const server = app.listen(config.port, () => {
  console.log(`Finanzas lista en http://localhost:${config.port} (${config.env})`);
});

// Cierre ordenado: Railway/Render envían SIGTERM al reemplazar la versión.
// Se deja de aceptar conexiones, se cierran las inactivas, se cierra la base y se sale con código 0
// (un código distinto de 0 hace que la plataforma lo marque como "crashed").
let closing = false;
function shutdown(sig) {
  if (closing) return;
  closing = true;
  console.log(`${sig} recibido: cerrando`);
  server.close(() => {
    try { db.close(); } catch { /* ya cerrada */ }
    process.exit(0);
  });
  server.closeIdleConnections();
  // Si una petición se queda colgada, no se espera más de 8 s.
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
