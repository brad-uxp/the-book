# App mobile de book

> Estado: **fase 1 en producción** (2026-09-27). **Fase 2** (sync, datos y editor)
> integrada en `feat/phase2` (2026-09-28), con los hallazgos de la revisión de seguridad de
> `/api/sync/*` corregidos (ver [Sincronización](#sincronización)); falta verificar los
> arreglos y subir a producción.
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
| **Editor**: TipTap dentro de una WebView, con un puente propio (no 10tap-editor), empaquetado en la app, con las mismas extensiones de @persona y #factura que la web. Detalle en [Editor](#editor). | Mismo editor y mismo HTML que la web. Al ir empaquetado, funciona sin conexión. |
| **Canvas**: Gesture Handler + Reanimated, con los gestos del prototipo. Zoom solo por pinch; doble toque con dos dedos para encuadrar. Tarjetas con ancho elegido y alto según el contenido, sin scroll, igual que la web desde el 2026-09-27 (`height` en la base queda como dato, no como tamaño). | 60 fps en el hilo de UI; los gestos ya se probaron en el prototipo. |
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

**Hecho (sync y datos):** ver [Sincronización](#sincronización). La home, la nota y la task
leen solo SQLite; el + crea una nota de texto (manteniéndolo: Note / Task, Canvas "arrives
soon"), búsqueda local por título y texto (sin acentos), cambio Note ↔ Task, borrar con
Undo de 6 s, autoguardado, una nota nueva vacía se descarta al salir. Un canvas se abre en
una pantalla de solo lectura con sus ideas en orden de lectura. En el header, el estado de
la sync (offline / sincronizando / cambios pendientes) y en la cuenta "Synced 2 min ago".
Salir a propósito borra las notas del teléfono (avisa si hay cambios sin subir); un token
vencido no, para que lo pendiente suba al volver a entrar.

**Hecho (editor en la nota):** la nota y la task se escriben con el editor de
[Editor](#editor), con formato y menciones, también sin señal. El editor ocupa la parte de
abajo de la pantalla y se mantiene sobre el teclado; los campos de una task (estado,
vencimiento, progreso, cliente) se pliegan mientras se escribe su texto. Las menciones `#`
llevan la etiqueta de `formatInvoiceLabel`, la misma función que usa la web. Tocar una
mención abre una hoja que dice quién o cuál es (rol y estado de la persona; cliente, monto y
estado de la factura), con lo que trajo la última sync: personas y facturas todavía no tienen
pantalla en el teléfono.

Dos reglas de la pantalla de nota que no son obvias:

- **Nunca recarga el texto encima de lo que se escribe.** Recarga solo si lo guardado
  cambió en otro lado: no mientras el texto tiene foco (el editor puede tener hasta ~600 ms de
  tecleo sin entregar) y nunca por un texto que la propia pantalla cargó o guardó (una lectura
  del store antes de que aterrice un guardado, o la respuesta del servidor a un push anterior,
  no son cambios ajenos). Lo que choca con un cambio ajeno sube como copia «(conflict)».
- **Cerrar el teclado termina la edición.** Con la página del editor enfocada, la WebView se
  quedaba con la tecla atrás y no se podía salir de la nota; al esconderse el teclado el editor
  suelta el foco (y entrega lo pendiente).

Verificado en el emulador (2026-09-28): una nota creada por API con formato y las dos
menciones se ve con sus chips; editada en el teléfono con negrita, H2, H4, lista, código, `@`
y `#`, el HTML del servidor es el que la configuración de la web conserva al cargarlo; sin red
y sin Metro (app ya abierta) se editaron dos notas y una task y se creó una nota; al volver la
red subió todo y el choque con una edición web dejó la copia «(conflict)» en el servidor y en
el teléfono. **No verificado:** un arranque en frío sin Metro — una build de desarrollo con el
bundle embebido no arranca (las herramientas de Expo lo rechazan) y una release no puede
entrar contra un servidor local; queda para el APK release en el teléfono.

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

## Sincronización

Las pantallas leen **solo** SQLite (`mobile/src/db/`, SQL a mano sobre `expo-sqlite`, sin
ORM: cinco tablas y migraciones por `PRAGMA user_version`; la 3 guarda los lados fijados de
las conexiones, para el canvas de la fase 3). Cada cambio local actualiza la
fila al instante y deja un cambio en la cola (`outbox`). El motor
(`mobile/src/sync/engine.ts`) empuja la cola en orden y después trae lo nuevo; corre al
abrir, al volver a primer plano, al volver la red, con pull-to-refresh y 2 s después del
último cambio. Si falla, reintenta con espera creciente (5 s → 5 min); un 401 lleva al login.

Servidor: `GET/POST /api/sync/notes` y `GET /api/sync/refs` (detalle en `API.md`).

- **Pull**: cursor opaco; cada pull relee 2 minutos antes del cursor (una fila se fecha al
  escribirse pero se ve al hacer commit). Página por entidad en orden (fecha, id), las cuatro
  listas en una sola foto `REPEATABLE READ`. Un cursor de más de 60 días (lo que se guardan
  los *tombstones*) pide `reset`: sync completa.
- **Borrados**: triggers `AFTER DELETE` en `Task`, `CanvasNode` y `CanvasEdge` escriben
  `SyncTombstone` — ven cascadas, el vaciado del archivo y cualquier otra vía.
- **Push**: hasta 200 cambios, cada uno en su transacción con su respuesta guardada por
  `mutation_id` (un reintento no aplica dos veces). Pasa por los mismos servicios que las
  rutas de la web (`lib/issues-service.ts`, `lib/canvas-service.ts`), así que valida y audita
  igual, con el token del teléfono como actor.
- **Conflictos**: última escritura gana por campo, salvo el texto. El teléfono manda el
  sha256 del texto del que partió su edición; si el del servidor ya es otro, el servidor
  conserva el suyo y guarda el del teléfono como copia: una nota "<título> (conflict)" (o,
  para una idea, una idea hermana 24 px más abajo). Editar con texto algo borrado en el
  servidor también termina en una copia; sin texto, se descarta. Borrar algo cuyo texto
  cambió en el servidor se rechaza y la fila vuelve.
- **En el teléfono**: una fila traída del servidor reemplaza a la local salvo en los campos
  que un cambio en cola todavía va a escribir. Un cambio que no se envió absorbe los
  siguientes de la misma fila; uno que ya viajó no se toca (su reintento devolvería la
  respuesta guardada).
- **Límites y costo** (revisión de seguridad del 2026-09-28): título ≤ 500 caracteres, texto
  ≤ 200 000 de HTML (`lib/text-limits.ts`, el mismo límite en la web, la API y el teléfono),
  sin NUL, `sort_order` de 32 bits. Un push se cobra por cambio (1000 por minuto y por
  llamante, 429 pasado eso), corre de a uno por llamante, y se corta con `more` si la
  respuesta pasa ~4 MB o tarda ~10 s: el teléfono manda el resto enseguida. De cada respuesta
  se guarda solo el veredicto (la fila se relee en un reintento) y el hash de lo que traía el
  cambio. Cada cambio bloquea (`FOR UPDATE`) la fila que juzga antes de leer su texto, así un
  autoguardado de la web no se pisa sin copia de conflicto. Solo la sesión del navegador y
  los tokens `mobile` pueden sincronizar; los `automation` reciben 403.
- **Palabras que el servidor rechaza**: un cambio que falla por sí mismo se responde
  `rejected: server_error` y el push sigue (antes frenaba la cola para siempre). Si traía
  texto que la fila del servidor no tiene, el teléfono lo guarda antes en una nota local
  "<título> (not synced)", marcada y visible en la lista; no se envía hasta que se edite. Un
  texto que pasa el límite no se encola: queda en el teléfono marcado "too long" (protegido de
  las filas del servidor y de un `reset`) hasta que se acorte.
- **Para probar con el emulador** el login de desarrollo (token pegado a mano) necesita un
  token `mobile`: uno creado en Settings es `automation` y la sync lo rechaza. Se crea con
  `UPDATE "ApiToken" SET kind = 'mobile' WHERE id = …` en la base local.

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
   de producción y eso lo impone el código), la expiración, `email_verified` y el allowlist
   **mobile**, que es solo `bradlyls95@gmail.com` (`MOBILE_ALLOWED_EMAILS`, un subconjunto
   del de la web; la cuenta de Workspace no, porque sus admins podrían resetearla y un token
   dura 90 días), y consume el nonce. El body se lee con un tope de 8 KB. Si todo pasa, emite un `ApiToken` (se guarda solo el
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

**Google Cloud**: proyecto `uxprogramming-crm` — el nombre es viejo, pero es **solo de book**. Hay dos clientes OAuth de Android para
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

## Editor

El editor de una nota en el teléfono es el TipTap de la web corriendo en una página
empaquetada dentro de la app, en una WebView (`mobile/src/editor/RichTextEditor.tsx`).

- **Mismo HTML que la web, por construcción.** Todo lo que da forma al HTML guardado
  (extensiones, marcado de las menciones, los caracteres `@`/`#`, la sincronización de
  etiquetas de personas o facturas renombradas o borradas) vive en `lib/rich-text`, sin
  React, y lo usan los dos editores. La página se compila con la **misma instalación de
  TipTap que la web** (la de la raíz). `lib/rich-text/extensions.test.ts` fija el HTML que
  escribía la web antes del cambio y comprueba que la web y la página guardan lo mismo.
- **La página**: `mobile/editor-web/` (TipTap sin React + el puente), compilada con esbuild
  por `pnpm editor:build` a un único HTML en `src/editor/editor-html.generated.ts` (no se
  versiona; `start`, `android`, `typecheck`, `lint` y el release la generan). Pide tener
  instalada la raíz del repo. Unos 366 KB.
- **Puente**: mensajes JSON por `postMessage` en los dos sentidos, validados de cada lado
  (`src/editor/protocol.ts`); nunca JavaScript armado con texto. La lista de `@`/`#` se
  dibuja en nativo sobre la barra de formato, que va pegada al teclado.
- **Cerrada**: CSP `default-src 'none'` con el script permitido solo por su hash (la
  compilación falla si el bundle nombra una URL que no sabe inerte), sin almacenamiento,
  caché, archivos ni ventanas, y toda navegación rechazada — en la página (`window.open`
  anulado, enlaces inertes) y en nativo.
- **Nada se pierde**: la página manda cada cambio en el acto y el lado nativo agrupa los
  `onChange` (300 ms, y al menos cada 2 s). Lo pendiente se entrega al perder el foco, al ir
  la app a segundo plano, al cambiar de documento (al `onChange` de ese documento) y al
  desmontar.
- **Teclado**: el editor mide dónde está en la ventana y deja libre lo que tapa el teclado
  (un `KeyboardAvoidingView` se mide contra su padre y, debajo del título de una nota, no veía
  el solapamiento). `onFocusChange` avisa a la pantalla cuando el texto toma o suelta el foco.
- **Límites**: los enlaces de una nota no se abren desde el teléfono; `#` no ofrece "crear
  factura" como en la web; una lista de personas o facturas vacía se toma como "todavía no
  cargó" y no marca nada como borrado.

## Riesgos

- **Login mobile**: es superficie de autenticación nueva sobre datos financieros. Verificar
  la firma y la audiencia del token de Google, el allowlist y la expiración, y pasar por
  una revisión de seguridad antes de producción.
- **Push data-only en Android**: con el modo de ahorro (Doze) pueden llegar tarde. Se usa
  prioridad alta; se mide en la fase 5.
- **Conflictos de sync**: la última escritura gana por fila; el texto de una nota en
  conflicto se conserva como copia para no perder nada.
