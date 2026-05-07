# AccountBook - Sistema de Contabilidad Personal

> Sistema de contabilidad personal completo y listo para producción, construido con Next.js 16, React 19, Prisma 7 y PostgreSQL. Desplegado en Vercel.

**Repositorio:** [github.com/Bradly95/system-2026](https://github.com/Bradly95/system-2026)

---

## Stack Tecnológico

### Frontend

- **Next.js 16** (App Router) + **TypeScript**
- **React 19**
- **Tailwind CSS v4**
- **shadcn/ui** (estilo new-york) — 28 componentes base (Radix UI)
- **TanStack Table v8** — tablas con sorting, filtrado y paginación
- **Recharts** — gráficos y visualizaciones
- **React Hook Form** + **Zod** — formularios y validación
- **Sonner** — notificaciones toast
- **Lucide React** — iconos
- **date-fns / date-fns-tz** — manejo de fechas con timezone

### Backend & Base de Datos

- **Prisma 7** ORM con adaptador PostgreSQL
- **PostgreSQL** como base de datos
- **NextAuth 5 (beta)** — autenticación con Google OAuth
- **Nodemailer** — envío de emails vía Gmail SMTP

### Infraestructura

- **Vercel** — hosting, deployment y cron jobs
- **Vercel Cron** — tareas diarias automatizadas (06:00 UTC)

---

## Estructura del Proyecto

```
accounting-system/
├── app/
│   ├── api/                          # 27 rutas API (REST)
│   │   ├── auth/[...nextauth]/       # Autenticación NextAuth
│   │   ├── auth/mobile/              # Login mobile (Google ID Token → JWT)
│   │   ├── subscriptions/            # CRUD suscripciones + pagos
│   │   ├── people/                   # CRUD personas + pagos salarios + reminders
│   │   ├── invoices/                 # CRUD facturas
│   │   ├── clients/                  # CRUD clientes
│   │   ├── other-expenses/           # CRUD gastos varios
│   │   ├── fee-payments/             # CRUD pagos de comisiones
│   │   ├── roles/                    # CRUD roles laborales
│   │   ├── expenses/                 # Vista unificada de gastos
│   │   ├── notifications/            # Listado + marcar como leídas
│   │   ├── audit-logs/               # Historial de auditoría
│   │   ├── settings/                 # Configuración global + test email
│   │   └── cron/daily/               # Cron job diario
│   ├── admin-logs/page.tsx           # Página de logs de auditoría
│   ├── dashboard/page.tsx            # Dashboard con métricas y gráficos
│   ├── expenses/page.tsx             # Vista unificada de gastos
│   ├── invoices/page.tsx             # Gestión de facturas
│   ├── login/page.tsx                # Login con Google OAuth
│   ├── notifications/page.tsx        # Centro de notificaciones
│   ├── salaries/page.tsx             # Gestión de salarios y personas
│   ├── settings/page.tsx             # Configuración del sistema
│   ├── subscriptions/page.tsx        # Gestión de suscripciones
│   ├── generated/prisma/             # Tipos Prisma auto-generados
│   ├── layout.tsx                    # Layout raíz con sidebar
│   └── loading.tsx                   # Estado de carga global
├── components/
│   ├── layout/                       # Sidebar, MobileNav, NotificationBell
│   ├── ui/                           # 28 componentes shadcn/ui
│   ├── auth/                         # InactivityGuard
│   ├── dashboard/                    # Charts, Metrics, UpcomingCards
│   ├── expenses/                     # ExpenseTable, ExpenseCharts, Forms
│   ├── invoices/                     # InvoicesTable, InvoiceForm, ClientManager
│   ├── notifications/                # NotificationList
│   ├── salaries/                     # SalariesTable, PersonForm, RoleManager
│   ├── settings/                     # SettingsForm
│   ├── subscriptions/                # SubscriptionsTable, SubscriptionForm
│   └── admin-logs/                   # AuditLogTable
├── hooks/
│   └── use-toast.ts                  # Hook de notificaciones toast
├── lib/
│   ├── jwt.ts                        # Utilidades JWT (sign/verify con jose)
│   ├── db.ts                         # Singleton de Prisma Client
│   ├── dates.ts                      # Utilidades de fechas (timezone Montevideo)
│   ├── email.ts                      # Templates de email + envío
│   ├── audit.ts                      # Logging de auditoría
│   ├── cron-helpers.ts               # Helpers para cron jobs
│   ├── currency.ts                   # Formateo USD (centavos → display)
│   ├── validations.ts                # Esquemas Zod
│   └── utils.ts                      # Utilidades generales
├── prisma/
│   ├── schema.prisma                 # Esquema de base de datos
│   └── seed.ts                       # Datos de demo
├── public/                           # Assets estáticos (logo, íconos)
├── middleware.ts                     # Protección de rutas (auth)
├── auth.ts                           # Configuración NextAuth
├── next.config.ts                    # Config Next.js + headers de seguridad
├── vercel.json                       # Config Vercel + cron schedule
├── prisma.config.ts                  # Config generador Prisma
├── tsconfig.json                     # Config TypeScript
└── package.json                      # Dependencias
```

---

## Esquema de Base de Datos

### Autenticación y Configuración

| Modelo     | Descripción                                                                      |
| ---------- | -------------------------------------------------------------------------------- |
| `Settings` | Configuración global (singleton): email destinatario, días de aviso anticipado   |

### Suscripciones

| Modelo                  | Descripción                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `Subscription`          | Suscripción recurrente: nombre, monto, frecuencia (mensual/anual), categoría, modo de pago       |
| `SubscriptionPayment`   | Registro de pago con soft-delete (undo): fecha de vencimiento, snapshot del monto                |

### Personas y Salarios

| Modelo                     | Descripción                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `Person`                   | Empleado/miembro del equipo: nombre, día de pago, rol, estado                       |
| `SalaryBase`               | Salario base actual (relación 1:1 con Person)                                       |
| `SalaryPayment`            | Pago de salario: snapshot base + ajuste (bonus/deducción) + nota                    |
| `SalaryIncreaseReminder`   | Recordatorio de aumento: fecha efectiva, monto sugerido, estado                     |
| `Role`                     | Puesto de trabajo (nombre único, relación con personas)                              |

### Facturas y Clientes

| Modelo    | Descripción                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `Client`  | Cliente/proyecto: nombre + color hex para identificación visual                                            |
| `Invoice` | Factura: número, cliente, monto, comisión, estado (pending→accounting→sent→paid), fecha de vencimiento     |

### Gastos

| Modelo         | Descripción                                                             |
| -------------- | ----------------------------------------------------------------------- |
| `OtherExpense` | Gasto puntual: nombre, categoría, monto, fecha, notas                   |
| `FeePayment`   | Pago de comisión (excluido del ingreso neto): nombre, monto, fecha      |

### Sistema

| Modelo         | Descripción                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------- |
| `Notification` | Notificación in-app y email: 11 tipos, idempotente por (type, entity_id, event_date)          |
| `AuditLog`     | Historial completo de cambios: entidad, acción, snapshots before/after en JSON                |

---

## Funcionalidades

### 1. Dashboard (`/dashboard`)

- **4 tarjetas KPI**: facturas pendientes de cobro, salarios pagados, suscripciones pagadas, ingreso neto
- **6 promedios mensuales**: salario, suscripciones por categoría, gastos, ingreso neto
- **Períodos**: YTD, últimos 12 meses, todo el tiempo
- **Gráfico de líneas**: Ingresos vs Gastos (desglosado por tipo)
- **Gráfico corporativo**: Rentabilidad personal vs trabajo
- **Próximos pagos**: siguiente 5 días (suscripciones, salarios, facturas)

### 2. Facturas (`/invoices`)

- **CRUD completo** con flujo de estados: `pending → accounting → sent → paid`
- **Gestión de clientes** inline con asignación de color
- **Campos**: número de factura (opcional, único), cliente, monto, comisión, fecha de vencimiento, fecha de recordatorio, URL de archivo
- **Tabla de datos** con sorting, filtrado por estado y rango de fechas
- **Notificaciones** automáticas por fecha de recordatorio y vencimiento

### 3. Suscripciones (`/subscriptions`)

- **CRUD completo**: mensuales y anuales
- **Categorías**: trabajo / personal / servicio esencial
- **Modos de pago**: automático (el cron registra el pago) / manual
- **Estado**: activa / inactiva
- **Historial de pagos** con soft-delete para undo
- **Ícono personalizable** por URL
- **Notificaciones** configurables (X días antes del vencimiento)

### 4. Salarios y Personas (`/salaries`)

- **Gestión de personas**: CRUD con roles, día de pago, salario base
- **Pagos mensuales** con ajuste opcional (bonus/deducción) y nota explicativa
- **Recordatorios de aumento**: programar, aplicar, ignorar o reprogramar
- **Gestión de roles** inline (crear/editar puestos de trabajo)
- **Vista**: nombre, rol, día de pago, salario actual, último pago, recordatorios pendientes
- **Bulk pay**: pago masivo de salarios

### 5. Gastos (`/expenses`)

- **Vista unificada**: combina pagos de suscripciones, salarios, gastos varios y comisiones
- **Gastos varios** (OtherExpense): gastos puntuales con categoría
- **Pagos de comisiones** (FeePayment): excluidos del cálculo de ingreso neto
- **KPIs**: total, último mes, cambio MoM, promedio
- **Gráfico de barras apiladas**: últimos 12 meses por tipo
- **Gráfico de torta**: desglose de suscripciones por categoría
- **Filtros**: por tipo, rango de fechas, categoría

### 6. Notificaciones (`/notifications`)

- **11 tipos de notificación**: suscripción auto/manual, salario, aumento, factura vencimiento/recordatorio
- **Centro in-app** con badge de no leídas en sidebar
- **Filtros**: leídas/no leídas, por tipo
- **Acciones**: marcar individual o todas como leídas
- **Paginación** por página y límite
- **Email**: envío automático vía cron (templates en español)
- **Purga automática**: notificaciones de más de 7 días eliminadas por cron

### 7. Configuración (`/settings`)

- **Email destinatario** para notificaciones
- **Días de aviso anticipado** (0-30): suscripciones, salarios, facturas
- **Test de email**: enviar correo de prueba para verificar configuración

### 8. Logs de Auditoría (`/admin-logs`)

- **Registro de todas las acciones** CRUD (crear, actualizar, eliminar)
- **Snapshots JSON** del estado antes y después del cambio
- **Nombre de entidad desnormalizado** para display rápido sin JOINs
- **Retención**: 12 meses (purgados por cron)
- **Muestra**: últimos 50 registros con conteo total

### 9. Autenticación

- **Google OAuth** via NextAuth 5
- **Acceso single-user**: emails autorizados exportados desde `auth.ts` (`ALLOWED_EMAILS`)
- **Middleware** protege todas las rutas excepto login, auth y cron
- **Guard de inactividad**: aviso a los 55 min, logout automático a los 60 min
- **Página de login** con branding personalizado

### 10. Autenticación Mobile

- **Google Sign-In** nativo desde la app Flutter
- **Endpoint**: `POST /api/auth/mobile` acepta `{ google_id_token }` o `{ email, secret }` (legacy)
- **Verificación**: el ID token se valida contra `oauth2.googleapis.com/tokeninfo`, se verifica que el audience coincida con `AUTH_GOOGLE_ID` y que el email esté en `ALLOWED_EMAILS`
- **JWT**: se genera con `jose` (compatible con Edge Runtime), expiración 7 días, firmado con `JWT_SECRET`
- **Middleware dual**: acepta cookies NextAuth (web) y Bearer JWT (mobile) — ambos flujos coexisten
- **CORS**: headers configurados en `next.config.ts` para `/api/*` (`Access-Control-Allow-Origin: *`)

---

## Rutas API (27 endpoints)

| Recurso              | Método          | Ruta                                   |
| -------------------- | --------------- | -------------------------------------- |
| Auth                 | GET/POST        | `/api/auth/[...nextauth]`             |
| Auth Mobile          | POST            | `/api/auth/mobile`                     |
| Subscriptions        | GET/POST        | `/api/subscriptions`                   |
| Subscription         | GET/PATCH/DEL   | `/api/subscriptions/[id]`              |
| Sub. Payments        | GET/POST        | `/api/subscriptions/[id]/payments`     |
| Sub. Payment         | GET/DELETE      | `/api/subscription-payments/[id]`      |
| People               | GET/POST        | `/api/people`                          |
| Person               | GET/PATCH/DEL   | `/api/people/[id]`                     |
| Salary Payments      | GET/POST        | `/api/people/[id]/payments`            |
| Salary Payment       | GET/PATCH/DEL   | `/api/salary-payments/[id]`            |
| Salary Reminders     | GET/POST        | `/api/people/[id]/reminders`           |
| Roles                | GET/POST        | `/api/roles`                           |
| Role                 | GET/PATCH/DEL   | `/api/roles/[id]`                      |
| Invoices             | GET/POST        | `/api/invoices`                        |
| Invoice              | GET/PATCH/DEL   | `/api/invoices/[id]`                   |
| Clients              | GET/POST        | `/api/clients`                         |
| Client               | GET/PATCH/DEL   | `/api/clients/[id]`                    |
| Other Expenses       | GET/POST        | `/api/other-expenses`                  |
| Other Expense        | GET/PATCH/DEL   | `/api/other-expenses/[id]`             |
| Fee Payments         | GET/POST        | `/api/fee-payments`                    |
| Fee Payment          | GET/PATCH/DEL   | `/api/fee-payments/[id]`               |
| Notifications        | GET/PATCH       | `/api/notifications`                   |
| Mark All Read        | POST            | `/api/notifications/mark-all-read`     |
| Audit Logs           | GET             | `/api/audit-logs`                      |
| Settings             | GET/PATCH       | `/api/settings`                        |
| Test Email           | POST            | `/api/settings/test-email`             |
| Cron Daily           | GET             | `/api/cron/daily`                      |

---

## Cron Job Diario (`/api/cron/daily`)

**Horario:** 06:00 UTC (03:00 AM hora de Montevideo)
**Protección:** Bearer token `CRON_SECRET`
**Idempotente:** seguro de ejecutar múltiples veces

### Tareas (en orden)

1. **Limpieza**: eliminar notificaciones > 7 días, audit logs > 12 meses
2. **Suscripciones auto**: crear notificación N días antes + crear pago en fecha de vencimiento
3. **Suscripciones manual**: crear notificación de vencimiento
4. **Salarios**: crear notificación N días antes del día de pago
5. **Recordatorios de aumento**: crear notificación en fecha efectiva
6. **Facturas**: notificación en fecha de recordatorio + N días antes del vencimiento
7. **Envío de emails**: agrupar notificaciones de salario, enviar individuales para suscripciones/facturas

---

## Patrones Técnicos Clave

| Patrón                    | Implementación                                                          |
| ------------------------- | ----------------------------------------------------------------------- |
| Moneda                    | Almacenamiento en centavos (integer) para evitar errores de punto flotante |
| Timezone                  | `America/Montevideo` (UTC-3), fechas almacenadas como UTC midnight      |
| Day clamping              | pay_day=31 en Feb → automáticamente 28/29                              |
| Soft-delete               | `deleted_at` en pagos de suscripción (permite undo)                     |
| Audit logs                | Fire-and-forget (nunca bloquea requests), nombre desnormalizado          |
| Notificaciones idempotentes| Unique en `(type, entity_id, event_date)` — upsert sin update          |
| Validación                | Zod schemas en todas las APIs, errores con `flatten()`                  |
| Settings singleton        | Una sola fila global de configuración                                   |
| Auth single-user          | Email autorizado hardcodeado en `auth.ts`                               |

---

## Variables de Entorno

```env
# Base de datos
DATABASE_URL=postgresql://user:password@host:port/dbname?sslmode=require

# Autenticación (Google OAuth)
AUTH_SECRET=<openssl rand -base64 32>
AUTH_GOOGLE_ID=<from Google Cloud Console>
AUTH_GOOGLE_SECRET=<from Google Cloud Console>

# Notificaciones y Cron
CRON_SECRET=<random bearer token>
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=<16-char Google App Password>

# Autenticación mobile
JWT_SECRET=<openssl rand -base64 64>
MOBILE_AUTH_SECRET=<openssl rand -base64 32>
```

---

## Comandos de Desarrollo

```bash
npm run dev            # Servidor de desarrollo (localhost:3000)
npm run build          # Build de producción
npm run db:generate    # Generar tipos Prisma
npm run db:migrate     # Ejecutar migraciones
npm run db:seed        # Seed de datos de demo
npm run db:studio      # Abrir Prisma Studio (GUI)
```

---

## Seguridad

- **Headers HTTP**: X-Robots-Tag (noindex), X-Frame-Options (DENY), HSTS, CSP restrictivo, Permissions-Policy
- **Middleware de auth** en todas las rutas protegidas
- **Cron protegido** con Bearer token
- **Inactivity guard**: logout automático tras 60 min de inactividad
