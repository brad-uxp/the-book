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
- **TipTap** — editor de texto rico (notas y cada idea de un canvas), con @menciones y #facturas
- **React Flow** (`@xyflow/react`) — el lienzo de las notas canvas; se carga solo en esa página
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

> **No hay email.** Existió y se eliminó: Nodemailer y Gmail SMTP son de una
> versión anterior. El **login mobile viejo** (`POST /api/auth/mobile`) también se
> eliminó; el actual es otro: `/api/mobile/nonce` + `/api/mobile/sign-in`
> (ID token de Google verificado con `jose`, nonce de un solo uso, allowlist) emiten
> un `ApiToken`, y `/api/mobile/sign-out` lo revoca.
>
> **Tampoco hay PWA ni web push** desde el 2026-09-27: se quitaron a favor de la
> app React Native, que tiene **push nativo por FCM** desde la fase 5 (2026-09-28,
> `lib/fcm.ts` + `lib/push.ts`, mensajes solo de datos). En la web las notificaciones viven solo en la
> campana y en `/notifications`. `public/sw.js` no es un worker de la app: es el
> *kill switch* que desinstala el service worker viejo de los navegadores que lo
> tenían (ver su cabecera); se puede borrar unas semanas después, junto con
> `components/service-worker-cleanup.tsx` y su exclusión en `proxy.ts`.

### Infraestructura

- **Railway** — hosting y base de datos (una réplica, región `us-west2`)
- **Scheduler in-app** — `instrumentation.ts` registra `lib/daily-scheduler.ts`,
  que corre el job diario a las **13:00 UTC** (10:00 en Montevideo).
  No hay cron de plataforma. Se desactiva con `DISABLE_INAPP_CRON=1`.

⚠️ **`pnpm start` corre `prisma migrate deploy` antes de `next start`**, así que
cada arranque aplica las migraciones pendientes a producción sin intervención
humana. Una migración commiteada llega a la base en el siguiente deploy.

---

## Estructura del Proyecto

