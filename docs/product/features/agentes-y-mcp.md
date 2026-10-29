# Agentes sobre theBook: épicas con estado de revisión y un MCP propio

> Estado: **F1 hecha y desplegada** (2026-10-28: `main` en `431ed79`, Android 0.6.0 publicada).
> **F2 hecha** (2026-10-28, en `dev`; ver "Cómo quedó F2"). F3–F6 propuestas. Se ejecuta por
> fases, cada una en su propia sesión, con este documento como brief.

## 1. Qué cambia y por qué

theBook pasa a ser el lugar donde viven las épicas abiertas de Brad y el estado que leen y
escriben los agentes. Un agente toma una épica, trabaja, pregunta y la deja en **Review** con
una nota. Solo Brad la cierra (`done` = archivar).

Para que cualquier sesión de Claude (Code en cualquier carpeta, Desktop, web) llegue a
theBook con permisos acotados, theBook expone un **MCP propio con OAuth**. El login de ese
OAuth es el mismo Google de la web.

Granularidad: un issue es una épica. El microavance no vive en el board.

## 2. Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Dónde viven las tareas | theBook | Ya es la lista de Brad. El cambio es chico: un estado, un campo, un tipo de token. |
| Estado nuevo | `review` (UI **Review**) = "le toca a Brad", sea por preguntas o por entrega | Lo que el board tiene que decir es a quién le toca. `blocked` queda para terceros. |
| Quién cierra | Solo Brad. El servidor rechaza `done` desde un token de agente | Garantía mecánica, no promesa de prompt. |
| Campos | `description` (Brad) · `agent_note` (la escribe el agente, Brad responde ahí mismo; mismo editor) · bitácora del agente (oculta por defecto) | Un dueño por campo. La nota es siempre la última pasada. |
| Microavance | Bitácora del agente en theBook, no un archivo local | Funciona desde cualquier carpeta y superficie, sin permisos de disco, y sobrevive a la sesión. |
| Conexión de Claude | MCP remoto **dentro de theBook** (`/api/mcp`); las herramientas llaman a `lib/*-service.ts` | Mismas reglas y auditoría que la web y el teléfono. Las rarezas de la API (fee negativo, `due_date`) se resuelven una vez, en el servidor, no en cada cliente. |
| Autorización | theBook es su propio servidor OAuth; el login es la sesión de Auth.js (Google + `ALLOWED_EMAILS`) | theBook emite tokens propios: audiencia theBook, cortos y revocables por conexión. Google solo dice quién eres. |
| Base del OAuth | `secretary/src/oauth.ts`, endurecido | Ya funciona con los conectores de Claude (metadatos, registro dinámico con `client_id` firmado, PKCE S256). Cambia lo de §4 F3. |
| Scripts | Siguen por REST con tokens `automation`, uno por consumidor | No son Claude. Un token por script se revoca y se audita por separado. |
| Descartado | MCP local (stdio) con token · meter theBook dentro de `secretary` | El primero agrega una capa fuera de theBook y deja el token en texto plano. El segundo saca la lógica de theBook (audita todo como `token:automation`) y hereda un login más débil para datos de finanzas. |

## 3. Cómo funciona una épica

**Estados**

- `pending` (UI **Backlog**): nadie la tomó.
- `in_progress`: le toca al agente (o a Brad, si la trabaja él).
- `review`: le toca a Brad. La primera línea de la nota dice si son preguntas o entrega.
- `blocked`: espera a un tercero; el motivo va en la nota.
- `done`: solo Brad; archiva.

**Una pasada del agente**

1. Lee la épica (descripción, nota, bitácora) y lo que cambió desde su última pasada. El diff
   lo calcula el servidor.
2. Si falta el criterio de listo, lo propone en la nota y pasa a `review`. Nunca escribe la
   descripción.
3. Trabaja. Lo que se resuelve en vivo lo pregunta en la sesión.
4. Antes de entregar, un subagente con contexto limpio revisa lo hecho contra el criterio de
   listo (ve el criterio y el diff, no la conversación).
5. Escribe la nota, actualiza bitácora y `progress`, y pasa a `review`.
6. Brad responde en la nota o en la sesión y dice "avanza": vuelve a `in_progress`. Si
   respondió en la sesión, el agente lo pasa a la nota en su próxima escritura.

**Plantilla de la nota** (siempre la última pasada; no crece)

