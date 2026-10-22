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

  test('bloqueo tras 5 intentos fallidos', async () => {
    const { send } = await client();
    await send('post', '/api/auth/register', { name: 'Bloq', email: 'bloq@x.co', password: PASS });
    const c = await client();
    for (let i = 0; i < 5; i++) await c.send('post', '/api/auth/login', { email: 'bloq@x.co', password: 'Incorrecta123' });
    const r = await c.send('post', '/api/auth/login', { email: 'bloq@x.co', password: PASS });
    assert.equal(r.status, 423);
  });

  test('reutilizar un refresh token invalida la sesión', async () => {
    const { agent, send } = await client();
    const reg = await send('post', '/api/auth/register', { name: 'Ref', email: 'ref@x.co', password: PASS });
    const oldRefresh = reg.headers['set-cookie'].find((c) => c.startsWith('refresh_token=')).split(';')[0];
    assert.equal((await send('post', '/api/auth/refresh')).status, 200);
    const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
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
