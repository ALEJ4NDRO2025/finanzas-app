'use strict';
process.env.NODE_ENV = 'test';
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');

// Cliente con cookies persistentes + CSRF, como un navegador.
async function client() {
  const agent = request.agent(app);
  const r = await agent.get('/api/auth/csrf');
  let csrf = r.body.csrfToken;
  // El servidor rota el token CSRF al iniciar sesión; tomamos siempre el último que envió.
  const send = async (method, url, body) => {
    const res = await agent[method](url).set('X-CSRF-Token', csrf).send(body);
    const c = (res.headers['set-cookie'] || []).find((x) => x.startsWith('csrf_token='));
    if (c) csrf = c.split(';')[0].split('=')[1];
    return res;
  };
  return { agent, csrf, send };
}
const PASS = 'ClaveSegura123';

describe('Seguridad', () => {
  test('cabeceras de seguridad presentes', async () => {
    const r = await request(app).get('/health');
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-powered-by'], undefined);
  });

  test('sin token CSRF se rechaza', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' });
    assert.equal(r.status, 403);
  });

  test('Origin ajeno se rechaza', async () => {
    const { agent, csrf } = await client();
    const r = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).set('Origin', 'https://malo.com').send({ email: 'a@b.co', password: 'x' });
    assert.equal(r.status, 403);
  });

  test('sin sesión no hay datos', async () => {
    const r = await request(app).get('/api/transactions');
    assert.equal(r.status, 401);
  });

  test('contraseña débil rechazada', async () => {
    const { send } = await client();
    const r = await send('post', '/api/auth/register', { name: 'Ana', email: 'debil@x.co', password: '123' });
    assert.equal(r.status, 400);
  });

  test('campos extra (mass assignment) rechazados', async () => {
    const { send } = await client();
    const r = await send('post', '/api/auth/register', { name: 'Ana', email: 'extra@x.co', password: PASS, isAdmin: true });
    assert.equal(r.status, 400);
  });

  test('cookies de sesión son httpOnly y SameSite=Strict', async () => {
    const { send } = await client();
    const r = await send('post', '/api/auth/register', { name: 'Ana', email: 'cookies@x.co', password: PASS });
    const access = r.headers['set-cookie'].find((c) => c.startsWith('access_token='));
    assert.match(access, /HttpOnly/);
    assert.match(access, /SameSite=Strict/);
  });

  test('bloqueo tras 5 intentos fallidos desde la misma red', async () => {
    const { send } = await client();
    await send('post', '/api/auth/register', { name: 'Bloq', email: 'bloq@x.co', password: PASS });
    const c = await client();
    for (let i = 0; i < 5; i++) await c.send('post', '/api/auth/login', { email: 'bloq@x.co', password: 'Incorrecta123' });
    const r = await c.send('post', '/api/auth/login', { email: 'bloq@x.co', password: PASS });
    assert.equal(r.status, 429);
  });

  test('un atacante desde otra red no bloquea al dueño', async () => {
    const { send } = await client();
    await send('post', '/api/auth/register', { name: 'Duenio', email: 'duenio@x.co', password: PASS });
    const atk = await client();
    for (let i = 0; i < 6; i++) {
      await atk.agent.post('/api/auth/login').set('X-Forwarded-For', '203.0.113.9').set('X-CSRF-Token', 'x').send({});
    }
    // Simula otra IP: el bloqueo se guarda por correo+IP, así que se prueba directo contra la tabla.
    const db = require('../src/db');
    db.prepare("INSERT INTO login_attempts (key, fails, window_start, locked_until) VALUES ('p:duenio@x.co|203.0.113.9', 0, unixepoch(), unixepoch() + 900)").run();
    const r = await (await client()).send('post', '/api/auth/login', { email: 'duenio@x.co', password: PASS });
    assert.equal(r.status, 200);
  });

  test('un correo inexistente responde igual que uno real (sin enumeración)', async () => {
    const c = await client();
    for (let i = 0; i < 5; i++) await c.send('post', '/api/auth/login', { email: 'fantasma@x.co', password: 'Incorrecta123' });
    const r = await c.send('post', '/api/auth/login', { email: 'fantasma@x.co', password: 'Incorrecta123' });
    assert.equal(r.status, 429);
  });

  test('contraseñas de más de 72 bytes se rechazan', async () => {
    const { send } = await client();
    const r = await send('post', '/api/auth/register', { name: 'Larga', email: 'larga@x.co', password: 'Aa1' + 'x'.repeat(80) });
    assert.equal(r.status, 400);
  });

  test('el token de acceso deja de servir al cerrar sesión', async () => {
    const { agent, send } = await client();
    const reg = await send('post', '/api/auth/register', { name: 'Out', email: 'out@x.co', password: PASS });
    const access = reg.headers['set-cookie'].find((c) => c.startsWith('access_token=')).split(';')[0];
    await send('post', '/api/auth/logout');
    const r = await request(app).get('/api/transactions').set('Cookie', [access]);
    assert.equal(r.status, 401);
    assert.ok(agent);
  });

  test('dos pestañas renovando a la vez no cierran la sesión', async () => {
    const { send } = await client();
    const reg = await send('post', '/api/auth/register', { name: 'Tabs', email: 'tabs@x.co', password: PASS });
    const ck = (n) => reg.headers['set-cookie'].find((c) => c.startsWith(n + '=')).split(';')[0];
    const tok = ck('csrf_token').split('=')[1];
    const go = () => request(app).post('/api/auth/refresh').set('Cookie', [ck('refresh_token'), ck('csrf_token')]).set('X-CSRF-Token', tok);
    const [a, b] = [await go(), await go()];
    assert.equal(a.status, 200);
    assert.equal(b.status, 409); // la segunda pestaña reintenta con las cookies nuevas, la sesión sigue viva
  });

  test('reutilizar un refresh token invalida la sesión', async () => {
    const { agent, send } = await client();
    const reg = await send('post', '/api/auth/register', { name: 'Ref', email: 'ref@x.co', password: PASS });
    const oldRefresh = reg.headers['set-cookie'].find((c) => c.startsWith('refresh_token=')).split(';')[0];
    assert.equal((await send('post', '/api/auth/refresh')).status, 200);
    const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
    // El ladrón usa el token viejo pasado el margen de gracia de 10 s.
    require('../src/db').prepare('UPDATE refresh_tokens SET rotated_at = rotated_at - 60 WHERE rotated_at IS NOT NULL').run();
    const atacante = await request(app).post('/api/auth/refresh')
      .set('Cookie', [oldRefresh, `csrf_token=${csrf}`]).set('X-CSRF-Token', csrf);
    assert.equal(atacante.status, 401);
  });

  test('un usuario no ve ni borra datos de otro (IDOR)', async () => {
    const a = await client();
    await a.send('post', '/api/auth/register', { name: 'Ana', email: 'a@x.co', password: PASS });
    const tx = await a.send('post', '/api/transactions', { type: 'gasto', amount: 5000, category: 'Comida', date: '2026-10-01' });
    const b = await client();
    await b.send('post', '/api/auth/register', { name: 'Beto', email: 'b@x.co', password: PASS });
    assert.equal((await b.send('delete', `/api/transactions/${tx.body.transaction.id}`)).status, 404);
    assert.equal((await b.agent.get('/api/transactions?month=2026-10')).body.transactions.length, 0);
  });

  test('inyección SQL en parámetros no pasa la validación', async () => {
    const a = await client();
    await a.send('post', '/api/auth/register', { name: 'Sara', email: 'sql@x.co', password: PASS });
    const r = await a.agent.get("/api/transactions?month=2026-10' OR 1=1--");
    assert.equal(r.status, 400);
  });
});