```
🟡 Tengo preguntas | ✅ Listo para revisar
Qué hice (3–5 líneas) · Cómo revisarlo (rama, URL, comando)
Decisiones abiertas: 1. ¿A o B? Recomiendo A porque…
Siguiente propuesto · Decididas (1 línea c/u) · Sesión: <link>
```

"Siguiente propuesto" es lo que cubre las épicas que no terminan (Website tickets, Erya App):
el "avanza" de Brad aprueba o corrige el alcance de la vuelta siguiente.

**Protecciones de la nota** (las dos son del servidor, no del agente)

- **Escritura con versión base.** Si Brad editó la nota después de que el agente la leyó, el
  servidor rechaza la escritura (409). El agente relee, incorpora y reintenta.
- **Diff servido.** `issue_get` devuelve lo que Brad cambió en la nota (contra lo último que
  escribió el agente) y en la descripción (contra la última pasada). El agente no guarda copias.

## 4. Fases

Cada fase corre en su propia sesión con este documento como brief. F1–F3 y F6 corren en
`TheBook/`, para que carguen los agentes del framework. F4 corre en `~/.claude/skills/`.
Orden: **F1 → F2 → (F3 ∥ F4) → F5 → F6**. Tamaños orientativos: S ≈ 2 h · M ≈ medio día ·
L ≈ 1–2 días.

### F1 — Modelo de épicas en theBook (M) — ✅ hecha (2026-10-28)

- Estado `review` en `IssueStatus` (UI **Review**), con su columna en el board y en los filtros.
- Campo `agent_note` en `Issue` (HTML, mismo editor y `lib/text-limits.ts`), visible y editable
  bajo la descripción.
- Estado del agente 1:1 con el issue (propuesta: tabla `IssueAgentState`): bitácora (markdown),
  última nota escrita, descripción vista en la última pasada, carpeta de trabajo y link de
  sesión. Va fuera de `Issue` para no tocar la sync del teléfono.
- `ApiToken.kind` nuevo: `agent`. En `lib/issues-service.ts`, un actor `agent`:
  - **puede**: leer issues; escribir `agent_note`, la bitácora, `progress` y
    `status ∈ {in_progress, review, blocked}`.
  - **no puede**: `done`, borrar, crear, ni tocar título, descripción o fecha.
- App Android: `mobile/src/app/note/[id].tsx` tiene `STATUSES` fijo. Debe tolerar `review`, y
  hay que publicar una release.
- **Hecho cuando**:
  - la migración es aditiva (sin `DROP`) y pasa `prisma/migrations.test.ts`;
  - los tests de `issues-service` cubren cada permiso del actor `agent`, incluido `done` → 403;
  - el board muestra Review;
  - la app Android publicada no se rompe con un issue en `review`;
  - `API.md` y `PROJECT.md` están actualizados.

#### Cómo quedó F1 (supuestos y decisiones tomadas al implementar)

Commits en `dev`: `4511c52` (modelo, permisos, API, web), `44d33f1` (Android 0.6.0,
versionCode 10) y `a51e6f4` (lo que pidió la revisión de seguridad). Desplegado junto con
`431ed79` (Next.js 16.4.3 por dos advisories críticos de RCE). En producción las dos migraciones
se aplicaron sin incidentes y la 0.6.0 quedó publicada como actualización in-app.

- **Board**: In Progress, **Review**, Blocked, Backlog. Review va pegado a In Progress porque es
  el paso siguiente del flujo y lo que más pide atención. Color violeta (`#8b5cf6`), igual en el
  teléfono. Review aparece también en el filtro de estado y en el selector del detalle.
- **Estados en un solo lugar**: `ISSUE_STATUSES` en `lib/issues.ts` (sin imports), que usan Zod,
  la sync (`SyncIssueRow`) y el teléfono (`@shared/issues`). El próximo estado lo marca el
  typecheck en los dos lados.
- **`agent_note` no viaja en la sync del teléfono**, ni de bajada (`ISSUE_SELECT` es explícito)
  ni de subida (`SyncIssueFieldsSchema` no lo acepta). Escribirla mueve `Task.updated_at`, así que
  el teléfono vuelve a bajar esa fila: inofensivo, los conflictos se deciden por el hash de la
  descripción. Si el teléfono tiene que mostrar la nota, es una fase aparte.
- **`IssueAgentState`**: `last_note` y `description_seen` los pone el servidor cuando un token
  `agent` escribe `agent_note` (no se pueden mandar). Bitácora, carpeta y sesión se escriben con
  `updateAgentState` (reemplaza lo enviado). **No hay ruta REST**: la escribe el MCP de F2. El
  dueño también puede escribirlo.
