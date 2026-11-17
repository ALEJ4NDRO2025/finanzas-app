'use strict';
// Lista de cuentas para el dueño de la app, en los logs del servidor.
// Se activa con ADMIN_LIST_USERS=<valor cualquiera>; se imprime una sola vez por valor
// (queda marcado en audit_log). Solo datos de la cuenta y cuántos movimientos tiene,
// nunca el detalle de sus finanzas ni hashes.
module.exports = function adminListUsers(db) {
  const nonce = process.env.ADMIN_LIST_USERS?.trim();
  if (!nonce) return;
  const mark = `admin_list:${nonce.slice(0, 40)}`;
  if (db.prepare('SELECT 1 FROM audit_log WHERE event = ?').get(mark)) return;
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, date(u.created_at, 'unixepoch') AS creada,
      (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS movimientos,
      (SELECT date(MAX(a.at), 'unixepoch') FROM audit_log a WHERE a.user_id = u.id AND a.event = 'login') AS ultimo_login
    FROM users u ORDER BY u.id`).all();
  console.log(`ADMIN cuentas (${rows.length}):`);
  for (const r of rows) console.log(`ADMIN #${r.id} | ${r.name} | ${r.email} | creada ${r.creada} | ${r.movimientos} movimientos | último login ${r.ultimo_login ?? '—'}`);
  db.prepare('INSERT INTO audit_log (user_id, event) VALUES (NULL, ?)').run(mark);
};
