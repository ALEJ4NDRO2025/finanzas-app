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

- Contraseñas con bcrypt (costo 12), entre 10 caracteres y 72 bytes (el tope real de bcrypt).
- Bloqueo de 15 min tras 5 fallos desde la misma red (correo + IP), así un atacante no puede bloquearle la cuenta al dueño; tope de 100 fallos por hora por correo contra fuerza bruta distribuida. Responde igual exista o no el correo.
- Máximo 5 registros por hora por IP.
- Access token de 15 min + refresh token rotativo de 7 días. Solo se guarda su hash. Si se reutiliza uno viejo, se cierra toda la sesión (detección de robo), con 10 s de gracia para dos pestañas que renuevan a la vez.
- Cerrar sesión invalida el token de acceso al instante.
- El secreto de firma se genera en el servidor (`jwt.key` junto a la base) y nunca sale de ahí.
- Tokens vencidos e intentos viejos se borran cada hora.
- Todas las consultas filtran por `user_id` (anti-IDOR) y usan parámetros (anti-SQL injection).
- Dinero en pesos enteros, nunca decimales.
- Auditoría de login, bloqueo y cierre de sesión en `audit_log`.

## Riesgos aceptados

- **El registro revela si un correo ya existe.** Evitarlo exige verificación por correo; mientras tanto el límite de 5 registros por hora hace la enumeración lenta.
- **Sin respaldos automáticos de la base.** Activa los backups del volumen en Railway.

## Referencias

- [hagopj13/node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate) — estructura de middlewares y manejo de errores.
- [goldbergyoni/nodebestpractices](https://github.com/goldbergyoni/nodebestpractices) — prácticas de seguridad.
- [OWASP Cheat Sheets](https://cheatsheetseries.owasp.org/) — CSRF, sesiones, contraseñas.