- **Lo que suma F1 al contrato del agente**: tampoco puede pasar a `pending` (el backlog es de
  Brad) ni escribir nada en una tarea archivada, ni para reabrirla (si no, podría deshacer el
  `done` de Brad). `sort_order` y `note_format` también son de Brad.
- **Rutas**: `requireSession()` rechaza el token `agent` salvo que la ruta lo pida
  (`{ agent: true }`); solo lo piden `/api/issues` y `/api/issues/[id]`. Creación y borrado
  llegan al servicio y ahí son 403. Todo lo demás (finanzas, settings, auditoría, canvas,
  linked-counts, bulk-delete, sync, rutas mobile, gestión de tokens) es 403. Cerrado por
  defecto: una ruta nueva no se le abre por olvido.
- **Solo tareas** (a pedido de `security-auditor`): un token `agent` no ve las notas (fuera de la
  lista, 404 por id) ni escribe en ellas (403). Las notas son lo personal de Brad, y una nota
  nunca se archiva, así que la regla de "archivada" no la protegía. Lo que Brad escriba en una
  tarea, incluidos chips `#factura` con su monto, el agente sí lo lee: es parte de la épica.
- **Chips en la nota del agente**: la web no refresca las etiquetas de `@persona` y `#factura`
  dentro de `agent_note` (`refreshMentions={false}`). Si lo hiciera, un agente podría plantar el
  chip de cualquier factura y leer después el monto actual, guardado por la sesión de Brad.
- **COOP `same-origin`** en todas las páginas: un link de una nota (la del agente es texto que
  Brad no escribió) que abre otro sitio ya no le da `window.opener` para mandar la pestaña de
  book a un login falso.
- **Tokens `agent`** se crean en Settings → API tokens (tipo "Agent"): 14 días propuestos, 30 como
  máximo (la API rechaza más).
- **Teléfono**: la 0.5.2 publicada tolera `review` (la columna local es TEXT sin CHECK y solo hace
  lookups): muestra la píldora de estado vacía, no se rompe. El server puede salir antes que la
  app. La 0.6.0 muestra "Review" y, para un estado que no conozca, el nombre crudo. El teléfono
  sigue diciendo "Pending" donde la web dice "Backlog" (fuera de F1).

**Pendiente de la revisión de seguridad** (no bloquea F1; antes de F2 o aparte):

- El chequeo de "archivada" se lee y después se escribe: si Brad archiva en el mismo instante, la
  escritura del agente puede reabrirla. Va con las escrituras atómicas de F2.
- La auditoría guarda `token:<nombre>`; los nombres no son únicos y no queda el tipo ni qué campos
  cambiaron (una escritura solo de nota tiene before/after iguales).
- El Link del editor toma `class`, `target` y `rel` del HTML guardado; una nota puede taparse la
  pantalla con un link. Con COOP ya no hay tabnabbing; arreglarlo del todo toca el esquema
  compartido con el teléfono, que debe quedar byte a byte igual.
- `PATCH`/`POST /api/issues*` leen el body sin tope (`req.json()`); `readJsonLimited` lo acotaría.
- `canvas-service` y la sync no chequean `access` por su cuenta (hoy alcanza con la ruta); F2
  debería chequear en el servicio antes de abrir más caminos.

**Para F2** (de la revisión del modelo de datos):

- La versión base de `issue_update_note` debe cubrir las dos cosas que el agente leyó: hash de
  `agent_note` y de `description` (`textHash`, como el `base_hash` de la sync, nunca
  `updated_at`, que se mueve con cualquier edición). Si cualquiera cambió, 409. Así
  `description_seen` queda igual a lo que el agente realmente leyó. Hacerlo atómico
  (`updateMany` con la condición, count 0 → 409), no leer-y-escribir.
- `issue_write_log` debería **agregar** en el servidor (`log = log || $1`, recortando lo más viejo
  pasado `AGENT_LOG_MAX`), no reemplazar: si no, el agente relee hasta 200 000 caracteres para
  sumar una línea, y al tope recibe 400 a mitad de la épica.
- Los diffs (nota contra `last_note`, descripción contra `description_seen`) conviene calcularlos
  en markdown, pasando los dos lados por el mismo conversor: TipTap puede reserializar el mismo
  texto distinto.

### F2 — MCP de issues con token provisorio (M) — ✅ hecha (2026-10-28)