describe('Recuperación de contraseña', () => {
  test('flujo completo: código al registrarse, recuperar, código quemado', async () => {
    const a = await client();
    const reg = await a.send('post', '/api/auth/register', { name: 'Olvido', email: 'olvido@x.co', password: PASS });
    const code = reg.body.recoveryCode;
    assert.match(code, /^[2-9A-HJKMNP-Z]{5}(-[2-9A-HJKMNP-Z]{5}){3}$/);

    const b = await client();
    const rec = await b.send('post', '/api/auth/recover', { email: 'olvido@x.co', code: code.toLowerCase().replace(/-/g, ' '), password: 'NuevaClave456' });
    assert.equal(rec.status, 200);
    assert.ok(rec.body.recoveryCode && rec.body.recoveryCode !== code, 'entrega un código nuevo');

    // La sesión vieja quedó cerrada, la contraseña vieja ya no sirve y el código usado está quemado.
    assert.equal((await a.agent.get('/api/auth/me')).status, 401);
    assert.equal((await (await client()).send('post', '/api/auth/login', { email: 'olvido@x.co', password: PASS })).status, 401);
    assert.equal((await (await client()).send('post', '/api/auth/login', { email: 'olvido@x.co', password: 'NuevaClave456' })).status, 200);
    assert.equal((await (await client()).send('post', '/api/auth/recover', { email: 'olvido@x.co', code, password: 'OtraClave789' })).status, 401);
  });

  test('códigos falsos: mismo error exista o no el correo, y freno tras 5', async () => {
    const { send } = await client();
    await send('post', '/api/auth/register', { name: 'Brute', email: 'brute@x.co', password: PASS });
    const c = await client();
    const fake = { code: 'AAAAA-BBBBB-CCCCC-DDDDD', password: 'NuevaClave456' };
    assert.equal((await c.send('post', '/api/auth/recover', { email: 'noexiste@x.co', ...fake })).status, 401);
    for (let i = 0; i < 5; i++) await c.send('post', '/api/auth/recover', { email: 'brute@x.co', ...fake });
    assert.equal((await c.send('post', '/api/auth/recover', { email: 'brute@x.co', ...fake })).status, 429);
  });

  test('cuentas antiguas reciben su código al iniciar sesión, solo una vez', async () => {
    const { send } = await client();
    await send('post', '/api/auth/register', { name: 'Vieja', email: 'vieja@x.co', password: PASS });
    require('../src/db').prepare("UPDATE users SET recovery_hash = NULL WHERE email = 'vieja@x.co'").run();
    const l1 = await (await client()).send('post', '/api/auth/login', { email: 'vieja@x.co', password: PASS });
    assert.ok(l1.body.recoveryCode);
    const l2 = await (await client()).send('post', '/api/auth/login', { email: 'vieja@x.co', password: PASS });
    assert.equal(l2.body.recoveryCode, undefined);
  });
});

