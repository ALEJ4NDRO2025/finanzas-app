# Mis Finanzas

App de finanzas personales en pesos colombianos: ingresos y gastos, presupuestos mensuales con alertas, metas de ahorro y dashboard.

Node 22 + Express 5 + SQLite (nativo de Node). Sin frameworks de frontend.

## Arrancar

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 14 pruebas de seguridad y de la API
```

## Desplegar en Render

1. En [render.com](https://render.com) → **New → Blueprint** → elige este repo.
2. Render lee `render.yaml`, genera el `JWT_SECRET` y monta el disco para la base de datos.
3. Listo. Cada `git push` a `main` redespliega.

## Cadena de middleware (en orden)

| # | Middleware | Qué frena |
|---|---|---|
| 1 | `requestId` | Errores imposibles de rastrear |
| 2 | `requestLogger` | Logs con datos sensibles (no registra cuerpos ni cookies) |
| 3 | `helmet` + CSP estricta | XSS, clickjacking, sniffing de tipos |
| 4 | `express.json({limit:'10kb'})` | Cuerpos gigantes |
| 5 | `cookieParser` | — |
| 6 | `noStore` | Datos financieros en caché |
| 7 | `apiLimiter` / `authLimiter` | Abuso y fuerza bruta |
| 8 | `checkOrigin` | Peticiones desde otros sitios |
| 9 | `csrfProtection` (double submit) | CSRF |
| 10 | `requireAuth` (JWT en cookie httpOnly) | Acceso sin sesión |
| — | `validate` (zod `.strict()`) | Inyección, mass assignment, datos basura |
| — | `errorHandler` | Fugas de stack traces |

## Otras decisiones de seguridad

- Contraseñas con bcrypt (costo 12) y política mínima de 10 caracteres.
- Bloqueo de cuenta 15 min tras 5 intentos fallidos; mismo mensaje exista o no el correo, y tiempo de respuesta constante.
- Access token de 15 min + refresh token rotativo de 7 días. Solo se guarda su hash. Si se reutiliza uno viejo, se cierra toda la sesión (detección de robo).
- Todas las consultas filtran por `user_id` (anti-IDOR) y usan parámetros (anti-SQL injection).
- Dinero en pesos enteros, nunca decimales.
- Auditoría de login, bloqueo y cierre de sesión en `audit_log`.

## Referencias

- [hagopj13/node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate) — estructura de middlewares y manejo de errores.
- [goldbergyoni/nodebestpractices](https://github.com/goldbergyoni/nodebestpractices) — prácticas de seguridad.
- [OWASP Cheat Sheets](https://cheatsheetseries.owasp.org/) — CSRF, sesiones, contraseñas.
