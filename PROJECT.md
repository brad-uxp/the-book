# AccountBook — Sistema de Contabilidad Personal

> Sistema de contabilidad personal, en producción. Next.js 16, React 19, Prisma 7 y PostgreSQL, desplegado en **Railway** (`book.bolstro.com`).

**Repositorio:** `brad-uxp/the-book`

---

## Stack Tecnológico

### Frontend

- **Next.js 16** (App Router) + **TypeScript**
- **React 19**
- **Tailwind CSS v4**
- **shadcn/ui** (estilo new-york) — 27 componentes base (Radix UI)
- **TanStack Table v8** — tablas con sorting, filtrado y paginación
- **Recharts** — gráficos y visualizaciones
- **TipTap** — editor de texto rico (descripciones de issues)
- **React Hook Form** + **Zod** — formularios y validación
- **jsPDF** + **jspdf-autotable** — exportación de reportes
- **Sonner** — notificaciones toast
- **Lucide React** — iconos
- **date-fns / date-fns-tz** — manejo de fechas con timezone

### Backend & Base de Datos

- **Prisma 7** ORM con adaptador PostgreSQL (`@prisma/adapter-pg`)
- **PostgreSQL 18** como base de datos
- **NextAuth 5 (beta)** — autenticación con Google OAuth, single-user
- **Cloudflare R2** (S3-compatible) — adjuntos de facturas vía URLs presignadas
- **web-push** (VAPID) — notificaciones push

> **No hay email ni auth mobile.** Ambas funcionalidades existieron y fueron
> eliminadas del producto. Si leés menciones a Nodemailer, Gmail SMTP, JWT con
> `jose` o `POST /api/auth/mobile`, son de una versión anterior.

### Infraestructura

- **Railway** — hosting y base de datos (una réplica, región `us-west2`)
- **Scheduler in-app** — `instrumentation.ts` registra `lib/daily-scheduler.ts`,
  que corre el job diario a las **13:00 UTC** (10:00 en Montevideo).
  No hay cron de plataforma. Se desactiva con `DISABLE_INAPP_CRON=1`.
- **PWA** con `serwist` (service worker generado en `public/sw.js`)

⚠️ **`pnpm start` corre `prisma migrate deploy` antes de `next start`**, así que
cada arranque aplica las migraciones pendientes a producción sin intervención
humana. Una migración commiteada llega a la base en el siguiente deploy.

---

## Estructura del Proyecto

```
TheBook/
├── app/
│   ├── api/                          # 38 rutas API (REST) — ver tabla abajo
│   ├── admin-logs/page.tsx           # Logs de auditoría
│   ├── dashboard/page.tsx            # Dashboard con métricas y gráficos
│   ├── expenses/page.tsx             # Vista unificada de gastos
│   ├── fees/page.tsx                 # Comisiones por referidor
│   ├── invoices/page.tsx             # Gestión de facturas
│   ├── issues/page.tsx               # Tareas y notas
│   ├── login/page.tsx                # Login con Google OAuth
│   ├── notifications/page.tsx        # Centro de notificaciones
│   ├── offline/page.tsx              # Fallback PWA
│   ├── salaries/page.tsx             # Gestión de salarios y personas
│   ├── settings/page.tsx             # Configuración del sistema
│   ├── subscriptions/page.tsx        # Gestión de suscripciones
│   ├── generated/prisma/             # Cliente Prisma (gitignored, generado en build)
│   ├── sw.ts                         # Service worker (serwist)
│   └── layout.tsx                    # Layout raíz con sidebar
├── components/
│   ├── ui/                           # 27 componentes shadcn/ui
│   ├── layout/                       # Sidebar, MobileNav, NotificationBell, InstallBanner
│   ├── dashboard/                    # Charts, Metrics, UpcomingCards, CorporateChart
│   ├── expenses/  invoices/  salaries/  subscriptions/
│   ├── fees/                         # Referidores y comisiones
│   ├── issues/                       # Board, lista, detalle, editores inline
│   ├── notifications/  settings/  admin-logs/
├── lib/
│   ├── api.ts                        # requireSession, mapeo de errores, readJson
│   ├── audit.ts                      # Logging de auditoría (fire-and-forget)
│   ├── cron-helpers.ts               # Lógica pura del job diario (testeada)
│   ├── currency.ts                   # Centavos ↔ display (testeada)
│   ├── daily-scheduler.ts            # Scheduler in-app
│   ├── dates.ts                      # Fechas UTC + timezone Montevideo (testeada)
│   ├── db.ts                         # Singleton de Prisma Client
│   ├── r2.ts                         # Cloudflare R2 + validación de object keys
│   ├── run-daily.ts                  # Orquestación del job diario
│   ├── validations.ts                # Esquemas Zod
│   ├── web-push.ts                   # Envío de push
│   └── utils.ts
├── prisma/
│   ├── schema.prisma
│   ├── migrations/                   # Migraciones escritas a mano
│   └── migrations.test.ts            # Guard de los índices que Prisma no modela
├── proxy.ts                          # Middleware de auth (Next 16 lo llama proxy)
├── auth.ts                           # NextAuth + ALLOWED_EMAILS + isAllowedSession
├── instrumentation.ts                # Registra el scheduler in-app
└── eslint.config.mjs
```

