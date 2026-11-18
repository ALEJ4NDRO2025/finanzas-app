# Páginas — Mis Finanzas

Mapa de pantallas, estados y animaciones. Fuente de verdad junto a `PRODUCT.md` (qué es) y `DESIGN.md` (cómo se ve).

## Arquitectura

- **Stack:** Express 5 (`src/`) sirve la API y el frontend estático (`public/`), sin framework ni build. Desplegado en Railway (servicio `web`). El APK de `android/` es un WebView que carga esta misma web, así que un cambio en `public/` llega a la app sin recompilar.
- **Ruta única:** la app es una SPA en `/`. Las vistas cambian por estado (`state.tab` en `ui.js`), no por URL. Cualquier otra ruta que no sea `/api/*` ni un archivo de `public/` responde 404.
- **Archivos del frontend:**
  - `public/index.html`: el skeleton inicial y los scripts. Sin estilos ni scripts inline (CSP `script-src 'self'`).
  - `public/styles.css`: tokens (`:root`) más estilos. Tiene **una sola capa** de tokens de diseño y movimiento (`--mk-*`, con alias para transitions.dev).
  - `public/ui.js`: los componentes, las vistas, los skeletons y las animaciones (`FinanzasUI`).
  - `public/api.js`: el acceso (login, registro, recuperación) y la conexión con la API.
  - `claude-artifact/`: la versión de un solo archivo para Claude (`build.js` + `store-claude.js`).
- **SEO:** es una app privada, así que no se indexa: `robots.txt` con `Disallow: /` y `<meta name="robots" content="noindex, nofollow">`.
- **Caché:** el HTML va con `no-store`. CSS y JS van con `?v=<hash>` y caché inmutable de un año. Los archivos de `media/` se guardan una semana.
- **Compresión:** gzip solo para el frontend estático. La API va sin comprimir (riesgo BREACH con tokens CSRF).

## Presupuesto de rendimiento (móvil, 4G)

| Métrica | Meta | Estado |
|---|---|---|
| LCP | < 2,5 s | Pendiente de medir (Fase 6) |
| CLS | < 0,1 | Los skeletons tienen la misma forma que la vista: debería cumplir |
| INP | < 200 ms | Pendiente de medir |
| JS inicial (gzip) | < 170 KB | ~49 KB (ui 17 + api 4 + GSAP 28) ✅ |
| Fuentes | ≤ 2 familias | Geist + Geist Mono, `display=swap` |

GSAP (72 KB sin comprimir) se carga en todas las vistas. Ver la decisión pendiente abajo.

## Pantallas

| # | Pantalla | Modo | Prioridad | Skeleton | Vacío | Error | Animaciones |
|---|---|---|---|---|---|---|---|
| 1 | **Acceso** (login, registro, recuperar, código de recuperación) | Operate | Alta | No aplica (render inmediato) | — | Mensaje en el form | Fondo de velas en video (pausable); `auth`: el panel sube y los campos entran en cascada |
| 2 | **Resumen**: disponible, flujo, bolsillos, gráfica, categorías | Operate | Alta | ✅ hero, cinta, bolsillos, gráfica, categorías | Revisar | Revisar | `enter` en cascada, `count` en cifras, `ticker` de presupuestos |
| 3 | **Movimientos**: lista por día, detalle, resumen lateral | Operate | Alta | ✅ filas y resumen | Revisar | Revisar | `enter`; el detalle se expande |
| 4 | **Presupuestos**: mensual y semanal | Operate | Media | ✅ tarjetas | Revisar | Revisar | `enter`, barras que crecen |
| 5 | **Metas**: progreso y abonos | Operate | Media | ✅ tarjetas | Revisar | Revisar | `enter`; `report`: el anillo se llena al abonar |
| — | **Hoja de registro** (+): gasto o ingreso | Operate | Alta | No aplica | — | Mensaje en el form | `sheetIn` / `sheetOut` (sube en celular, lateral en escritorio) |
| — | **Toast** | Operate | — | — | — | — | Entrada simple |

## Estados del sitio (Fase 3)

| Estado | Estado actual | Dónde |
|---|---|---|
| 404 | ✅ Página con la marca: la vela roja reemplaza el 0. Status 404. La API sigue en JSON | `public/404.html`, `src/middlewares/error.js` |
| 500 | ✅ Página con la marca, botón para reintentar y referencia de la petición. Status 500 | `public/500.html` |
| Sin conexión | ✅ Banner arriba cuando se cae el internet; "Conexión restablecida" en verde al volver. El APK tiene su propia pantalla | `netBanner()` en `ui.js` |
| Error al cargar una vista | ✅ Mensaje claro, botón Reintentar y reintento automático al volver la conexión | `render()` en `ui.js` |
| Vacíos | ✅ Movimientos, presupuestos y metas con acción para crear el primero; categorías con texto | `emptyAction()` en `ui.js` |
| Barra de carga entre vistas | No aplica | Los skeletons cubren el cambio de vista |
| Mantenimiento | No se necesita por ahora | — |

## Decisiones pendientes

- **GSAP fuera de la carga inicial.** Hoy se usa en contadores, la cinta, las entradas, la hoja y el reporte. Según el director, motion-kit va primero y GSAP solo para momentos especiales cargados aparte. Opciones: (a) pasar `enter`, `count`, `sheet` y `ticker` a CSS/JS nativo con los tokens `--mk-*` y dejar GSAP solo para `report`, con import dinámico; (b) dejarlo como está, porque el JS total cumple el presupuesto. Se decide en la Fase 4.
- **Duraciones de `ui.js`.** Las animaciones de GSAP usan valores sueltos (0.6, 1.1, 0.28, `expo.out`). Al migrar a motion-kit deben leer los `--mk-*`.
- **Token `--violet`.** Está declarado y no se usa. Hay que darle un uso o borrarlo.
