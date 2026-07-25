# AccountBook — Sistema de Contabilidad Personal

Backend web del sistema (paquete `accounting-system`). Repo: [Bradly95/system-2026](https://github.com/Bradly95/system-2026). Desplegado en Vercel. La app vive en este directorio (`TheBook/`); el directorio padre `theBookApp/` es solo un contenedor (facturas, planes sueltos). **Lanza Claude Code desde aquí (`TheBook/`)** para que se carguen las skills y agentes del framework.

**El mapa completo del producto está en [`PROJECT.md`](./PROJECT.md)** — stack, esquema de datos, 27 rutas API, funcionalidades, cron. Léelo antes de tocar un área que no conozcas; no lo dupliques aquí.

## Stack (resumen operativo)

- **Next.js 16** (App Router) + **React 19** + **TypeScript** · Tailwind **v4** · **shadcn/ui** (estilo new-york, Radix).
- **Prisma 7** con adaptador **PostgreSQL** (`@prisma/adapter-pg`) · **NextAuth 5 (beta)** Google OAuth, single-user.
- **Auth mobile**: `POST /api/auth/mobile` valida Google ID token → JWT con `jose` (Edge-compatible). Middleware dual: cookies web + Bearer mobile.
- **PWA** con `serwist` · **web-push** para notificaciones · **Vercel Cron** diario (06:00 UTC) en `/api/cron/daily`.
- **Nodemailer** (Gmail SMTP) para emails.

## Convenciones que no se negocian (código = inglés, copy UI = español)

- **Dinero en centavos** (integer) siempre — nunca floats. Formateo en `lib/currency.ts`.
- **Timezone** `America/Montevideo` (UTC-3); fechas guardadas como UTC midnight. Utilidades en `lib/dates.ts`. Day-clamping (pay_day=31 en feb → 28/29).
- **Validación**: Zod en toda API, errores con `.flatten()` (`lib/validations.ts`).
- **Notificaciones idempotentes**: unique `(type, entity_id, event_date)`, upsert sin update.
- **Audit logs** fire-and-forget (nunca bloquean el request), nombre de entidad desnormalizado (`lib/audit.ts`).
- **Soft-delete** vía `deleted_at` en pagos de suscripción (permite undo).
- **Settings singleton** (una fila global). **Auth single-user**: `ALLOWED_EMAILS` en `auth.ts`.
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

**Gestor de paquetes: solo pnpm.** Migrado desde npm el 2026-07-24 (`pnpm-lock.yaml`, `packageManager: pnpm@11.1.1`, sin `package-lock.json`). El hook global bloquea npm/npx/yarn — usa `pnpm <script>` y `pnpm exec <bin>` / `pnpm dlx <pkg>`. Ojo: `ignore-scripts=true` global → el `postinstall: prisma generate` NO corre solo tras instalar; corre `pnpm db:generate` a mano. `minimum-release-age=1440` (24h) puede tumbar un `pnpm add` con `ERR_PNPM_MISSING_TIME`; solo entonces, y solo para deps ya vetadas, `npm_config_minimum_release_age=0 pnpm add …`.

## Estado del proyecto / tracking

- Docs de estado: [`TRACKER.md`](./TRACKER.md), [`TASKS_SERVICE.md`](./TASKS_SERVICE.md), [`PLAN-NOTIFICATIONS.md`](./PLAN-NOTIFICATIONS.md).
- **Tests**: vitest cableado (`vitest.config.ts`, entorno node). Cobertura inicial: lógica pura de `lib/currency.ts` y `lib/dates.ts` (`lib/*.test.ts`). **Falta todo lo demás** — APIs, cron, componentes. Al tocar un área, deja su test (la skill `tdd` guía).
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
