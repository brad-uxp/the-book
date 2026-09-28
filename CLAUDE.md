# AccountBook — Sistema de Contabilidad Personal

Backend web del sistema (paquete `accounting-system`). Repo: [brad-uxp/the-book](https://github.com/brad-uxp/the-book). Desplegado en **Railway** (`book.bolstro.com`). La app vive en este directorio (`TheBook/`); el directorio padre `theBookApp/` es solo un contenedor (facturas, planes sueltos). **Lanza Claude Code desde aquí (`TheBook/`)** para que se carguen las skills y agentes del framework.

**El mapa completo del producto está en [`PROJECT.md`](./PROJECT.md)** — stack, esquema de datos, 54 rutas API, funcionalidades, job diario. Léelo antes de tocar un área que no conozcas; no lo dupliques aquí.

## Stack (resumen operativo)

- **Next.js 16** (App Router) + **React 19** + **TypeScript** · Tailwind **v4** · **shadcn/ui** (estilo new-york, Radix).
- **Prisma 7** con adaptador **PostgreSQL** (`@prisma/adapter-pg`) · **NextAuth 5 (beta)** Google OAuth, single-user.
- **Autorización en dos capas**: `proxy.ts` (así se llama el middleware en Next 16) + `requireSession()` en cada handler. Ambos validan el email contra `ALLOWED_EMAILS`, no la mera presencia de `req.auth`.
- **Cloudflare R2** para adjuntos de facturas. **Sin PWA ni web push** desde el 2026-09-27 (se viene una app React Native con push nativo); `public/sw.js` es solo el kill switch que desinstala el service worker viejo — ver su cabecera.
- **Job diario in-app** a las 13:00 UTC (`instrumentation.ts` → `lib/daily-scheduler.ts`). No hay cron de plataforma; `/api/cron/daily` es el disparo manual, con `CRON_SECRET`.
- **No hay email.** Existió y se eliminó: menciones a Nodemailer o Gmail son de una versión anterior. **El login mobile de antes (`/api/auth/mobile`) también se eliminó**; el de hoy es otro y vive en `/api/mobile/*` (ID token de Google verificado con `jose` + nonce de un solo uso → `ApiToken`). No los confundas.

## Convenciones que no se negocian (código = inglés, copy UI = inglés)

- **Dinero en centavos** (integer) siempre — nunca floats. Formateo en `lib/currency.ts`.
- **Timezone** `America/Montevideo` (UTC-3); fechas guardadas como UTC midnight. Utilidades en `lib/dates.ts`. Day-clamping (pay_day=31 en feb → 28/29).
- **Validación**: Zod en toda API, errores con `.flatten()` (`lib/validations.ts`).
- **Notificaciones idempotentes**: unique `(type, entity_id, event_date)`, upsert sin update.
- **Audit logs** fire-and-forget (nunca bloquean el request), nombre de entidad desnormalizado (`lib/audit.ts`).
- **Soft-delete** vía `deleted_at` en pagos de suscripción (permite undo).
- **Settings singleton** (una fila global). **Auth single-user**: `ALLOWED_EMAILS` en `auth.ts`.
- **Copy de la UI en inglés**, en la web y en la app mobile (decidido el 2026-09-27; antes era español).
- **Escrituras de issues e ideas** solo por `lib/issues-service.ts` / `lib/canvas-service.ts`: las rutas REST y la sync del teléfono (`/api/sync/*`) comparten reglas y auditoría. No escribas `prisma.issue.create/update/delete` en una ruta nueva.
- **Límites de texto** en `lib/text-limits.ts` (título 500, texto 200 000 caracteres de HTML), sin imports: los lee la web, la API y el teléfono (`@shared/text-limits`). No pongas otro número en otro lado.
- **Tipos de token** (`ApiToken.kind`): `mobile` (lo emite el login de la app), `automation` (Settings) y `release` (Settings; lo usa `mobile/scripts/publish-release.sh` desde el Llavero). `requireSession()` rechaza `release` en toda la API; solo `requireReleaseToken()` lo acepta (`POST /api/mobile/releases*`). Las rutas que existen para la app usan `requireAppSession()` (navegador o `mobile`).
- **La sync del teléfono** usa `requireSyncSession()` (sesión del navegador o token `mobile`, nunca uno `automation`), se cobra por cambio (`checkRateLimit` con costo) y corre de a un push por llamante (`lib/keyed-lock.ts`). Rate limit y lock viven en memoria: asumen **una sola réplica**.
- **Borrados que el teléfono tiene que ver**: triggers `AFTER DELETE` en `Task`, `CanvasNode` y `CanvasEdge` llenan `SyncTombstone`. Invisibles para Prisma y guardados por `prisma/migrations.test.ts`: nunca los dropees ni los desactives.
- **Números del dashboard** solo en `lib/metrics.ts` (puro, testeado contra la implementación anterior). El dashboard y `GET /api/metrics` (la app mobile) lo usan; nunca dupliques una fórmula. Las consultas viven en `lib/metrics-server.ts`. La regla de factura vencida y el total "awaiting payment" viven en `lib/invoices.ts` (sin imports, `lib/metrics` los re-exporta) y el tipo de la respuesta de `/api/metrics` en `lib/metrics-report.ts`: la pestaña Invoices y Metrics del teléfono los usan vía `@shared/*`.
- **Prisma client** singleton en `lib/db.ts`.

## Comandos de desarrollo

```bash
pnpm dev            # next dev --port 3001
pnpm build          # next build --webpack
pnpm db:generate    # prisma generate
pnpm db:migrate     # prisma migrate dev
pnpm db:push        # prisma db push
pnpm db:studio      # prisma studio (GUI)
pnpm test           # vitest run
pnpm typecheck      # tsc --noEmit
```

**Gestor de paquetes: solo pnpm.** Migrado desde npm el 2026-07-24 (`pnpm-lock.yaml`, `packageManager: pnpm@11.1.1`, sin `package-lock.json`). El hook global bloquea npm/npx/yarn — usa `pnpm <script>` y `pnpm exec <bin>` / `pnpm dlx <pkg>`. Ojo: `ignore-scripts=true` global → el `postinstall: prisma generate` NO corre solo tras instalar; corre `pnpm db:generate` a mano. Por eso el `build` hace `prisma generate && next build`: sin eso el deploy no compila. `minimum-release-age=1440` (24h) puede tumbar un `pnpm add` con `ERR_PNPM_MISSING_TIME`; solo entonces, y solo para deps ya vetadas, `npm_config_minimum_release_age=0 pnpm add …`.

## Estado del proyecto / tracking

- Docs de estado: [`TRACKER.md`](./TRACKER.md), [`TASKS_SERVICE.md`](./TASKS_SERVICE.md), [`PLAN-NOTIFICATIONS.md`](./PLAN-NOTIFICATIONS.md).
- **Tests**: vitest cableado (`vitest.config.ts`, entorno node, alias `@/`). Cubre la lógica pura: `lib/currency.ts`, `lib/dates.ts`, las reglas de notificación del job diario (`lib/cron-helpers.ts`) las reglas de la sync del teléfono (`lib/sync.ts`) y un guard sobre las migraciones (`prisma/migrations.test.ts`); algunas rutas (mobile, sync) tienen tests con Prisma simulado. **Falta**: la mayoría de las rutas API, capa de I/O del scheduler, componentes. Al tocar un área, deja su test (la skill `tdd` guía).
- ⚠️ **`pnpm start` corre `prisma migrate deploy`**: cada arranque aplica migraciones a producción sin intervención humana. Y varios objetos críticos (el unique parcial de `SubscriptionPayment`, el unique funcional de `invoice_number`, los CHECK del singleton, de `CanvasEdge` y el que limita el canvas a las notas) no se pueden expresar en `schema.prisma`, así que `prisma migrate dev` genera su `DROP`. `prisma/migrations.test.ts` falla el build si eso se commitea, y además rechaza cualquier migración con `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` / `DELETE FROM` salvo que el SQL lleve el comentario `ACEPTO PERDER ESTOS DATOS` con el motivo — pero revisá el SQL generado antes.
- **Gate `pre-commit` fail-closed instalado** (`.git/hooks/pre-commit`): typecheck + `vitest run` antes de cada commit; aborta si falla. Es la propiedad mecánica #3 del framework. Bypass consciente: `git commit --no-verify`. (No se versiona — reinstalar por máquina.)

## Git (workflow de Brad)

Pushear a `dev`; merge a `main` **solo cuando se pida**. Alertar antes de operaciones destructivas. (Ojo: este repo hoy trabaja sobre `main` directamente — confirmar rama de trabajo antes de pushear.)

<!-- >>> rowanpulse dev-framework (install.sh) — no editar a mano >>> -->
## 🧰 Paradigma de ingeniería — framework de dev de Rowan Pulse

Este proyecto **declara** que trabaja con el framework de ingeniería de Rowan Pulse.

**Instalado desde la versión `v0.1.0-11-g0bc2feb`** (commit `0bc2feb`, 2026-07-22). Es la versión del
día en que se adoptó el framework aquí — **no** necesariamente la que tienes hoy en
tu clon, que avanza por su cuenta. Si necesitas saber bajo qué versión se produjo un
entregable, mira esta línea *y* `git -C <clon-del-framework> log -1`; si divergen, re-corre
`install.sh` para actualizar ambas cosas.

> ⚠️ **La adopción es LOCAL, por máquina.** Este bloque se versiona, pero las skills,
> los agentes y el guard son symlinks a un clon fuera del repo y **no** viajan con él.
> **Si no corriste `install.sh` (o la adopción manual equivalente) en tu máquina, nada de
> lo que sigue está disponible: el import de abajo apunta a un archivo que no existe, e
> ignora este bloque entero.** Actívalo así:
>
> ```bash
> git clone git@github.com:RowanPulse/local-dev-framework.git ~/rowanpulse/dev-framework
> ~/rowanpulse/dev-framework/install.sh    # córrelo desde la raíz de este proyecto
> ```
>
> Comprobación rápida: si `.claude/dev-framework.md` no existe, no está instalado.

Lo que sigue es el `CLAUDE.md` del framework, importado en vivo desde el clon local.
Es un **manual de ingeniería, no un cambio de identidad**; sus rutas relativas apuntan
al repo del framework, no a este proyecto.

@.claude/dev-framework.md

### 🔺 Fin del bloque importado — vuelves a ESTE proyecto

Todo lo anterior a esta línea es **material de referencia del framework**, no tu
identidad. Cierra el paréntesis:

- **Trabajas en `AccountBook` (accounting-system), y eres su coordinador de ingeniería** —
  no el coordinador de la disciplina de desarrollo de Rowan Pulse. Si te preguntan quién
  eres o en qué proyecto estás, esa es la respuesta.
- Mandan el stack, las convenciones y los docs de **este** proyecto (arriba de este bloque
  y en `PROJECT.md`). Del bloque de arriba tomas la postura de ingeniería, la tabla de
  ruteo a skills y agentes, y la honestidad de enforcement — nunca su identidad ni sus rutas.
<!-- <<< rowanpulse dev-framework <<< -->
