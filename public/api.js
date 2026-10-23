/* Conexión con el backend Express: cookies httpOnly + token CSRF en cada petición que modifica. */
'use strict';
const Api = (() => {
  const readCookie = (name) => document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.split('=')[1];

  // Si varias peticiones vencen a la vez, comparten una sola renovación.
  let refreshing = null;
  const refresh = () => (refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': readCookie('csrf_token') || '', 'X-App-Version': VERSION },
  }).then((r) => r.ok || r.status === 409).finally(() => { refreshing = null; }));

  const VERSION = document.querySelector('meta[name="app-version"]')?.content || '';
  function checkVersion(res) {
    if (res.headers.get('X-App-Reload') !== '1') return;
    let last = null;
    try { last = sessionStorage.getItem('reloadedFor'); sessionStorage.setItem('reloadedFor', VERSION); } catch { /* sin storage */ }
    if (last !== VERSION) location.reload(); // una sola vez, por si el servidor y el cliente no coinciden
  }

  async function call(method, url, body, retry = true) {
    const headers = { Accept: 'application/json', 'X-App-Version': VERSION };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = readCookie('csrf_token') || '';
    const res = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    checkVersion(res);

    // Token de acceso vencido (15 min): se renueva una vez con el refresh token y se repite.
    if (res.status === 401 && retry && !/^\/api\/auth\/(refresh|login|register|logout)/.test(url)) {
      if (await refresh().catch(() => false)) return call(method, url, body, false);
      // Sin sesión renovable: al arrancar se muestra el acceso; a mitad de uso, se recarga hacia el acceso.
      if (url !== '/api/auth/me') location.reload();
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
    addTx: (t) => call('POST', '/api/transactions', t.pocket_id ? { ...t, pocket_id: Number(t.pocket_id) } : t),
    deleteTx: (id) => call('DELETE', `/api/transactions/${id}`),
    listBudgets: async (m) => (await call('GET', `/api/budgets?month=${m}`)).budgets,
    setBudget: (b) => call('PUT', '/api/budgets', b),
    deleteBudget: (id) => call('DELETE', `/api/budgets/${id}`),
    listGoals: async () => (await call('GET', '/api/goals')).goals,
    addGoal: (g) => call('POST', '/api/goals', g),
    contribute: (id, amount) => call('POST', `/api/goals/${id}/contributions`, { amount }),
    deleteGoal: (id) => call('DELETE', `/api/goals/${id}`),
    listPockets: async () => (await call('GET', '/api/pockets')).pockets,
    addPocket: (name) => call('POST', '/api/pockets', { name }),
    renamePocket: (id, name) => call('PATCH', `/api/pockets/${id}`, { name }),
    deletePocket: (id, moveTo) => call('DELETE', `/api/pockets/${id}${moveTo ? `?move_to=${moveTo}` : ''}`),
  };

  return { call, store };
})();