```
TheBook/
├── app/
│   ├── api/                          # 54 rutas API (REST) — ver tabla abajo
│   ├── admin-logs/page.tsx           # Logs de auditoría
│   ├── dashboard/page.tsx            # Dashboard con métricas y gráficos
│   ├── expenses/page.tsx             # Vista unificada de gastos
│   ├── fees/page.tsx                 # Comisiones por referidor
│   ├── invoices/page.tsx             # Gestión de facturas
│   ├── issues/page.tsx               # Tareas y notas (board y lista)
│   ├── issues/[id]/page.tsx          # Página propia de una nota canvas (el resto redirige al sheet)
│   ├── login/page.tsx                # Login con Google OAuth
│   ├── notifications/page.tsx        # Centro de notificaciones
│   ├── salaries/page.tsx             # Gestión de salarios y personas
│   ├── settings/page.tsx             # Configuración del sistema
│   ├── subscriptions/page.tsx        # Gestión de suscripciones
│   ├── generated/prisma/             # Cliente Prisma (gitignored, generado en build)
│   └── layout.tsx                    # Layout raíz con sidebar
├── components/
│   ├── ui/                           # 27 componentes shadcn/ui
│   ├── layout/                       # Sidebar, MobileNav, NotificationBell
│   ├── dashboard/                    # Charts, Metrics, UpcomingCards, CorporateChart
│   ├── expenses/  invoices/  salaries/  subscriptions/
│   ├── fees/                         # Referidores y comisiones
│   ├── issues/                       # Board, lista, detalle, editores inline
│   ├── note-canvas/                  # Lienzo de una nota canvas: ideas, conexiones, undo
│   ├── rich-text/                    # Editor TipTap compartido (notas e ideas) + menciones
│   ├── notifications/  settings/  admin-logs/
├── lib/
│   ├── api.ts                        # requireSession, mapeo de errores, readJson
│   ├── issues-service.ts  canvas-service.ts  # Escrituras de issues e ideas: reglas + auditoría, para las rutas REST y la sync
│   ├── audit.ts                      # Logging de auditoría (fire-and-forget)
│   ├── cron-helpers.ts               # Lógica pura del job diario (testeada)
│   ├── currency.ts                   # Centavos ↔ display (testeada)
│   ├── canvas-geometry.ts            # Anclaje de aristas y grilla (testeada)
│   ├── canvas-palette.ts             # Paleta de colores de las tarjetas (testeada)
│   ├── notes.ts                      # Formatos de nota y conversiones permitidas (testeada)
│   ├── note-canvas.ts                # Tamaños y límites de las ideas (testeada)
│   ├── mentions.ts                   # Menciones en HTML: búsqueda, conteo, sufijo de borradas (testeada)
│   ├── metrics.ts                    # Todos los números del dashboard y de /api/metrics (puro, testeado)
│   ├── metrics-server.ts             # Las consultas que alimentan lib/metrics
│   ├── daily-scheduler.ts            # Scheduler in-app
│   ├── dates.ts                      # Fechas UTC + timezone Montevideo (testeada)
│   ├── db.ts                         # Singleton de Prisma Client
│   ├── r2.ts                         # Cloudflare R2 + validación de object keys
│   ├── run-daily.ts                  # Orquestación del job diario
│   ├── google-id-token.ts            # Verificación del ID token de Google del login mobile (testeada)
│   ├── mobile-auth.ts  mobile-nonce.ts  # Política del login mobile: azp, rutas públicas, nonces firmados (testeadas)
│   ├── sync.ts                       # Reglas de la sync del teléfono: cursor, ventana, conflictos (puro, testeado)
│   ├── sync-protocol.ts              # Tipos del protocolo de sync, sin imports (la app los comparte)
│   ├── sync-server.ts                # Pull / push / refs contra la base
│   ├── validations.ts                # Esquemas Zod
│   └── utils.ts
├── brand/                            # Marca book.: SVG maestros, PNG de app, spec y fuentes (ver brand/README.md)
├── mobile/                           # App Android (Expo), proyecto pnpm aparte — ver mobile/AGENTS.md y docs/product/mobile-app.md
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

22 tablas. Todos los montos son `Int` en **centavos**; todas las fechas se
guardan como **UTC midnight**.

### Autenticación y Configuración

| Modelo             | Descripción                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| `Settings`         | Configuración global (singleton, `CHECK (id = 'singleton')`): días de anticipación de las alertas y `corporate_excluded_client_ids`, los clientes que quedan fuera de la rentabilidad corporativa (dashboard y `/api/metrics`) |
| `MobileDevice` | Token nativo de FCM de un teléfono, uno por `ApiToken` (FK con `ON DELETE CASCADE`); cerrar sesión o revocar lo borra. Destino de los push |
| `PushSubscription` | **Fuera del schema** desde 2026-09-28 (fase 1 de su borrado): la tabla sigue en la base, sin uso; la migración que la dropea va en el deploy siguiente, con `ACEPTO PERDER ESTOS DATOS` |

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

> **Past due** (derivado, no se guarda): una factura `sent` cuyo vencimiento —siempre el
> último día del mes— ya pasó en Montevideo (`isPastDue` en `lib/metrics.ts`). Se marca
> en la tabla de facturas y se cuenta en la tarjeta "awaiting payment".

### Gastos e Issues

| Modelo         | Descripción                                                          |
| -------------- | -------------------------------------------------------------------- |
| `OtherExpense` | Gasto puntual: nombre, categoría, monto, fecha                       |
| `Issue`        | Tarea o nota (`@@map("Task")`): estado, progreso, vencimiento, cliente. `status = done` **es el archivo**: no se muestra en el board, y en la lista solo bajo el filtro "Done · archived" (`lib/issues.ts`). Solo aplica a tareas: una nota nunca se archiva. `note_format` (`text` \| `canvas`) dice de qué está hecha una nota: un documento (la descripción) o un lienzo de ideas conectadas. Solo una nota puede ser canvas (`lib/notes.ts`) |
| `CanvasNode`   | Una idea de una nota canvas: HTML de TipTap (mismo formato que la descripción, así las menciones se buscan igual), color por clave de paleta, posición y tamaño. El id puede venir del cliente (UUID) |
| `CanvasEdge`   | Conexión dirigida entre dos ideas **del mismo** lienzo |
| `SyncTombstone`| Un borrado de issue, idea o conexión, para que el teléfono se entere. Lo escriben **solo triggers** `AFTER DELETE` (cubren cascadas y cualquier otra vía); se purga a los 60 días |
| `SyncMutation` | La respuesta a cada cambio que empujó el teléfono, por `mutation_id`: solo el veredicto (nunca la fila, que un reintento vuelve a leer) y el hash de lo que traía. Un reintento del mismo cambio devuelve la misma y no aplica dos veces; el mismo id con otro contenido se rechaza. Se purga a los 30 días |

### Sistema

| Modelo         | Descripción                                                                |
| -------------- | -------------------------------------------------------------------------- |
| `Notification` | 9 tipos, idempotente por `(type, entity_id, event_date)`                   |
| `AuditLog`     | Historial de cambios con snapshots JSON before/after                       |
| `ApiToken`     | Credencial de máquina (solo se guarda su sha256). `kind`: `mobile` (lo emite el login de la app; el único que acepta la sync), `automation` (hecho en Settings) o `release` (hecho en Settings; solo publica versiones de la app, todo lo demás lo rechaza) |
| `MobileRelease` | Versión publicada de la app Android (versión, `version_code` único y creciente, sha256, tamaño, clave en R2, notas, `published_at`) para las actualizaciones sin cable |

### Invariantes que la base enforza

- `SubscriptionPayment.subscription` y `SalaryPayment.person` son **`ON DELETE RESTRICT`**:
  los pagos son historia contable y no se van con su padre. La API responde 409 y
  sugiere marcar `inactive`.
- **Índice único parcial** en `SubscriptionPayment (subscription_id, due_date) WHERE deleted_at IS NULL` —
  evita cobrar dos veces el mismo período.
- **Índice único funcional** en `Invoice (lower(invoice_number)) WHERE invoice_number IS NOT NULL`.
- **CHECK `Task_canvas_only_for_notes`**: `category = 'note' OR note_format = 'text'`. Todo lo
  que mantiene un canvas fuera del board, del archivo y del job diario depende de
  `category = note`; una tarea canvas se saltaría esas reglas.
- `CanvasEdge` usa **FKs compuestas `(issue_id, node_id)`** en ambos extremos: una conexión
  entre ideas de dos notas distintas no se puede guardar. Unique `(issue_id, source_id, target_id)`
  y **CHECK `CanvasEdge_no_self_link`**. Nodos y aristas cascadean con su nota (no son historia
  contable).
- **Triggers `AFTER DELETE`** en `Task`, `CanvasNode` y `CanvasEdge` (funciones
  `sync_tombstone_issue` / `sync_tombstone_canvas`) escriben `SyncTombstone`. Sin ellos los
  borrados no llegan al teléfono y nada falla a la vista.

⚠️ Los índices parcial y funcional, los CHECK y los triggers **no se pueden expresar en `schema.prisma`**,
así que `prisma migrate dev` los ve como drift y genera su `DROP`.
`prisma/migrations.test.ts` falla el build si eso llega a pasar (y si una migración dropea o
desactiva un trigger de la sync). Si tenés que
editar una migración generada, borrá esa línea antes de commitear.

---

## Rutas API (51)

Todas exigen credencial (`requireSession()` en el handler, además del `proxy.ts`),
salvo `auth/[...nextauth]`, `cron/daily` (protegida con `CRON_SECRET`) y las dos
de entrada de la app mobile, `mobile/nonce` y `mobile/sign-in`, que verifican el
ID token de Google (incluido `azp`) y un nonce firmado de un solo uso.

Se aceptan **dos credenciales**: la cookie de NextAuth (navegador) y
`Authorization: Bearer tb_…` (máquinas). La referencia para clientes externos
está en [`API.md`](./API.md). La gestión de tokens (`/api/settings/tokens`) es
la excepción: exige sesión interactiva, porque un token que puede emitir tokens
no se puede revocar. Y la sync del teléfono (`/api/sync/*`) acepta la sesión del
navegador o un token `mobile` (los que emite el login de la app), no los tokens
`automation` hechos a mano en Settings (`requireSyncSession`).

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
| Issues bulk del.  | POST            | `/api/issues/bulk-delete`            |
| Canvas (nota)     | GET             | `/api/issues/[id]/canvas`            |
| Canvas ideas      | POST            | `/api/issues/[id]/canvas/nodes`      |
| Canvas idea       | PATCH/DELETE    | `/api/issues/[id]/canvas/nodes/[nodeId]` |
| Canvas layout     | PATCH           | `/api/issues/[id]/canvas/layout`     |
| Canvas conexiones | POST            | `/api/issues/[id]/canvas/edges`      |
| Canvas conexión   | PATCH, DELETE   | `/api/issues/[id]/canvas/edges/[edgeId]` |
| Notifications     | GET/PATCH       | `/api/notifications`                 |
| Notif. count      | GET             | `/api/notifications/count`           |
| Mark all read     | POST            | `/api/notifications/mark-all-read`   |
| Audit Logs        | GET             | `/api/audit-logs`                    |
| Settings          | GET/PATCH       | `/api/settings`                      |
| Metrics           | GET             | `/api/metrics`                       |
| Mobile nonce      | POST (público)  | `/api/mobile/nonce`                  |
| Mobile sign-in    | POST (público)  | `/api/mobile/sign-in`                |
| Mobile sign-out   | POST            | `/api/mobile/sign-out`               |
| App releases      | POST            | `/api/mobile/releases` (token release) |
| Publicar release  | POST            | `/api/mobile/releases/[code]/publish` (token release) |
| Última versión    | GET             | `/api/mobile/releases/latest`        |
| Sync notas        | GET/POST        | `/api/sync/notes`                    |
| Sync refs         | GET             | `/api/sync/refs`                     |
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

1. **Limpieza**: notificaciones > 7 días, audit logs > 12 meses, tombstones de la sync > 60 días y respuestas de la sync > 30 días
2. **Suscripciones**: aviso N días antes; en la fecha, si es `auto`, crea el pago
3. **Salarios**: aviso N días antes del día de pago
4. **Recordatorios de aumento**: aviso en la fecha efectiva
5. **Facturas**: aviso en `reminder_date` y N días antes del vencimiento
6. **Issues**: aviso para tareas que vencen hoy o mañana

Todo lo que crea queda como `Notification` en la app (campana y `/notifications`).
Además, cada notificación que la corrida **crea** (no las que ya estaban) se empuja al
teléfono por FCM como mensaje solo de datos; best effort, nunca tumba el job.

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
| Métricas                    | `lib/metrics.ts` único: dashboard y `/api/metrics` usan las mismas fórmulas |
| Auth single-user            | `ALLOWED_EMAILS` en `auth.ts`, re-chequeado en cada refresh del token  |
| Escrituras de issues        | `lib/issues-service.ts` / `lib/canvas-service.ts`: las rutas REST y la sync del teléfono pasan por el mismo código; la auditoría se escribe después del commit |
| Sync del teléfono           | Pull por cursor con ventana de 2 min; push idempotente por `mutation_id`; última escritura gana por campo, salvo el texto: en conflicto, copia |

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

# Login de la app Android (/api/mobile/sign-in). Sin MOBILE_ANDROID_CLIENT_ID el login
# mobile responde 503: falla cerrado. El de debug solo se acepta fuera de producción.
MOBILE_ANDROID_CLIENT_ID=<cliente OAuth Android de release, com.bolstro.book>
MOBILE_ANDROID_DEBUG_CLIENT_ID=<cliente OAuth Android de debug; solo en local>

# Cron
CRON_SECRET=<random bearer token>
DISABLE_INAPP_CRON=            # poné 1 para apagar el scheduler in-app

# Cloudflare R2 (adjuntos de facturas)
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=                   # opcional; por defecto <account>.r2.cloudflarestorage.com
```

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