- `/api/mcp` (Streamable HTTP, sin estado) con cinco herramientas:
  - `issues_list` (filas compactas);
  - `issue_get` (markdown + diffs; bitácora opcional);
  - `issue_update_note` (con versión base);
  - `issue_update_state` (estado, progreso, carpeta);
  - `issue_write_log`.
- Conversión markdown ↔ HTML de TipTap en el servidor: el agente nunca lee ni escribe HTML.
- Auth provisoria: Bearer de un token `agent` que vence en 14 días, cargado en Claude Code con
  alcance `user`. Ese token queda en `~/.claude.json` en texto plano; F3 lo reemplaza.
- **Hecho cuando**:
  - desde una sesión de Code en una carpeta cualquiera, `issues_list` e `issue_get` responden;
  - `issue_update_state(status="done")` devuelve error;
  - la auditoría registra `token:agent`;
  - `/api/mcp` sin Bearer válido da 401.

#### Cómo quedó F2 (supuestos y decisiones tomadas al implementar)

- **SDK v2, no v1.** `@modelcontextprotocol/server` 2.4.0 en vez de `@modelcontextprotocol/sdk`:
  el v1 trae express, hono, cors y otros 14 paquetes; el v2 depende solo de zod.
  `createMcpHandler` da un `fetch` web-standard que entra tal cual en el route handler de Next
  (`app/api/mcp/route.ts`). Sin estado: un servidor nuevo por request, que cierra sobre el
  `Writer` del que llama. Sirve el protocolo de 2025 (lo que habla Claude Code hoy, por el
  *stateless fallback* del SDK, que responde por SSE) y el de 2026-07-28. Solo `POST`.
- **Auth.** `requireAgentToken()` (`lib/api.ts`): solo un token `agent`; otro tipo, 403; sin
  Bearer válido, 401 con `WWW-Authenticate` (`lib/mcp-auth.ts`, que usa también `proxy.ts`).
  El `Writer` del MCP se fija en `agent` aunque el token ya lo sea. Body con `readJsonLimited`
  (1 MiB) y el mismo rate limit de 300/min.
- **Herramientas** en `lib/mcp-issues.ts`, todas sobre `lib/issues-service.ts`. Lecturas con
  Prisma directo, como las rutas REST, y siempre `category = task`. Respuestas en JSON compacto;
  las negativas, como error de herramienta que empieza con el status (`409: …`).
  `issue_update_state` con `done`/`pending` lo rechaza el esquema de la herramienta con un
  mensaje claro, y el servicio igual devolvería 403.
- **Versión base** = `agentBase()`: 16 hex de `textHash(agent_note)` + `.` + 16 de
  `textHash(description)`. La escritura del agente en `updateIssue` es un `updateMany` con
  `category = task`, `status ≠ done` y, con base, la nota y la descripción leídas en el
  `WHERE`; count 0 → se relee para decir 404, 403 o 409. Eso cierra también la carrera de
  "archivada" del pendiente de F1.
- **Estado del agente** (bitácora, carpeta, sesión): la condición no puede ir en el `WHERE`
  (es otra tabla), así que `updateAgentState` y la nueva `appendAgentLog` bloquean la fila de la
  tarea con `SELECT … FOR UPDATE`. El mismo bloqueo serializa dos entradas de bitácora
  simultáneas (verificado contra Postgres real). Cada entrada lleva la hora de Montevideo
  (`[2026-10-28 12:04] …`), hasta `AGENT_LOG_ENTRY_MAX` (4 000); pasado `AGENT_LOG_MAX` se
  olvidan las líneas más viejas, enteras (`trimLog`).
- **Markdown ↔ HTML** en `lib/rich-text/markdown.ts`, con `@tiptap/html/server` (happy-dom con
  JS, CSS, iframes y estilos desactivados) y `@tiptap/markdown`, sobre el mismo esquema que el
  editor (`richTextExtensions`): el HTML que se guarda es el que el editor guardaría, y pasa dos
  veces por sus reglas de parseo. Para escribir se usa el esquema **sin** los dos nodos de chip,
  así que `@`, `#` y el HTML crudo quedan como texto. Rarezas de TipTap, aceptadas porque la
  vuelta las deshace: `&`, `<` y `>` salen como entidades, el subrayado como `++u++` y el
  resaltado como `==h==`; un párrafo que empieza como un bloque (`# x`, `1. x`) se lee como ese
  bloque (las reglas de entrada del editor lo convierten al escribirlo; solo pasa con texto
  pegado).
- **Diffs** unificados, con 2 líneas de contexto (una línea de cada dos es la vacía entre
  párrafos). Sin atajo de "reescrito": F5 mide los tokens antes de optimizar.