/* Arranque: si hay sesión → app; si no → pantalla de acceso. */
(async () => {
  const { h, mount } = FinanzasUI;
  const root = document.getElementById('app');
  await Api.call('GET', '/api/auth/csrf');

  // Video de fondo solo en las pantallas de acceso. Silenciado, en bucle y con botón de pausa.
  // Con "reducir movimiento" activado en el celular se queda la imagen fija.
  let bg = null;
  function showBg() {
    if (bg) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Versión vertical para celular y horizontal para pantallas anchas (así no se recorta el gráfico).
    const o = window.innerWidth > window.innerHeight ? 'h' : 'v';
    const video = h('video', { class: 'auth-video', muted: true, loop: true, playsinline: true, poster: `/media/bolsa-${o}.jpg`, preload: reduce ? 'none' : 'auto', 'aria-hidden': 'true' },
      h('source', { src: `/media/bolsa-${o}.mp4`, type: 'video/mp4' }),
      h('source', { src: `/media/bolsa-${o}.webm`, type: 'video/webm' }));
    video.muted = true;
    const toggle = h('button', { class: 'bg-toggle', type: 'button' });
    const sync = () => { toggle.textContent = video.paused ? 'Reproducir fondo' : 'Pausar fondo'; };
    toggle.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
    video.addEventListener('play', sync); video.addEventListener('pause', sync); sync();
    bg = h('div', { class: 'auth-bg' }, video, h('div', { class: 'auth-veil' }));
    document.body.prepend(bg);
    document.body.append(toggle);
    bg.toggle = toggle;
    if (!reduce) video.play().catch(sync);
  }
  function hideBg() { bg?.toggle.remove(); bg?.remove(); bg = null; }

  const start = (user) => { hideBg(); return mountApp(user); };
  const mountApp = (user) => mount(root, Api.store, {
    userName: user.name,
    onLogout: async () => { await Api.call('POST', '/api/auth/logout'); location.reload(); },
  });

  try { return start((await Api.call('GET', '/api/auth/me')).user); } catch { /* sin sesión */ }
  showBg();

  // Pantalla que muestra el código de recuperación una sola vez, antes de entrar a la app.
  function showRecoveryCode(user, code, recovered) {
    const [g1, g2, g3, g4] = code.split('-');
    const box = h('div', { class: 'recovery-code num', id: 'recovery-code', tabindex: '0', 'aria-label': code }, `${g1}-${g2}-`, h('wbr'), `${g3}-${g4}`);
    const copyBtn = h('button', {
      type: 'button', onclick: async () => {
        try { await navigator.clipboard.writeText(code); copyBtn.textContent = 'Copiado'; }
        catch { const r = document.createRange(); r.selectNodeContents(box); getSelection().removeAllRanges(); getSelection().addRange(r); copyBtn.textContent = 'Selecciónalo y cópialo'; }
      },
    }, 'Copiar código');
    const check = h('input', { type: 'checkbox', id: 'saved-check' });
    const go = h('button', { class: 'btn-primary', disabled: true, onclick: () => start(user) }, 'Entrar a mi cuenta');
    check.addEventListener('change', () => { go.disabled = !check.checked; });
    root.replaceChildren(h('div', { class: 'wrap' }, h('main', { class: 'auth panel' },
      h('h1', {}, recovered ? 'Contraseña cambiada' : 'Guarda tu código'),
      h('p', { class: 'muted', style: 'margin:0' }, recovered
        ? 'Cerramos tus otras sesiones. Tu código anterior ya no sirve; este es el nuevo.'
        : 'Si olvidas tu contraseña, con este código la recuperas. Solo lo verás esta vez.'),
      box,
      copyBtn,
      h('p', { class: 'hint' }, 'Guárdalo en tu gestor de contraseñas o en una nota segura. Sin él no hay forma de recuperar la cuenta.'),
      h('label', { class: 'check-row', for: 'saved-check' }, check, 'Ya lo guardé'),
      go)));
    box.focus();
  }

  const afterAuth = ({ user, recoveryCode }, recovered) => (recoveryCode ? showRecoveryCode(user, recoveryCode, recovered) : start(user));

  function authScreen(mode) {
    const isReg = mode === 'register';
    const isRec = mode === 'recover';
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const name = isReg ? h('input', { id: 'name', autocomplete: 'name', required: true, minlength: '2', maxlength: '60' }) : null;
    const email = h('input', { id: 'email', type: 'email', autocomplete: 'email', required: true });
    const code = isRec ? h('input', { id: 'code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', required: true, placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX', maxlength: '40' }) : null;
    const pass = h('input', { id: 'password', type: 'password', autocomplete: isReg || isRec ? 'new-password' : 'current-password', required: true, minlength: isReg || isRec ? '10' : '1' });
    const submit = h('button', { class: 'btn-primary', type: 'submit' }, isReg ? 'Crear cuenta' : isRec ? 'Cambiar contraseña' : 'Entrar');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true; submit.disabled = true;
        try {
          const body = { email: email.value, password: pass.value, ...(isReg && { name: name.value }), ...(isRec && { code: code.value }) };
          const url = isReg ? '/api/auth/register' : isRec ? '/api/auth/recover' : '/api/auth/login';
          afterAuth(await Api.call('POST', url, body), isRec);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; submit.disabled = false; }
      },
    },
      isReg ? h('div', { class: 'field' }, h('label', { for: 'name' }, 'Tu nombre'), name) : null,
      h('div', { class: 'field' }, h('label', { for: 'email' }, 'Correo'), email),
      isRec ? h('div', { class: 'field' }, h('label', { for: 'code' }, 'Código de recuperación'), code) : null,
      h('div', { class: 'field' }, h('label', { for: 'password' }, isRec ? 'Contraseña nueva' : 'Contraseña'), pass),
      isReg || isRec ? h('p', { class: 'hint' }, 'Mínimo 10 caracteres, con mayúscula, minúscula y número.') : null,
      err, submit);
    const intro = isReg ? 'Crea tu cuenta para llevar ingresos, gastos, presupuestos y metas.'
      : isRec ? 'Usa el código que guardaste al crear tu cuenta.' : 'Entra para ver cómo vas este mes.';
    root.replaceChildren(h('div', { class: 'wrap' }, h('main', { class: 'auth panel' },
      h('h1', {}, isRec ? 'Recuperar acceso' : 'Mis Finanzas'),
      h('p', { class: 'muted', style: 'margin:0' }, intro),
      form,
      h('div', { class: 'auth-links' },
        mode === 'login' ? h('button', { class: 'btn-ghost', onclick: () => authScreen('recover') }, 'Olvidé mi contraseña') : null,
        h('button', { class: 'btn-ghost', onclick: () => authScreen(isReg || isRec ? 'login' : 'register') }, isReg || isRec ? 'Volver a entrar' : 'Crear una cuenta nueva')))));
    (isReg ? name : email).focus();
  }
  authScreen('login');
})();