describe('Versión del frontend', () => {
  test('la página trae su versión y JS/CSS con esa versión en la URL', async () => {
    const r = await request(app).get('/');
    assert.equal(r.headers['cache-control'], 'no-store');
    const v = r.text.match(/name="app-version" content="([0-9a-f]{10})"/)?.[1];
    assert.ok(v);
    assert.ok(r.text.includes(`/api.js?v=${v}`));
    assert.match((await request(app).get(`/api.js?v=${v}`)).headers['cache-control'], /immutable/);
  });

  test('un cliente viejo recibe la orden de recargar y borrar caché; uno al día no', async () => {
    const v = (await request(app).get('/')).text.match(/name="app-version" content="([0-9a-f]{10})"/)[1];
    const viejo = await request(app).get('/api/auth/csrf');
    assert.equal(viejo.headers['x-app-reload'], '1');
    assert.equal(viejo.headers['clear-site-data'], '"cache"');
    const nuevo = await request(app).get('/api/auth/csrf').set('X-App-Version', v);
    assert.equal(nuevo.headers['x-app-reload'], undefined);
    assert.equal(nuevo.headers['clear-site-data'], undefined);
  });
});

describe('Finanzas', () => {
  let c;
  before(async () => {
    c = await client();
    await c.send('post', '/api/auth/register', { name: 'Fin', email: 'fin@x.co', password: PASS });
  });

  test('flujo completo: movimientos, presupuesto, meta y resumen', async () => {
    await c.send('post', '/api/transactions', { type: 'ingreso', amount: 2000000, category: 'Salario', date: '2026-10-01' });
    await c.send('post', '/api/transactions', { type: 'gasto', amount: 300000, category: 'Comida', date: '2026-10-05' });
    await c.send('post', '/api/transactions', { type: 'gasto', amount: 100000, category: 'Transporte', date: '2026-10-06' });
    assert.equal((await c.send('put', '/api/budgets', { category: 'Comida', month: '2026-10', limit_amount: 400000 })).status, 200);

    const budgets = (await c.agent.get('/api/budgets?month=2026-10')).body.budgets;
    assert.equal(budgets[0].spent, 300000);

    const g = (await c.send('post', '/api/goals', { name: 'Moto', target: 5000000 })).body.goal;
    assert.equal((await c.send('post', `/api/goals/${g.id}/contributions`, { amount: 250000 })).body.goal.saved, 250000);
    assert.equal((await c.send('post', `/api/goals/${g.id}/contributions`, { amount: -999999 })).status, 400);

    const s = (await c.agent.get('/api/summary?month=2026-10')).body;
    assert.equal(s.income, 2000000);
    assert.equal(s.expense, 400000);
    assert.equal(s.balance, 1600000);
    assert.equal(s.trend.length, 6);
  });

  test('montos decimales o negativos rechazados', async () => {
    assert.equal((await c.send('post', '/api/transactions', { type: 'gasto', amount: 10.5, category: 'X', date: '2026-10-01' })).status, 400);
    assert.equal((await c.send('post', '/api/transactions', { type: 'gasto', amount: -10, category: 'X', date: '2026-10-01' })).status, 400);
  });

  test('logout cierra la sesión', async () => {
    await c.send('post', '/api/auth/logout');
    assert.equal((await c.agent.get('/api/auth/me')).status, 401);
  });
});