> **Nota:** en Next 16 el middleware se llama `proxy.ts`, no `middleware.ts`.
> No existe `prisma/seed.ts`.

---

## Esquema de Base de Datos

17 tablas. Todos los montos son `Int` en **centavos**; todas las fechas se
guardan como **UTC midnight**.

### Autenticación y Configuración

| Modelo             | Descripción                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| `Settings`         | Configuración global (singleton, `CHECK (id = 'singleton')`)             |
| `PushSubscription` | Suscripción de web push por endpoint                                     |

### Suscripciones

| Modelo                | Descripción                                                                     |
| --------------------- | ------------------------------------------------------------------------------- |
| `Subscription`        | Recurrente: nombre, monto, frecuencia, categoría, modo de pago                  |
| `SubscriptionPayment` | Pago con soft-delete (`deleted_at`) para undo; snapshot del monto               |

### Personas y Salarios

| Modelo                   | Descripción                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `Person`                 | Empleado: nombre, día de pago, rol, estado (`active`/`inactive`)  |
| `SalaryBase`             | Salario base actual (1:1 con Person)                              |
| `SalaryPayment`          | Pago: snapshot base + ajuste + total                              |
| `SalaryIncreaseReminder` | Recordatorio de aumento                                           |
| `Role`                   | Puesto de trabajo (nombre único)                                  |

### Facturas, Clientes y Referidores

| Modelo       | Descripción                                                                          |
| ------------ | ------------------------------------------------------------------------------------ |
| `Client`     | Cliente/proyecto: nombre, color hex, referidor por defecto                           |
| `Referrer`   | Referidor que cobra comisión                                                          |
| `Invoice`    | Factura: número (único, case-insensitive), cliente, monto, comisión, estado, adjunto |
| `FeePayment` | Pago de comisión a un referidor                                                       |

> **Convención de `Invoice.fee_cents`:** se guarda **negativo** — es un descuento
> sobre la factura. El dashboard suma `amount_cents + fee_cents` (resta la comisión
> del ingreso) y la vista de referidores usa `Math.abs` (total adeudado). Las dos
> lecturas son correctas bajo esa convención; una factura con fee positivo las
> rompería en direcciones opuestas.

### Gastos e Issues

| Modelo         | Descripción                                                          |
| -------------- | -------------------------------------------------------------------- |
| `OtherExpense` | Gasto puntual: nombre, categoría, monto, fecha                       |
| `Issue`        | Tarea o nota (`@@map("Task")`): estado, progreso, vencimiento, cliente |

### Sistema

| Modelo         | Descripción                                                                |
| -------------- | -------------------------------------------------------------------------- |
| `Notification` | 9 tipos, idempotente por `(type, entity_id, event_date)`                   |
| `AuditLog`     | Historial de cambios con snapshots JSON before/after                       |

### Invariantes que la base enforza

- `SubscriptionPayment.subscription` y `SalaryPayment.person` son **`ON DELETE RESTRICT`**:
  los pagos son historia contable y no se van con su padre. La API responde 409 y
  sugiere marcar `inactive`.
- **Índice único parcial** en `SubscriptionPayment (subscription_id, due_date) WHERE deleted_at IS NULL` —
  evita cobrar dos veces el mismo período.
