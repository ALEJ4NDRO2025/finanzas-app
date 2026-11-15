'use strict';
// Reemplazo de emergencia del código de recuperación, para cuando el dueño de una cuenta
// pierde contraseña y código. Se activa con dos variables de entorno:
//   ADMIN_RECOVERY_EMAIL  correo de la cuenta
//   ADMIN_RECOVERY_HASH   hash bcrypt del código nuevo (el código en claro nunca llega al servidor)
// Se aplica una sola vez por hash (queda marcado en audit_log), así un reinicio no pisa el código
// nuevo que la persona recibe después de recuperar su cuenta. Con la recuperación normal se
// cierran todas sus sesiones y el código usado queda quemado.
module.exports = function applyAdminRecovery(db) {
  const mail = process.env.ADMIN_RECOVERY_EMAIL?.trim().toLowerCase();
  const hash = process.env.ADMIN_RECOVERY_HASH?.trim();
  if (!mail || !hash) return;
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) { console.warn('ADMIN_RECOVERY_HASH no es un hash bcrypt válido'); return; }
  const mark = `admin_recovery:${hash.slice(-10)}`;
  if (db.prepare('SELECT 1 FROM audit_log WHERE event = ?').get(mark)) return;
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(mail);
  if (!user) { console.warn('ADMIN_RECOVERY_EMAIL: no existe esa cuenta'); return; }
  db.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').run(hash, user.id);
  db.prepare("DELETE FROM login_attempts WHERE key LIKE ?").run(`%:${mail}%`);
  db.prepare('INSERT INTO audit_log (user_id, event) VALUES (?, ?)').run(user.id, mark);
  console.log(`Código de recuperación reemplazado para el usuario ${user.id}`);
};
