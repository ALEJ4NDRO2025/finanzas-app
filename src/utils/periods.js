'use strict';
// Reglas de categorías y semanas. La misma lógica vive en el frontend de Claude (store-claude.js).

// "Almuerzos semana 2", "almuerzos sem 3", "Almuerzos - S4" → { category: 'Almuerzos', week: 'Semana 2' }.
// La semana real la decide la fecha; el número que escribiste se guarda como nota si no había nota.
const WEEK_SUFFIX = /^(.*?)[\s\-–—_:,.(]*\b(?:semana|sem|s)\.?\s*(\d{1,2})\)?\s*$/i;
function splitWeek(category) {
  const m = String(category).trim().match(WEEK_SUFFIX);
  if (!m || !m[1].trim()) return { category: String(category).trim(), week: null };
  const base = m[1].trim().replace(/\s+/g, ' ');
  return { category: base.charAt(0).toUpperCase() + base.slice(1), week: `Semana ${Number(m[2])}` };
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
// Hoy en Colombia (el servidor corre en UTC).
const todayCO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

// Semanas de lunes a domingo que tocan el mes (la primera puede empezar el mes anterior y la última terminar en el siguiente).
function weeksOfMonth(month) {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const last = iso(new Date(Date.UTC(y, m, 0)));
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
  const weeks = [];
  for (let start = addDays(first, -dow); start <= last; start = addDays(start, 7)) {
    weeks.push({ n: weeks.length + 1, start, end: addDays(start, 6) });
  }
  return weeks;
}

// La semana que se resalta: la de hoy si estás viendo el mes actual; si no, la última (mes pasado) o la primera (mes futuro).
function referenceWeek(weeks, today = todayCO()) {
  return weeks.find((w) => w.start <= today && today <= w.end)
    ?? (today > weeks.at(-1).end ? weeks.at(-1) : weeks[0]);
}

module.exports = { splitWeek, weeksOfMonth, referenceWeek, todayCO };