- **Auditoría.** El actor de todo token pasa a ser `token:<kind>:<name> (<prefix>)` (el prefijo
  es el que muestra Settings, y distingue nombres repetidos), y cada update guarda `changed`
  con los campos escritos, nunca el texto. Vale para el dueño también.
- **El servicio chequea el acceso por su cuenta.** `canvas-service` recibe el `Writer` en cada
  escritura y rechaza a un `agent` (tira, porque ninguna ruta debería llegar con uno), y la
  sync usa el `Writer` real en vez de un `access: "owner"` fijo.
- **Dependencias.** `happy-dom` pasó a producción, en 21.0.4: la 20.x tiene advisories altos de
  SSRF y ejecución de código al parsear HTML no confiable que solo arregla la 21 (por fuera del
  rango de *peer* `^20.8.9` de `@tiptap/html`; los tests de conversión pasan). Nuevas:
  `@tiptap/html`, `@tiptap/markdown` (trae `marked`) y `diff`.
- **Sin cambios en el contrato REST de F1**: un `PATCH` de `agent_note` con token `agent` sigue
  sin versión base. Solo el MCP la exige. Lo que sí cambió: el servicio pasa todo `agent_note`
  escrito por un `agent` por `agentHtml` (el esquema del editor sin chips), venga del MCP o del
  REST, así que plantar un chip o HTML arbitrario por REST ya no funciona.

**Revisión de `security-auditor`** (2026-10-28): sin críticos ni altos. Corregido antes del
commit:

- Batches de JSON-RPC (el protocolo de 2025 los permitía: cien llamadas por el precio de una
  contra el rate limit) → 400.
- `agent_note` en HTML crudo por REST → `agentHtml` en el servicio (arriba).
- happy-dom hace fetch de `<link rel=preload as=fetch>` en una ventana viva, y los settings de
  `@tiptap/html/server` no lo cubren. Un documento de `DOMParser` es inerte (probado), pero el
  parseo usa ahora una ventana propia con un interceptor de fetch que lo deniega todo;
  `markdown-network.test.ts` prueba 17 vectores contra un servidor que cuenta requests. Más
  happy-dom 21.0.4.
- Excepciones de una herramienta → `500: Internal error` (el SDK mandaba el mensaje, que puede
  traer la consulta de Prisma); ids con caracteres raros, `status` sin tope y diffs sin límite
  (`maxEditLength` 1 000, 200 ms) → acotados; `subscriptions/listen` apagado
  (`maxSubscriptions: 0`); la sync cambia los lados de una conexión por `canvas-service`.

Residuales:

- Los rechazos del agente (403, 409) no se auditan; solo las escrituras.
- `zod` < 4.6.6 (advisory alto de memoria con colecciones grandes) lo cierra el commit de
  dependencias que sigue; el body de 1 MiB y los `.max` ya acotan lo que llega.
- **Para F4**: la nota, la bitácora y la descripción son texto que el agente lee y que otro
  pudo escribir (inyección persistente). El protocolo de la skill `epica` tiene que tratarlas
  como datos, no como instrucciones.

**Para F3**:

- El desafío vive en un solo lugar, `mcpUnauthorized()` en `lib/mcp-auth.ts`: agregarle
  `resource_metadata="https://book.bolstro.com/.well-known/oauth-protected-resource/api/mcp"`.
- `proxy.ts` hoy contesta él mismo el 401 de `/api/mcp` y redirige a `/login` todo lo que no es
  `/api/*`: hay que abrir `/.well-known/oauth-*` y el endpoint de token.
- `bearerFromHeader` y el proxy solo reconocen Bearer `tb_…`. Si los access tokens de OAuth son
  `ApiToken` kind `agent` con ese mismo formato, `requireAgentToken` no cambia; si no, cambian
  los dos. La audiencia (`resource`) se verifica en `requireAgentToken`.
- Al terminar: `claude mcp remove thebook -s user` y revocar el token provisorio en Settings
  (si no, las herramientas aparecen duplicadas).

### F3 — OAuth: theBook como servidor de autorización (L)

- Se parte de `secretary/src/oauth.ts`, con estos cambios:

  | | `secretary` hoy | theBook |
  |---|---|---|
  | Login | contraseña compartida | sesión de Auth.js (Google + `ALLOWED_EMAILS`) + pantalla de consentimiento |
  | Access token | firmado, 30 días | `ApiToken` kind `agent`, 1 h |
  | Refresh | firmado, 180 días, sin revocación (revocar = rotar el secreto) | rotativo, 30 días, guardado en base, revocable desde Settings (cada conexión con nombre) |
  | Audiencia | no se verifica | `resource` obligatorio = `https://book.bolstro.com/api/mcp`, verificado en cada llamada |
  | Redirect URIs | las que traiga el registro | solo las de Claude (lista cerrada) |

