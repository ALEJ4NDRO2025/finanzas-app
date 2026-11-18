// Páginas de estado (404 y 500). Archivo aparte porque la CSP no permite scripts inline.
'use strict';
(() => {
  // "Volver atrás" solo si se llegó desde la misma app.
  const back = document.querySelector('[data-st-back]');
  try {
    if (back && document.referrer && new URL(document.referrer).origin === location.origin) {
      back.hidden = false;
      back.addEventListener('click', () => history.back());
    }
  } catch { /* referrer inválido: el botón queda oculto */ }

  // "Intentar de nuevo" en la 500: recarga la página que falló.
  document.querySelector('[data-st-reload]')?.addEventListener('click', () => location.reload());
})();
