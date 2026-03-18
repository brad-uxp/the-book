# PWA Roadmap — TheBook

## Visión

Convertir TheBook en una Progressive Web App instalable con soporte offline,
push notifications y — en fase 2 — escritura offline con sincronización.
Objetivo final: eliminar la app Flutter y mantener un solo codebase.

---

## Fase 1 — PWA Básica (instalable + offline read + push notifications)

### 1.1 Web App Manifest
- [x] Crear `public/manifest.json` con nombre, íconos, colores, display standalone
- [x] Generar íconos PWA (192×192, 512×512) desde logo existente
- [x] Vincular manifest en `app/layout.tsx` (metadata)
- [x] Agregar `theme-color` y `apple-mobile-web-app` meta tags

### 1.2 Service Worker
- [x] Instalar y configurar `serwist` (sucesor de next-pwa, compatible con Next.js 16)
- [x] Estrategia de cache: **NetworkFirst** para API, **StaleWhileRevalidate** para assets
- [x] Pre-cache del app shell (layout, fuentes, íconos)
- [x] Pantalla offline fallback cuando no hay conexión ni cache

### 1.3 Push Notifications
- [ ] Crear modelo `PushSubscription` en Prisma (endpoint, keys, user_id)
- [ ] API route `POST /api/push/subscribe` para guardar suscripciones
- [ ] API route `POST /api/push/send` para enviar notificaciones
- [ ] Generar VAPID keys y agregar a env vars
- [ ] UI: botón para activar/desactivar notificaciones en settings
- [ ] Integrar con cron jobs existentes (recordatorios de pago, facturas vencidas)

### 1.4 Ajustes de despliegue
- [ ] Actualizar CSP en `next.config.ts` para permitir service worker
- [ ] Verificar headers de cache para manifest e íconos
- [ ] Test en Android (Chrome) e iOS (Safari 16.4+)
- [ ] Agregar pantalla de instalación (install prompt banner)

---

## Fase 2 — Offline Write + Sync (futuro)

### 2.1 Storage local
- [ ] Implementar capa de almacenamiento con IndexedDB (vía `idb` o `Dexie`)
- [ ] Definir esquema local para entidades principales (invoices, subscriptions, expenses)
- [ ] Cache de datos de lectura en IndexedDB al navegar

### 2.2 Operation Queue
- [ ] Crear sistema de cola de operaciones pendientes
- [ ] Serializar operaciones como `{ method, url, body, timestamp }`
- [ ] Persistir cola en IndexedDB
- [ ] UI indicador "pendiente de sync" (badge/dot)

### 2.3 Background Sync
- [ ] Registrar `sync` event en service worker
- [ ] Al recuperar conexión, procesar cola en orden FIFO
- [ ] Retry con backoff exponencial para fallos
- [ ] Notificar al usuario cuando sync completa o falla

### 2.4 Conflict Resolution
- [ ] Estrategia last-write-wins (suficiente para single-user)
- [ ] Agregar campo `updated_at` a entidades que no lo tengan
- [ ] Servidor retorna 409 si `updated_at` no coincide → usuario decide

### 2.5 Optimistic UI
- [ ] Mutaciones locales inmediatas con rollback en caso de error
- [ ] Indicadores visuales de estado: synced / pending / error
- [ ] Toast de error con opción de reintentar

---

## Notas técnicas

- **Service Worker lib:** `serwist` (fork mantenido de next-pwa, soporte App Router)
- **Push:** Web Push API + `web-push` npm para servidor
- **Offline storage:** IndexedDB vía `idb` (wrapper ligero)
- **Sync:** Background Sync API + fallback con visibilitychange
- **Íconos:** Generados como SVG inline o PNG desde `public/logo.svg`

---

## Estado actual

| Fase | Estado | Última actualización |
|------|--------|---------------------|
| 1.1 Manifest | ✅ Completado | 2026-03-17 |
| 1.2 Service Worker | ✅ Completado | 2026-03-17 |
| 1.3 Push Notifications | ⬜ Pendiente | — |
| 1.4 Despliegue | ⬜ Pendiente | — |
| 2.x Offline Write | ⬜ Futuro | — |
