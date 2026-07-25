# AccountBook

Personal accounting system — subscriptions, salaries, invoices, referrer fees,
expenses and tasks. Single user, in production at `book.bolstro.com`.

For the full product map — data model, all 38 API routes, the daily job and the
invariants the database enforces — see [`PROJECT.md`](./PROJECT.md).

## Stack

- **Next.js 16** (App Router) + TypeScript · **React 19**
- **Tailwind CSS v4** + **shadcn/ui** (new-york style)
- **TanStack Table v8** — data grids · **Recharts** — charts · **TipTap** — rich text
- **Prisma 7** + **PostgreSQL 18**
- **NextAuth 5 (beta)** — Google OAuth, single user
- **Cloudflare R2** — invoice attachments via presigned URLs
- **web-push** (VAPID) — notifications
- **Railway** — hosting and database
- **Timezone:** `America/Montevideo` (Uruguay)
- **Currency:** USD — amounts stored as integer cents

---

## Quick Start

### 1. Prerequisites

- Node.js 22+
- pnpm 11+ (this project is pnpm-only)
- PostgreSQL 18 (a local one is provided in `docker-compose.yml`)

### 2. Configure environment

```bash
cp .env.example .env.local
# Set DATABASE_URL and the Google OAuth credentials at minimum.
```

The full list of variables, and what each one is for, is in
[`PROJECT.md`](./PROJECT.md#variables-de-entorno).

### 3. Install and set up the database

```bash
pnpm install
pnpm db:generate          # postinstall does NOT run: ignore-scripts is on
pnpm db:migrate
```

### 4. Run

```bash
pnpm dev                  # http://localhost:3001
```

---

## Commands

```bash
pnpm dev               # dev server on port 3001
pnpm build             # prisma generate && next build --webpack
pnpm test              # vitest run
pnpm test:coverage     # vitest run --coverage
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint .
pnpm db:generate       # regenerate the Prisma client
pnpm db:migrate        # prisma migrate dev — see the warning below
pnpm db:studio         # Prisma Studio
```

### ⚠️ Before running `pnpm db:migrate`

Two indexes cannot be expressed in `schema.prisma` — a partial unique (one
payment per subscription period, ignoring soft-deleted rows) and a functional
unique (case-insensitive invoice numbers). Prisma sees them as drift and
generates `DROP INDEX` for both.

Losing the first one lets a subscription period be charged twice; losing the
second lets two concurrent creates write the same invoice number. Delete those
lines from the generated SQL before committing.

`prisma/migrations.test.ts` fails the build if such a migration is committed, so
the gate will catch it — but it is easier to not write it.

---

## Deploy

Deployed on **Railway** from `main` (project `the-book`, service `the-book`).
Railway builds with railpack and runs `pnpm start`.

- `pnpm start` runs **`prisma migrate deploy && next start`**, so **every boot
  applies pending migrations to production**. A committed migration reaches the
  database on the next deploy, with no manual step.
- The daily job runs **in-app** at 13:00 UTC (`instrumentation.ts` →
  `lib/daily-scheduler.ts`). There is no platform cron. Set `DISABLE_INAPP_CRON=1`
  to turn it off.
- `GET /api/cron/daily` triggers the same job manually, protected by
  `Authorization: Bearer $CRON_SECRET`.
- One replica. The scheduler assumes that — a second replica would run the job twice.

Environment variables live in the Railway dashboard, not in this repo.

### Backups

Take one before anything that touches the schema:

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
railway ssh -i ~/.ssh/railway_ops --service Postgres \
  "pg_dump -U \$PGUSER -d \$PGDATABASE --no-owner --no-privileges | gzip -9 | base64 -w0" \
  2>/dev/null | tr -d '\n\r ' | base64 -d > ../backups/thebook-prod-$TS.sql.gz
```

See `../backups/RESTORE.md` for verification and restore steps.

---

## Auth

Google OAuth via NextAuth 5, restricted to the addresses in `ALLOWED_EMAILS`
(`auth.ts`). Sessions last 12 hours and the allowlist is re-checked on every
token refresh, so removing an address takes effect on the next request.

Authorization is enforced twice: `proxy.ts` at the edge and `requireSession()`
inside every API handler. Both check for a real allowed email rather than the
presence of a session object — on an Auth.js configuration error `req.auth`
holds a truthy error object, and gating on that alone opens the whole API.

---

## Tests

```bash
pnpm test
```

Covers the pure business logic: money parsing and formatting (`lib/currency.ts`),
dates and day-clamping (`lib/dates.ts`), the daily job's notification rules
(`lib/cron-helpers.ts`), and a guard over the migrations.

A fail-closed `pre-commit` hook runs typecheck plus the suite before every
commit. It is not versioned — reinstall it per machine. Bypass with
`git commit --no-verify` when you mean it.

Not covered yet: the API routes, the scheduler's I/O layer, and the React
components.
