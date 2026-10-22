/* Conexión con el backend Express: cookies httpOnly + token CSRF en cada petición que modifica. */
'use strict';
const Api = (() => {
  const readCookie = (name) => document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.split('=')[1];

  // Si varias peticiones vencen a la vez, comparten una sola renovación.
  let refreshing = null;
  const refresh = () => (refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': readCookie('csrf_token') || '' },
  }).then((r) => r.ok || r.status === 409).finally(() => { refreshing = null; }));

  async function call(method, url, body, retry = true) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = readCookie('csrf_token') || '';
    const res = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });

    // Token de acceso vencido (15 min): se renueva una vez con el refresh token y se repite.
    if (res.status === 401 && retry && !/^\/api\/auth\/(refresh|login|register|logout)/.test(url)) {
      if (await refresh().catch(() => false)) return call(method, url, body, false);
      location.reload();
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detalles?.[0]?.error;
      throw new Error(detail ? `${data.error}: ${detail}` : data.error || 'Algo falló, intenta de nuevo');
    }
    return data;
  }

  const store = {
    summary: (m) => call('GET', `/api/summary?month=${m}`),
    listTx: async (m) => (await call('GET', `/api/transactions?month=${m}`)).transactions,
    addTx: (t) => call('POST', '/api/transactions', t),
    deleteTx: (id) => call('DELETE', `/api/transactions/${id}`),
    listBudgets: async (m) => (await call('GET', `/api/budgets?month=${m}`)).budgets,
    setBudget: (b) => call('PUT', '/api/budgets', b),
    deleteBudget: (id) => call('DELETE', `/api/budgets/${id}`),
    listGoals: async () => (await call('GET', '/api/goals')).goals,
    addGoal: (g) => call('POST', '/api/goals', g),
    contribute: (id, amount) => call('POST', `/api/goals/${id}/contributions`, { amount }),
    deleteGoal: (id) => call('DELETE', `/api/goals/${id}`),
  };

  return { call, store };
})();

/* Arranque: si hay sesión → app; si no → pantalla de acceso. */
(async () => {
  const { h, mount } = FinanzasUI;
  const root = document.getElementById('app');
  await Api.call('GET', '/api/auth/csrf');

  const start = (user) => mount(root, Api.store, {
    userName: user.name,
    onLogout: async () => { await Api.call('POST', '/api/auth/logout'); location.reload(); },
  });

  try { return start((await Api.call('GET', '/api/auth/me')).user); } catch { /* sin sesión */ }

  function authScreen(mode) {
    const isReg = mode === 'register';
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const name = isReg ? h('input', { id: 'name', autocomplete: 'name', required: true, minlength: '2', maxlength: '60' }) : null;
    const email = h('input', { id: 'email', type: 'email', autocomplete: 'email', required: true });
    const pass = h('input', { id: 'password', type: 'password', autocomplete: isReg ? 'new-password' : 'current-password', required: true, minlength: isReg ? '10' : '1' });
    const submit = h('button', { class: 'btn-primary', type: 'submit' }, isReg ? 'Crear cuenta' : 'Entrar');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true; submit.disabled = true;
        try {
          const body = { email: email.value, password: pass.value, ...(isReg && { name: name.value }) };
          const { user } = await Api.call('POST', isReg ? '/api/auth/register' : '/api/auth/login', body);
          start(user);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; submit.disabled = false; }
      },
    },
      isReg ? h('div', { class: 'field' }, h('label', { for: 'name' }, 'Tu nombre'), name) : null,
      h('div', { class: 'field' }, h('label', { for: 'email' }, 'Correo'), email),
      h('div', { class: 'field' }, h('label', { for: 'password' }, 'Contraseña'), pass),
      isReg ? h('p', { class: 'hint' }, 'Mínimo 10 caracteres, con mayúscula, minúscula y número.') : null,
      err, submit);
    root.replaceChildren(h('div', { class: 'wrap' }, h('main', { class: 'auth panel' },
      h('h1', {}, 'Mis Finanzas'),
      h('p', { class: 'muted', style: 'margin:0' }, isReg ? 'Crea tu cuenta para llevar ingresos, gastos, presupuestos y metas.' : 'Entra para ver cómo vas este mes.'),
      form,
      h('button', { class: 'btn-ghost', onclick: () => authScreen(isReg ? 'login' : 'register') }, isReg ? 'Ya tengo cuenta' : 'Crear una cuenta nueva'))));
    (isReg ? name : email).focus();
  }
  authScreen('login');
})();