- **Índice único funcional** en `Invoice (lower(invoice_number)) WHERE invoice_number IS NOT NULL`.

⚠️ Los dos últimos **no se pueden expresar en `schema.prisma`**, así que
`prisma migrate dev` los ve como drift y genera un `DROP INDEX`.
`prisma/migrations.test.ts` falla el build si eso llega a pasar. Si tenés que
editar una migración generada, borrá esa línea antes de commitear.

---

## Rutas API (40)

Todas exigen credencial (`requireSession()` en el handler, además del `proxy.ts`),
salvo `auth/[...nextauth]` y `cron/daily`, que se protege con `CRON_SECRET`.

Se aceptan **dos credenciales**: la cookie de NextAuth (navegador) y
`Authorization: Bearer tb_…` (máquinas). La referencia para clientes externos
está en [`API.md`](./API.md). La gestión de tokens (`/api/settings/tokens`) es
la excepción: exige sesión interactiva, porque un token que puede emitir tokens
no se puede revocar.

| Recurso           | Métodos         | Ruta                                 |
| ----------------- | --------------- | ------------------------------------ |
| Auth              | GET/POST        | `/api/auth/[...nextauth]`            |
| Subscriptions     | GET/POST        | `/api/subscriptions`                 |
| Subscription      | GET/PATCH/DEL   | `/api/subscriptions/[id]`            |
| Sub. Payments     | GET/POST/DEL    | `/api/subscriptions/[id]/payments`   |
| Sub. Payment      | PATCH/DELETE    | `/api/subscription-payments/[id]`    |
| People            | GET/POST        | `/api/people`                        |
| Person            | GET/PATCH/DEL   | `/api/people/[id]`                   |
| Salary Payments   | GET/POST        | `/api/people/[id]/payments`          |
| Salary Payment    | PATCH/DELETE    | `/api/salary-payments/[id]`          |
| Salary Reminders  | GET/POST/PATCH/DEL | `/api/people/[id]/reminders`      |
| Roles             | GET/POST        | `/api/roles`                         |
| Role              | PATCH/DELETE    | `/api/roles/[id]`                    |
| Invoices          | GET/POST        | `/api/invoices`                      |
| Invoice           | GET/PATCH/DEL   | `/api/invoices/[id]`                 |
| Invoice upload    | POST            | `/api/invoices/[id]/upload-url`      |
| Invoice download  | GET             | `/api/invoices/[id]/download-url`    |
| Clients           | GET/POST        | `/api/clients`                       |
| Client            | PATCH/DELETE    | `/api/clients/[id]`                  |
| Referrers         | GET/POST        | `/api/referrers`                     |
| Referrer          | PATCH/DELETE    | `/api/referrers/[id]`                |
| Referrer clients  | GET             | `/api/referrers/[id]/clients`        |
| Referrer detail   | GET             | `/api/referrers/[id]/detail`         |
| Referrers summary | GET             | `/api/referrers/summary`             |
| Other Expenses    | GET/POST        | `/api/other-expenses`                |
| Other Expense     | PATCH/DELETE    | `/api/other-expenses/[id]`           |
| Fee Payments      | GET/POST        | `/api/fee-payments`                  |
| Fee Payment       | PATCH/DELETE    | `/api/fee-payments/[id]`             |
| Issues            | GET/POST        | `/api/issues`                        |
| Issue             | GET/PATCH/DEL   | `/api/issues/[id]`                   |
| Issues counts     | GET             | `/api/issues/linked-counts`          |
| Notifications     | GET/PATCH       | `/api/notifications`                 |
| Notif. count      | GET             | `/api/notifications/count`           |
| Mark all read     | POST            | `/api/notifications/mark-all-read`   |
| Audit Logs        | GET             | `/api/audit-logs`                    |
| Settings          | GET/PATCH       | `/api/settings`                      |
| Test push         | POST            | `/api/settings/test-push`            |
| Web Push          | POST/DELETE     | `/api/web-push`                      |
| Cron Daily        | GET             | `/api/cron/daily`                    |

---

## Job Diario

Corre a las **13:00 UTC** por el scheduler in-app, y también se puede disparar
por `GET /api/cron/daily` con `Authorization: Bearer $CRON_SECRET`.
Es idempotente: correrlo dos veces el mismo día no duplica datos.

