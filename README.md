# AccountBook

Personal accounting system — subscriptions, salaries, invoices, and expense tracking.

## Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind CSS v4** + **shadcn/ui** (new-york style)
- **TanStack Table v8** — data grids
- **Recharts** — charts
- **Prisma 7** + **PostgreSQL** — database
- **Vercel** — deployment + cron
- **Timezone:** `America/Montevideo` (Uruguay)
- **Currency:** USD — amounts stored as integer cents

---

## Quick Start

### 1. Prerequisites

- Node.js 20+
- PostgreSQL database (local or remote)

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and set DATABASE_URL
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `CRON_SECRET` | optional | Secret for Vercel cron authorization |
| `ADMIN_KEY` | optional | Enables soft single-user auth guard |

### 3. Run Migrations

```bash
# Generate Prisma client
npm run db:generate

# Apply migrations (creates tables)
npm run db:migrate

# Optional: seed with demo data
npx prisma db seed
```

### 4. Start Dev Server

```bash
npm run dev
```

Open `http://localhost:3000` — it redirects to `/subscriptions`.

---

## Database Commands

| Command | Description |
|---|---|
| `npm run db:generate` | Generate Prisma client from schema |
| `npm run db:migrate` | Run pending migrations (dev) |
| `npm run db:push` | Push schema changes without migration (quick iteration) |
| `npm run db:studio` | Open Prisma Studio GUI |

For production migrations:
```bash
npx prisma migrate deploy
```

---

## Deploy to Vercel

1. **Connect repo** to Vercel.

2. **Set environment variables** in Vercel Dashboard → Settings → Environment Variables:
   - `DATABASE_URL` — your production Postgres URL (Vercel Postgres, Supabase, Neon, etc.)
   - `CRON_SECRET` — a random secret (e.g. `openssl rand -base64 32`)

3. **Vercel Cron** is configured in `vercel.json`:
   ```json
   {
     "crons": [{ "path": "/api/cron/daily", "schedule": "0 6 * * *" }]
   }
   ```
   This runs daily at 06:00 UTC (03:00 Montevideo time — early morning, before business hours).

4. **Cron Authorization**: Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` with cron requests. Set `CRON_SECRET` in both your `.env` and Vercel's environment variables.

5. **After deploying**, run migrations:
   ```bash
   DATABASE_URL="<prod-url>" npx prisma migrate deploy
   ```

---

## Soft Auth (optional)

To enable single-user access control, set `ADMIN_KEY` in your environment:

```env
ADMIN_KEY=my-super-secret-key
```

When set, all page and API requests must include one of:
- **Cookie:** `admin_key=<value>`
- **Header:** `x-admin-key: <value>`

Cron requests (protected separately by `CRON_SECRET`) are excluded from this check.

To disable auth again, unset `ADMIN_KEY` (empty string or absent).

---

## Modules

### Subscriptions `/subscriptions`
- CRUD for recurring subscriptions (monthly & annual)
- Categories: Work, Personal, Essential Service
- Payment modes: Auto (cron charges) / Manual (register by hand)
- Status: Active / Paused / Canceled
- Payment history per subscription with soft-delete support

### Salaries `/salaries`
- Manage people and their monthly salary
- Register salary payments with optional adjustments
- Salary increase reminders (schedule, apply, ignore, reschedule)

### Expenses `/expenses`
- Unified view of all subscription + salary payments
- KPI cards (total, last month, MoM change, average)
- Stacked bar chart (last 12 months, salaries vs subscriptions)
- Category pie chart for subscriptions
- Filterable data grid with detail modal

### Invoices `/invoices`
- Client management (color-coded) — inline modal
- Invoice lifecycle: `pending → accounting → sent → paid`
- Gross amount, fee, and net (received) display
- Reminder date + due date notifications

### Notifications `/notifications`
- In-app notification center with unread badge
- Filter by unread/all and by type
- Mark individual or all as read
- Populated by the daily cron job

---

## Cron Job — `/api/cron/daily`

Runs daily (idempotent). Processes:

| Event | Trigger |
|---|---|
| Auto subscription upcoming | 2 days before `due_date` |
| Auto subscription paid | On `due_date` — creates payment record |
| Manual subscription due | On `due_date` |
| Salary due | On `payday_day` of each month |
| Salary increase reminder | On `effective_date` |
| Invoice reminder | On `reminder_date` (if not paid) |
| Invoice due | On `due_date` (if not paid) |

**Idempotency:**
- Notifications: unique on `(type, entity_id, event_date)` — upsert with no update
- Subscription payments: checks for non-deleted record before inserting
- Salary payments: DB-level unique on `(person_id, period_key)`

---

## Assumptions

The spec had some ambiguities; here's how each was resolved:

| Gap | Decision |
|---|---|
| Annual subscription needs a month | Added `pay_month` (1–12) field, required when `frequency = annual`. UI shows a month selector conditionally. |
| `pay_day` clamping | If `pay_day` exceeds the month's last day (e.g., day 31 in February), it's clamped to the last day of the month. |
| No login | Auth is single-user. No login page. Optional `ADMIN_KEY` env var activates a simple middleware guard. |
| Toast notifications | Used **Sonner** (shadcn recommended) instead of deprecated toast component. |
| Cron time | Runs at 06:00 UTC = 03:00 Montevideo (early morning, low traffic). Adjust `schedule` in `vercel.json` if needed. |
| Notification unique key | Uses `(type, entity_id, event_date)` composite unique — ensures one notification per event per day per entity. |
| SubscriptionPayment uniqueness with soft-delete | DB has no unique constraint (would prevent re-creation after soft-delete). Uniqueness among non-deleted records is enforced at app level. |
| `SalaryBase` storage | Separate `SalaryBase` table (1:1 with `Person`) for clean separation. Salary increases update this table. |
| Email notifications | Not implemented (Phase 2 as specified). Only in-app notifications. |

---

## Project Structure

```
app/
├── api/
│   ├── cron/daily/       — Daily idempotent cron job
│   ├── subscriptions/    — CRUD + payments
│   ├── people/           — CRUD + salary payments + reminders
│   ├── expenses/         — Unified expense data
│   ├── invoices/         — CRUD
│   ├── clients/          — CRUD
│   └── notifications/    — Read + mark read
├── subscriptions/        — Page
├── salaries/             — Page
├── expenses/             — Page
├── invoices/             — Page
└── notifications/        — Page

components/
├── layout/               — Sidebar, NotificationBell
├── subscriptions/        — Table, Form
├── salaries/             — Table, PersonForm
├── expenses/             — Charts, Table
├── invoices/             — Table, InvoiceForm, ClientManager
└── notifications/        — NotificationList

lib/
├── db.ts                 — PrismaClient singleton
├── currency.ts           — USD formatting (cents ↔ dollars)
├── dates.ts              — Timezone-aware date utilities
├── validations.ts        — Zod schemas
└── cron-helpers.ts       — Pure cron logic helpers

prisma/
├── schema.prisma         — Database schema
└── seed.ts               — Demo data seed
```
