# AccountBook — Funcionalidades

Sistema de contabilidad personal para gestionar ingresos (facturas), gastos (suscripciones, sueldos, otros), con notificaciones automáticas diarias y registro de auditoría completo.

---

## Índice

1. [Dashboard](#1-dashboard)
2. [Facturas](#2-facturas)
3. [Suscripciones](#3-suscripciones)
4. [Sueldos](#4-sueldos)
5. [Gastos](#5-gastos)
6. [Notificaciones](#6-notificaciones)
7. [Admin Logs](#7-admin-logs)
8. [Configuración](#8-configuración)
9. [Cron diario](#9-cron-diario)
10. [Autenticación](#10-autenticación)

---

## 1. Dashboard

Vista general financiera con datos históricos de hasta 36 meses y un panel de próximos vencimientos.

### Gráfico histórico
- Barras mensuales apiladas con cuatro series: **ingresos** (facturas cobradas), **sueldos**, **suscripciones** y **otros gastos**.
- Selector de rango: últimos 6, 12, 24 o 36 meses.

### Tarjetas de resumen
- Total de facturas en estado *Enviada* (cantidad y monto bruto + comisión).

### Próximos vencimientos (5 días)
Muestra los compromisos de pago inminentes agrupados por tipo:

| Tipo | Condición de aparición |
|------|------------------------|
| Suscripciones | No pagadas para el período actual o próximo |
| Sueldos | Empleados activos con payday dentro de los próximos 5 días |
| Facturas | Facturas no cobradas con due_date en los próximos 5 días |

---

## 2. Facturas

Gestión completa del ciclo de vida de facturas emitidas.

### Campos
| Campo | Tipo | Notas |
|-------|------|-------|
| `invoice_number` | Texto opcional | Identificador alfanumérico (orden numérico) |
| `client` | Relación | Cliente asociado con color visual |
| `amount_cents` | Entero | Monto bruto en centavos |
| `fee_cents` | Entero | Comisión deducible (default: 0) |
| `status` | Enum | Ver tabla de estados |
| `due_date` | Fecha | Fecha de vencimiento |
| `reminder_date` | Fecha opcional | Dispara notificación personalizada |
| `notes` | Texto opcional | Notas internas (indicador de icono en tabla) |
| `file_url` | URL opcional | Enlace al documento de factura |

### Estados
| Estado | Color | Significado |
|--------|-------|-------------|
| `pending` | Gris | Borrador, aún no enviada a contabilidad |
| `accounting` | Naranja | En revisión contable |
| `sent` | Azul | Enviada al cliente (se contabiliza en el dashboard) |
| `paid` | Verde | Cobrada |

### Filtros y ordenamiento
- **Estado:** Multi-selección (pending, accounting, sent, paid).
- **Cliente:** Multi-selección de todos los clientes.
- **Rango de fechas:** Filtra por `due_date`.
- **Orden:** Por número de factura (default) o por fecha de vencimiento.
- **Barra de totales:** Muestra suma de Monto, Comisión, Neto y cantidad de ítems del filtro activo.

### Acciones
- **Crear** — Formulario con todos los campos; incluye selector de cliente y campo de archivo.
- **Ver detalle** — Sólo lectura con cambio rápido de estado.
- **Editar** — Todos los campos editables.
- **Eliminar** — Con confirmación.

### Gestión de clientes
Modal independiente para crear, editar y eliminar clientes:
- `name` — Nombre único.
- `color_hex` — Color de identificación visual (default: `#6366f1`).

---

## 3. Suscripciones

Administración de pagos recurrentes con modo automático o manual.

### Campos
| Campo | Tipo | Notas |
|-------|------|-------|
| `name` | Texto | Nombre del servicio |
| `amount_cents` | Entero | Monto del pago |
| `frequency` | Enum | `monthly` o `annual` |
| `pay_day` | Int (1–31) | Día del mes del pago |
| `pay_month` | Int (1–12) | Solo para frecuencia anual |
| `category` | Enum | `work`, `personal`, `essential_service` |
| `payment_mode` | Enum | `auto` o `manual` |
| `status` | Enum | `active`, `inactive` |
| `icon_url` | URL opcional | Dominio para obtener favicon |
| `notes` | Texto opcional | Notas internas |

### Modo de pago
- **Auto:** El cron crea el registro de pago automáticamente en la fecha de vencimiento.
- **Manual:** El cron sólo genera la notificación de aviso; el pago debe registrarse a mano.

### Registrar pago manual
- Selección de fecha de pago.
- Calcula el `period_key` automáticamente según la frecuencia y la fecha elegida.
- Previene duplicados: no permite dos pagos para el mismo período.

### Historial de pagos
- Cada pago guarda: `period_key`, `paid_at`, `amount_cents_snapshot` (monto al momento del pago).
- Los pagos eliminados son **borrado lógico** (`deleted_at`), no se pierden.

### Filtros y ordenamiento
- Búsqueda por nombre (tiempo real).
- Orden por nombre (default).

---

## 4. Sueldos

Gestión de empleados con registro de pagos mensuales y seguimiento de aumentos.

### Empleado (Person)
| Campo | Tipo | Notas |
|-------|------|-------|
| `name` | Texto | Nombre completo |
| `payday_day` | Int (1–31) | Día del mes de pago |
| `status` | Enum | `active` o `inactive` |
| `role` | Relación opcional | Puesto/rol asignado |
| `notes` | Texto opcional | Notas internas |
| `base_salary_cents` | Entero | Sueldo base actual (en SalaryBase) |

### Registrar pago de sueldo
- Campos: `period_key` (YYYY-MM), `paid_at`, `adjustment_cents` (ajuste positivo o negativo), `adjustment_note`.
- Calcula automáticamente: `total = base + adjustment`.
- Previene duplicados por `(person_id, period_key)`.
- Cada pago guarda un snapshot del sueldo base vigente.

### Recordatorios de aumento (SalaryIncreaseReminder)
- Campos: `effective_date`, `suggested_new_base_cents`.
- Estados: `scheduled` → `done` (al aplicar) o `ignored`.
- **Aplicar:** Actualiza `SalaryBase` con el nuevo monto y marca el recordatorio como `done`.
- **Ignorar:** Marca como `ignored` sin modificar el sueldo.
- El cron genera una notificación cuando llega la fecha efectiva.

### Gestión de roles
Modal independiente para crear, editar y eliminar roles (cargos laborales).
- No se puede eliminar un rol si tiene personas asignadas.

---

## 5. Gastos

Vista unificada de todos los egresos: suscripciones, sueldos y gastos varios.

### Tipos de gastos
| Tipo | Origen | Editable |
|------|--------|----------|
| `subscription` | Pagos de suscripciones | No (sólo lectura) |
| `salary` | Pagos de sueldos | No (sólo lectura) |
| `other` | Gastos manuales | Sí |

### Gastos varios (OtherExpense)
Campos: `name`, `category` (work / personal / essential_service), `paid_at`, `amount_cents`, `period_key` (opcional), `notes`.

### Filtros
- Prefilter por suscripción o persona (desde las páginas de Suscripciones y Sueldos).
- Rango de fechas sobre `paid_at`.
- Tipo de gasto.

### Gráficos
- Barras mensuales de gastos totales.
- Torta de distribución por categoría.
- KPIs: total del período, promedio mensual, mes más alto.

---

## 6. Notificaciones

Centro de alertas generadas automáticamente por el cron diario.

### Tipos de notificaciones
| Tipo | Color | Cuándo se genera |
|------|-------|------------------|
| `subscription_auto_upcoming` | Azul | N días antes del vencimiento de una suscripción automática |
| `subscription_manual_due` | Ámbar | N días antes del vencimiento de una suscripción manual |
| `subscription_auto_paid` | Verde | En la fecha de pago de una suscripción automática (confirma pago) |
| `salary_manual_due` | Púrpura | N días antes del día de pago de un empleado |
| `salary_increase_due` | Naranja | En la fecha efectiva de un recordatorio de aumento |
| `invoice_reminder_due` | Amarillo | En la `reminder_date` de una factura |
| `invoice_due` | Rojo | N días antes del vencimiento de una factura no cobrada |

### Comportamiento
- **Deduplicación:** Constraint único sobre `(type, entity_id, event_date)` — no se crean duplicados si el cron corre más de una vez.
- **Purga automática:** El cron elimina notificaciones con más de 7 días de antigüedad.
- **Email:** Si hay `email_recipient` configurado, se envía un correo para cada notificación nueva del día (los sueldos se agrupan en un solo email).

### Acciones
- **Marcar como leída** — Individual o todas a la vez.

---

## 7. Admin Logs

Registro de auditoría completo de todas las operaciones de creación, edición y eliminación.

### Qué se registra
Cada mutación en cualquier entidad del sistema genera un log con:
- `entity_type` — Tipo de entidad (`invoice`, `client`, `subscription`, `subscription_payment`, `person`, `salary_payment`, `other_expense`, `role`).
- `entity_name` — Nombre desnormalizado para mostrar sin JOINs.
- `action` — `create`, `update` o `delete`.
- `before` — Estado anterior (JSON) — presente en updates y deletes.
- `after` — Estado nuevo (JSON) — presente en creates y updates.
- `created_at` — Timestamp de la operación.

### Filtros y paginación
- Filtro por tipo de entidad y por acción.
- Paginación de 50 registros por página con total de resultados.

### Panel de detalle (al hacer clic en una fila)
| Acción | Qué muestra |
|--------|-------------|
| `create` | Lista de campos con los valores al momento de creación |
| `delete` | Lista de campos con los valores antes de la eliminación |
| `update` | Cada campo con estado anterior/posterior; campos modificados resaltados en ámbar |

### Retención
- El cron elimina automáticamente logs con más de **12 meses** de antigüedad.

---

## 8. Configuración

Ajustes globales del sistema (registro único en base de datos).

| Configuración | Default | Descripción |
|---------------|---------|-------------|
| `email_recipient` | *(vacío)* | Dirección de email para recibir notificaciones. Si está vacío, no se envían emails. |
| `days_before_subscription` | 2 | Días de anticipación para notificar vencimientos de suscripciones |
| `days_before_salary` | 4 | Días de anticipación para notificar días de pago de sueldos |
| `days_before_invoice` | 0 | Días de anticipación para notificar vencimientos de facturas (0 = el mismo día) |

### Test de email
Botón para enviar un correo de prueba y verificar que la configuración de Gmail es correcta.

---

## 9. Cron diario

Tarea programada que corre una vez al día (`GET /api/cron/daily`), protegida por un `CRON_SECRET` en el header `Authorization: Bearer`.

### Secuencia de ejecución

```
1. Leer configuración (settings)
2. Purgar notificaciones > 7 días
3. Purgar audit logs > 12 meses
4. Procesar suscripciones activas
   ├── Auto: crear pago en la fecha de vencimiento
   ├── Auto/Manual: crear notificación N días antes
5. Procesar sueldos activos
   └── Crear notificación N días antes del payday
6. Procesar recordatorios de aumento
   └── Crear notificación en la fecha efectiva
7. Procesar facturas no cobradas
   ├── Crear notificación en reminder_date
   └── Crear notificación N días antes de due_date
8. Enviar emails de notificaciones nuevas (si hay recipient)
```

### Emails que se envían
- **Suscripción próxima** — Nombre, monto, días restantes.
- **Sueldos del día** — Lista de empleados agrupada en un solo correo.
- **Factura por vencer** — Cliente, número, monto total, fecha.
- **Recordatorio de factura** — Igual que el anterior, etiquetado como recordatorio.
- **Aumento de sueldo** — Empleado, nuevo monto sugerido, fecha efectiva.

---

## 10. Autenticación

- Implementada con **NextAuth.js**.
- Sesión requerida para acceder a cualquier página o endpoint de la app.
- Sin sesión activa, el usuario es redirigido a `/login`.

---

## Variables de entorno requeridas

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL |
| `CRON_SECRET` | Token Bearer para proteger el endpoint del cron |
| `GMAIL_USER` | Dirección de Gmail para envío de notificaciones |
| `GMAIL_APP_PASSWORD` | Contraseña de aplicación de Gmail |
| `AUTH_SECRET` | Secret de NextAuth |
| `AUTH_GOOGLE_ID` | Client ID de OAuth Google (para login) |
| `AUTH_GOOGLE_SECRET` | Client Secret de OAuth Google |
