# App mobile de book

> Estado: **plan aprobado** (2026-09-27). Fase 0 en curso.
>
> - Prototipo de estructura aprobado: https://claude.ai/artifact/SB2xQjdXzmKYnW2xgZQ7C6
> - Estudio de logo (elegida la **F · Full stop**, `book.` con punto violeta): https://claude.ai/artifact/ExsVzSCnKmK5DGUYeS97pD

## Qué es

Una app React Native centrada en **notas**. La home es una app de notas: los issues como
tarjetas compactas, un botón + que crea una nota de texto (manteniéndolo, Note / Canvas /
Task) y el canvas con gestos táctiles. Una barra inferior con cuatro tabs completa el
resto: **Notes · Invoices · Salaries · Metrics**. La web sigue siendo el lugar para todo lo
demás.

## Decisiones

| Decisión | Por qué |
|---|---|
| **Android primero.** Nada de la arquitectura cierra la puerta a iOS. | Es el teléfono del usuario; iOS pide una cuenta de Apple que hoy no hace falta. Expo compila las dos desde el mismo código. |
| **Expo** (framework open source de React Native), compilando **en local** con el SDK de Android Studio (`~/Library/Android/sdk`, el JDK que trae Android Studio). Sin cuenta de Expo ni EAS. | Expo es una caja de herramientas, no un servicio: no ve ni guarda datos. Compilando en local, el código tampoco sale de la máquina. |
| **Sin Firebase como base de datos.** Los datos siguen en el Postgres de Railway, a través de la API. | Ya hay backend. Firebase duplicaría los datos en Google sin aportar nada. |
| **Push directo del servidor a FCM**, con mensajes *data-only* ("algo cambió"). La app pide el detalle a la API y muestra una notificación local. | FCM es la única vía de push en Android y es la única pieza de Firebase que se usa. Así Google nunca ve el contenido. |
| **Notas sin conexión**: SQLite en el teléfono y sincronización propia (traer cambios desde un momento; empujar una cola de cambios con UUIDs generados en el teléfono). Gana la última escritura por fila; en conflicto sobre el texto de una nota, la otra versión se guarda como copia. | Escribir sin señal era un requisito. Un solo usuario con pocos datos no justifica un servicio de sync externo. |
| **Editor**: TipTap dentro de una WebView (10tap-editor), empaquetado en la app, con las mismas extensiones de @persona y #factura que la web. | Mismo editor y mismo HTML que la web. Al ir empaquetado, funciona sin conexión. |
| **Canvas**: Gesture Handler + Reanimated, con los gestos del prototipo. Zoom solo por pinch; doble toque con dos dedos para encuadrar. | 60 fps en el hilo de UI; los gestos ya se probaron en el prototipo. |
| **Login**: Google Sign-In nativo. El servidor verifica el ID token de Google contra `ALLOWED_EMAILS` y emite un `ApiToken`, revocable desde Settings. | Reusa los tokens que ya existen. ⚠️ Reabre el login mobile que se eliminó: **revisión de seguridad antes de producción**. |
| **Copy de la UI en inglés**, web y app. | Una sola lengua en las dos plataformas. |
| **Mismo repo**: la app va en `mobile/` como miembro del workspace de pnpm; la web queda en la raíz. | Railway no cambia. La app reusa la lógica pura de `lib/` (centavos, fechas, reglas de notas, geometría del canvas, métricas). |

## Fases

Cada fase termina con algo que se instala y se usa.

### 0 · Web

- Logo F definitivo, aplicado en la web (favicon, sidebar, login).
- La exclusión de clientes de la rentabilidad corporativa ("sin ACL") guardada en Settings,
  compartida por el dashboard y la app.
- Todos los números del dashboard en `lib/metrics.ts`, expuestos en `GET /api/metrics`
  (también por mes puntual, que la web no tenía).
- Facturas "past due": Sent con el mes de vencimiento terminado.
- Copy de la web en inglés.

**Se ve:** la web con el logo nuevo y la rentabilidad sin ACL siempre, sin volver a elegirla.

### 1 · Esqueleto

- App Expo con Expo Router, las 4 tabs, tema claro/oscuro y el logo.
- Login con Google → token de la API guardado en el almacenamiento seguro del teléfono.
- Listas leídas en vivo de la API.

**Backend:** `POST` de intercambio de sesión mobile (ID token de Google → `ApiToken`).
**Se ve:** tu lista de notas real en el teléfono.

### 2 · Notas y sincronización

- SQLite local y el motor de sync.
- Home, editor de texto con @ y #, tasks, cambio de tipo, todo sin señal.

**Backend:**

- Registro de borrados para la sync. Hoy los borrados de issues, ideas y conexiones son
  definitivos, y la sync necesita enterarse: un log de borrados o *tombstones*.
- Ruta de "cambios desde tal momento".
- Alta de issues con id elegido por el cliente (las ideas del canvas ya lo aceptan).

**Se ve:** una app de notas que ya se puede usar a diario.

### 3 · Canvas

Tarjetas, conexiones, hoja de edición, gestos, sin conexión.

### 4 · Negocio

- **Invoices:** lista con Awaiting / In prep / Paid, detalle, marcar como pagada, compartir
  el PDF.
- **Salaries:** quién no cobró este mes, registrar un pago, pagar a todos.
- **Metrics:** lee `GET /api/metrics`.

Estas tres tabs muestran lo último sincronizado cuando no hay señal.

### 5 · Push

**Backend:**

- Tabla de dispositivos (token FCM, plataforma, token de API asociado).
- Envío *data-only* desde el job diario.
- `PushSubscription` (de la push web, ya retirada) se borra en dos fases: primero sale del
  schema de Prisma, en el deploy siguiente la migración.

**Se ve:** avisos de vencimientos en el teléfono.

## Riesgos

- **Login mobile**: es superficie de autenticación nueva sobre datos financieros. Verificar
  la firma y la audiencia del token de Google, el allowlist y la expiración, y pasar por
  una revisión de seguridad antes de producción.
- **Push data-only en Android**: con el modo de ahorro (Doze) pueden llegar tarde. Se usa
  prioridad alta; se mide en la fase 5.
- **Conflictos de sync**: la última escritura gana por fila; el texto de una nota en
  conflicto se conserva como copia para no perder nada.
