# TheBook — Tracker de Avance

> Última actualización: 2026-03-11
> Este archivo persiste entre sesiones de Claude. Actualizar después de cada tarea completada.

---

## Estado General

| Fase | Descripción | Estado | Progreso |
|------|-------------|--------|----------|
| 1 | Optimización de rendimiento (crítica) | ✅ Completada | 4/4 |
| 2 | Optimización de frontend | ✅ Completada | 3/3 |
| 3 | Optimización de base de datos | ✅ Completada | 2/2 (sin cambios necesarios) |
| 4 | ~~Migración a Railway~~ | ❌ Cancelada | Nos quedamos en Vercel |

---

## Fase 1: Optimización de rendimiento

| ID | Tarea | Estado | Notas |
|----|-------|--------|-------|
| 1.1 | Eliminar `force-dynamic` innecesario | ✅ Completada | Removido de admin-logs y fees (revalidate=30). Core pages mantienen force-dynamic por correctness |
| 1.2 | Fix N+1 queries en cron job | ✅ Completada | Batch fetch con Maps. De N+1 a 3 queries paralelas |
| 1.3 | Agregar paginación a endpoints | ✅ Completada | invoices, subscriptions, people. Backward-compatible (sin params = array completo) |
| 1.4 | Optimizar dashboard data fetching | ✅ Completada | De 36 a 13 meses. Bucketing O(n) con Map en vez de O(months*payments) |

## Fase 2: Optimización de frontend

| ID | Tarea | Estado | Notas |
|----|-------|--------|-------|
| 2.1 | Reemplazar `<img>` por `next/image` | ✅ Completada | layout, login, sidebar, mobile-nav — todos convertidos a Image |
| 2.2 | Lazy loading de librerías pesadas | ✅ Completada | recharts (3 charts), tiptap (IssueDetail) via next/dynamic. jsPDF ya era lazy |
| 2.3 | Optimizar notification polling | ✅ Completada | Nuevo endpoint `/api/notifications/count` — 1 query count vs 2 queries anteriores |

## Fase 3: Optimización de base de datos

| ID | Tarea | Estado | Notas |
|----|-------|--------|-------|
| 3.1 | Agregar índices faltantes en Prisma | ✅ No necesario | Todos los índices ya existían: Invoice(status, due_date, status+due_date), Notification(read_at+created_at, created_at), AuditLog(created_at, entity_type+created_at), SubscriptionPayment(subscription_id+due_date, paid_at) |
| 3.2 | Optimizar queries de expenses page | ✅ No necesario | Las 5 queries ya corren en Promise.all (paralelas). UNION raw SQL sacrificaría type safety sin ganancia real |

## ~~Fase 4: Migración a Railway~~ — CANCELADA
> Decisión: nos quedamos en Vercel. No aplica.

---

## Leyenda
- ⬜ Pendiente
- 🔄 En progreso
- ✅ Completada
- ⛔ Bloqueada (ver notas)

---

## Notas de sesión

### 2026-03-11 — Sesión inicial
- Análisis completo del proyecto realizado.
- Stack: Next.js 16, React 19, Prisma 7, PostgreSQL, shadcn/ui, TailwindCSS v4.
- 93 archivos de código, 36 API routes, 13 páginas, 62 componentes.
- Problemas críticos identificados: force-dynamic en todas las páginas, N+1 en cron, sin paginación.
- Decisión: optimizar primero, migrar a Railway después.

### 2026-03-11 — Fase 1 completada
- **1.1**: `force-dynamic` removido de `admin-logs` y `fees` (revalidate=30s). Las 5 páginas core (dashboard, invoices, subscriptions, salaries, expenses) mantienen force-dynamic porque los componentes esperan datos frescos post-mutation.
- **1.2**: `buildEmailForNotification` refactorizado de async N+1 a sync con Maps pre-cargados. 3 batch queries paralelas (subscriptions, invoices+clients, salary reminders+persons) en vez de 1 query por notificación.
- **1.3**: Paginación backward-compatible en `/api/invoices`, `/api/people`, `/api/subscriptions`. Sin params = retorna array (compatible con componentes existentes). Con `?page=1&limit=50` = retorna `{data, total, page, limit}`.
- **1.4**: Dashboard reducido de 36 a 13 meses (cubre ytd + last12). Bucketing optimizado de O(months×payments) a O(n) con Map indexado por period key.
- **Build**: `next build` exitoso sin errores.

### 2026-03-11 — Fase 2 completada
- **2.1**: Todas las `<img>` convertidas a `next/image` en layout.tsx, login/page.tsx, sidebar.tsx, mobile-nav.tsx.
- **2.2**: Lazy loading con `next/dynamic({ ssr: false })` para DashboardChart, CorporateChart, SalaryChart (recharts) e IssueDetail (tiptap). jsPDF ya estaba lazy con `await import()`. ExpenseCharts es dead code (no se importa en ningún lado).
- **2.3**: Nuevo endpoint GET `/api/notifications/count` que solo hace `prisma.notification.count()`. Context actualizado para usarlo. De 2 queries (findMany + count) a 1 query (count).
- **Build**: `next build` exitoso sin errores.

### 2026-03-11 — Fase 3 revisada (sin cambios necesarios)
- **3.1**: Revisión del schema.prisma reveló que todos los índices planificados ya existían. Schema bien optimizado desde el inicio.
- **3.2**: Las 5 queries de expenses page ya corren en Promise.all (paralelas). Consolidar en raw SQL UNION no aporta ganancia y pierde type safety.
- **Fase 4**: Cancelada. Decisión del usuario: nos quedamos en Vercel.
- **Resultado**: Todas las fases de optimización completadas. No se tocó la base de datos.
