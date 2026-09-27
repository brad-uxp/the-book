# App mobile de book

> Estado: **fase 1 construida** (2026-09-27) en la rama `feat/mobile-phase1`, en `dev`.
> **No va a producción** hasta la revisión de seguridad del login mobile.
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
| **Login**: Google Sign-In nativo (Credential Manager de Android). El servidor verifica el ID token de Google contra `ALLOWED_EMAILS` y emite un `ApiToken`, revocable desde Settings. Detalle en [Login](#login). | Reusa los tokens que ya existen. ⚠️ Reabre el login mobile que se eliminó: **revisión de seguridad antes de producción**. |
| **Copy de la UI en inglés**, web y app. | Una sola lengua en las dos plataformas. |
| **Mismo repo, proyecto pnpm aparte**: la app va en `mobile/` con su propio lockfile (`mobile/pnpm-workspace.yaml` corta ahí); la web queda en la raíz. La raíz excluye `mobile/` de tsconfig, ESLint, Vitest y Tailwind. | Railway instala solo el lockfile de la raíz, sin ninguna dependencia de la app. La app reusa la lógica pura de `lib/` vía `@shared/*` (solo módulos sin imports: issues, notes, mentions, currency). |

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

**Hecho:** Notes lista los issues de `GET /api/issues` (tarjetas compactas, filtros All /
Notes / Canvas / Tasks con conteos, archivados ocultos con la regla de `lib/issues.ts`,
cliente, estado y vencimiento de las tasks, canvas marcado, pull to refresh). Invoices,
Salaries y Metrics dicen honestamente que llegan en la fase 4. Salir, desde el menú de la
cuenta, revoca el token del teléfono. Sin FAB todavía: crear notas es de la fase 2.

**Pendiente para la fase 5:** el ícono monocromo de las notificaciones. En el SDK 57 solo
se configura con el plugin de `expo-notifications`, que trae FCM, y eso es de esa fase.

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

## Login

1. La app pide un **nonce** a `POST /api/mobile/nonce`: vencimiento + 16 bytes aleatorios,
   firmados con HMAC (clave derivada de `AUTH_SECRET`). Vive 5 minutos y sirve una sola vez.
   Emitirlo no guarda nada; solo se recuerdan los ya usados, y solo un login exitoso agrega.
2. Credential Manager abre la hoja de Google y devuelve un **ID token** emitido para el
   cliente OAuth **web** de book (`AUTH_GOOGLE_ID`) y con ese nonce adentro. Los clientes
   OAuth de Android no aparecen en el código: Google solo los usa para comprobar que el APK
   es `com.bolstro.book` firmado con un certificado registrado.
3. `POST /api/mobile/sign-in` verifica con `jose` la firma contra las claves públicas de
   Google, el emisor, `aud === AUTH_GOOGLE_ID`, **`azp` === el cliente Android de release**
   (`MOBILE_ANDROID_CLIENT_ID`; el de debug, `MOBILE_ANDROID_DEBUG_CLIENT_ID`, solo vale fuera
   de producción y eso lo impone el código), la expiración, `email_verified` y el allowlist,
   y consume el nonce. El body se lee con un tope de 8 KB. Si todo pasa, emite un `ApiToken` (se guarda solo el
   hash) llamado `mobile · <modelo del teléfono>`, que **vence a los 90 días**, y lo audita
   con el email verificado. El teléfono lo guarda en `expo-secure-store` (Keystore).
4. Salir llama a `POST /api/mobile/sign-out`, que revoca solo ese token. También se puede
   revocar desde Settings → API tokens.

**Sin límites por IP**, a propósito. La revisión de seguridad del 2026-09-27 mostró que la IP
sale de un header de Railway cuyo formato no está verificado: un límite por IP sería falsificable
o compartido por todos, y en ese caso serviría para bloquear al dueño. Como un login exitoso
exige un token firmado por Google, no hay nada que adivinar; en cambio, el costo de cada
petición está acotado (body con tope, nonces sin estado, token malformado rechazado antes de
tocar la red). Los rechazos se loguean con el `X-Forwarded-For` crudo, para tener evidencia
si algún día hace falta un límite.

**Firma del release**: Gradle compila el APK sin firmar y `scripts/android-release.sh` lo firma
con `apksigner`, leyendo la contraseña del Llavero por un pipe a su stdin. La contraseña nunca
entra al entorno de Gradle ni de sus plugins.

**Google Cloud**: proyecto `uxprogramming-crm`. Hay dos clientes OAuth de Android para
`com.bolstro.book`: el de debug (SHA-1 `AF:25:E5:…:38:E6`, `~/.android/debug.keystore`) y
el de release (SHA-1 `01:D7:8A:…:D1:79`). Un `DEVELOPER_ERROR` al entrar es casi siempre un
SHA-1 o un package que no coincide.

## Compilar

Todo en local con el SDK de Android Studio y un **JDK 21** (Temurin, en
`~/Library/Java/JavaVirtualMachines`; los scripts lo buscan con `/usr/libexec/java_home -v 21`).
El JDK 25 que trae Android Studio no sirve: imprime un aviso de acceso nativo que el
plugin de Android de React Native 0.86 toma por error, y el build nativo falla.
`mobile/android/` se genera y no se versiona. Desde `mobile/`:

- `pnpm android`: debug en el emulador o el teléfono conectado. Con
  `EXPO_PUBLIC_API_URL=http://10.0.2.2:3001 pnpm start` habla con la web local (solo en
  debug, que además muestra un formulario "Use API token" para no depender de Google).
- `pnpm android:release`: APK firmado en `~/Downloads/book-<versión>-<code>.apk`. La clave
  es `~/.android/book-release.jks` (alias `book`); la contraseña sale del Llavero de macOS
  (`book. Android release keystore`) directo al entorno de Gradle. El script se niega a
  copiar el APK si el certificado no es el de release. **Sin esa clave no se pueden
  publicar actualizaciones: guarda un respaldo fuera de esta máquina.**

## Riesgos

- **Login mobile**: es superficie de autenticación nueva sobre datos financieros. Verificar
  la firma y la audiencia del token de Google, el allowlist y la expiración, y pasar por
  una revisión de seguridad antes de producción.
- **Push data-only en Android**: con el modo de ahorro (Doze) pueden llegar tarde. Se usa
  prioridad alta; se mide en la fase 5.
- **Conflictos de sync**: la última escritura gana por fila; el texto de una nota en
  conflicto se conserva como copia para no perder nada.