- 401 con `WWW-Authenticate: Bearer resource_metadata=…`.
- `proxy.ts`: abrir `/.well-known/oauth-*` y el endpoint de token. `authorize` exige sesión
  (redirige a `/login` y vuelve).
- Agregar como conector en claude.ai. Queda disponible en Desktop, en la web y en las sesiones
  de Code. Después, quitar el MCP provisorio de F2 (si no, las herramientas aparecen
  duplicadas) y revocar su token.
- Revisión de `security-auditor` antes del deploy.
- **Hecho cuando**:
  - el conector se conecta pasando por Google;
  - una sesión de Code en otra carpeta ve las herramientas;
  - revocar en Settings hace que la siguiente llamada dé 401;
  - hay tests de PKCE inválido, audiencia ajena, token vencido y redirect no permitido.
- **Verificar al empezar**: qué mecanismo de registro usa hoy el conector de claude.ai
  ("published identity" / CIMD, registro automático / DCR, o cliente propio) y sus redirect
  URIs reales. La documentación de Claude no publica la URL de callback.

### F4 — Protocolo y lanzador (S)

- Skill de usuario `epica` (`~/.claude/skills/epica/`): la pasada de §3, la plantilla de la nota
  y el subagente revisor.
- Skill de usuario `lanzar`: lista las épicas abiertas, propone cuáles arrancar y abre una
  sesión por épica en su carpeta. La carpeta la pregunta la primera vez y la guarda en el
  estado del agente.
- **Hecho cuando**: una sesión nueva en otra carpeta, con solo "toma la épica X", hace una
  pasada completa y deja la épica en `review`.

### F5 — Piloto con dos épicas

- Una de código y una de documento. Se mide: tokens por pasada, cuántas veces intervino Brad y
  qué cazó el revisor.
- **Hecho cuando**: las dos llegaron a `review` al menos una vez y hay una lista de ajustes al
  protocolo.

### F6 — Finanzas al MCP, de a poco

- Primero lectura: facturas, resumen del mes, clientes, salarios.
- Después escrituras, marcadas con `_meta["anthropic/requiresUserInteraction"]: true` para que
  Claude siempre pida aprobación. Ninguna herramienta de borrado.
- Las reglas que hoy corrige `workspace-rowan-pulse/system/tools/thebook.py` del lado del
  cliente (fee negativo, `due_date` a fin de mes, adjuntar en tres pasos) pasan al servicio.
- **Hecho cuando**: por herramienta, con su test.

## 5. Residuales declarados

- **El token `automation` sigue pudiendo todo**, incluido `done` y borrar. Lo usan los scripts,
  y un agente con Bash en `workspace-rowan-pulse` llega a él a través de `thebook.py`. La red
  es la auditoría. Cierre futuro: permisos por token también para `automation`.
- **Prompt injection en finanzas.** Las herramientas que leen facturas o correos traen texto
  no confiable; por eso las escrituras de F6 piden aprobación.
- **Rate limit y lock en memoria** asumen una sola réplica (ya declarado en `CLAUDE.md`). El
  MCP hereda esa suposición.
- **La spec de autorización de MCP cambia** (última: 2025-11-25). Ver "Verificar al empezar"
  en F3.

## 6. Limpieza de seguridad (aparte, no bloquea)

- El token `automation` compartido (`workspace-rowan-pulse/.env`, que usan ~6 scripts y
  `secretary`) se separa en uno por consumidor y se mueve al Llavero.
- `thebook.py`: el docstring dice que no existe ningún borrado, pero existe `issue-borrar`.
  Hay que quitarlo o corregir el docstring.
- `~/Bolstro/theBookApp/client_secret_*.json` es una credencial de Google OAuth en disco, fuera
  del repo. Moverla al Llavero o a 1Password y borrar el archivo.
- `secretary` usa tokens de 30 días sin revocación y login por contraseña. Es aceptable para
  correo y clima; si algún día lee finanzas, aplicarle lo de F3.

## 7. Fuera de alcance

Hilos de comentarios, subtareas, asignados e historial de la nota. Si hacen falta, se está
reconstruyendo Plane dentro de una app de contabilidad.