**Por diseño solo actúa sobre el día de hoy** — no hace catch-up de períodos
perdidos. Pausar una suscripción se hace desactivándola; un catch-up
recrearía el mes salteado al reactivarla.

### Tareas (en orden)

1. **Limpieza**: notificaciones > 7 días, audit logs > 12 meses
2. **Suscripciones**: aviso N días antes; en la fecha, si es `auto`, crea el pago
3. **Salarios**: aviso N días antes del día de pago
4. **Recordatorios de aumento**: aviso en la fecha efectiva
5. **Facturas**: aviso en `reminder_date` y N días antes del vencimiento
6. **Issues**: aviso para tareas que vencen hoy o mañana
7. **Web push** de todo lo creado en la corrida

> El aviso anticipado mira **hacia adelante** desde hoy (`advanceNotice`).
> Calcularlo restando desde el vencimiento del mes corriente falla en silencio
> cuando el día de pago es menor o igual a los días de anticipación.

---

## Patrones Técnicos Clave

| Patrón                      | Implementación                                                        |
| --------------------------- | --------------------------------------------------------------------- |
| Moneda                      | Enteros en centavos. `parseToCents` redondea sobre el string decimal   |
| Timezone                    | `America/Montevideo`; fechas guardadas como UTC midnight              |
| Day clamping                | `pay_day=31` en febrero → 28/29                                        |
| Soft-delete                 | `deleted_at` en pagos de suscripción (permite undo)                    |
| Audit logs                  | Fire-and-forget, nombre de entidad desnormalizado                      |
| Notificaciones idempotentes | Unique `(type, entity_id, event_date)` + upsert sin update             |
| Validación                  | Zod en toda API, errores con `.flatten()`                              |
| Autorización                | `requireSession()` en cada handler, además del `proxy.ts`              |
| Settings singleton          | Una fila, con CHECK en la base                                         |
| Auth single-user            | `ALLOWED_EMAILS` en `auth.ts`, re-chequeado en cada refresh del token  |

---

## Variables de Entorno

```env
# Base de datos
DATABASE_URL=postgresql://user:password@host:port/dbname?sslmode=require

# Autenticación (Google OAuth)
AUTH_SECRET=<openssl rand -base64 32>
AUTH_GOOGLE_ID=<from Google Cloud Console>
AUTH_GOOGLE_SECRET=<from Google Cloud Console>
AUTH_URL=https://book.bolstro.com
AUTH_TRUST_HOST=true

# Cron
CRON_SECRET=<random bearer token>
DISABLE_INAPP_CRON=            # poné 1 para apagar el scheduler in-app

# Cloudflare R2 (adjuntos de facturas)
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=                   # opcional; por defecto <account>.r2.cloudflarestorage.com

# Web Push (VAPID)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

Generar claves VAPID: `pnpm dlx web-push generate-vapid-keys`.

---

## Comandos de Desarrollo

```bash
pnpm dev               # Servidor de desarrollo (localhost:3001)
pnpm build             # prisma generate && next build --webpack
pnpm db:generate       # Generar cliente Prisma
pnpm db:migrate        # prisma migrate dev  ⚠️ ver aviso de índices arriba
pnpm db:studio         # Prisma Studio
pnpm test              # vitest run
pnpm test:coverage     # vitest run --coverage
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint .
```

**Solo pnpm.** `ignore-scripts` está activo, así que `postinstall` no corre
automáticamente; el `build` genera el cliente Prisma por su cuenta.

---

## Seguridad

- **Headers HTTP**: X-Robots-Tag (noindex), X-Frame-Options DENY, HSTS con
  preload, CSP, Permissions-Policy
- **Autorización en dos capas**: `proxy.ts` en el borde y `requireSession()` en
  cada handler. El chequeo valida el email contra `ALLOWED_EMAILS`, no la mera
  presencia de `req.auth` — un error de configuración de Auth.js hace que
  `req.auth` sea un objeto truthy, y gatear sobre eso abre toda la API
- **Sesión de 12 h**, con re-validación de la allowlist en cada refresh
- **Cron protegido** con Bearer token
- **Object keys de R2 validadas** contra el formato exacto que emite
  `buildInvoiceKey`, y su pertenencia verificada al escribir y al firmar
- **URLs restringidas a http(s)** en los campos que se renderizan como `src`/`href`
