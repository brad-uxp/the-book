# Notas canvas: un lienzo de ideas dentro de una nota

> Estado: **implementado** (2026-09-27), incluido el paso 7: los datos del canvas viejo se
> borran con `20260927190000_drop_retired_canvas`, en un deploy posterior al código que
> ya no los nombra. Ver §10 para lo que cambió respecto de este diseño al implementarlo.

## 1. Qué cambia y por qué

Hoy Issues tiene tres vistas: board, list y canvas. El canvas **global** pone todas las
issues (tareas y notas) como tarjetas y deja conectarlas con `IssueLink`, con chips de texto
(`CanvasLabel`) encima. La premisa (conectar tareas y notas entre sí) no se sostuvo: son
conceptos distintos y casi no se relacionan, así que la vista aporta poco.

Lo que sí hace falta es un **lienzo libre para conectar ideas, dentro de una idea padre**:

- Una nota puede tener uno de dos **formatos**:
  - `text`: la nota de hoy, un documento de texto enriquecido.
  - `canvas`: la nota **es** un lienzo, con nodos conectados entre sí.
- Cada nodo contiene **texto enriquecido** (el mismo editor que la nota de texto).
- **No hay canvas dentro de canvas**: un nodo solo tiene texto, nunca otro lienzo.
- La idea padre es la nota misma: su título encabeza el lienzo.

Y el canvas global **se elimina**.

## 2. Decisiones de diseño

### D1. `format` en la nota, no una tercera categoría ✅ recomendado

Se agrega `note_format: text | canvas` a `Issue`. `category` sigue siendo `task | note`.

Por qué: una nota canvas **es una nota** y tiene que cumplir todas sus reglas: no tiene status,
no aparece en el board, no se archiva (`lib/issues.ts`), el job diario la ignora
(`run-daily.ts` filtra `category: "task"`) y en la lista muestra "—" en status, progreso y
fecha. Con `category = note` todo eso sale gratis. Una tercera categoría obligaría a tocar
cada `category === "note"` del código (list, board, archivo, cron, conversión,
linked-issues), y todos los que no se tocaran tratarían al canvas como si fuera una
tarea. Además, agregar un campo al contrato de `/api/issues` no rompe nada. Agregar un
valor al enum sí puede romper a un cliente con API token que haga matching exhaustivo.

Un CHECK en la base garantiza que solo una nota puede ser canvas:
`category = 'note' OR note_format = 'text'`.

### D2. Nodos y aristas en tablas propias, no un JSON en la issue ✅ recomendado

`CanvasNode` y `CanvasEdge` son filas con FK a la nota, no un blob `canvas Json`.

- **Integridad en la base**, que es la línea del proyecto ("Make the database enforce what the
  code only promised"). Una arista con FK compuesta `(issue_id, node_id)` **no puede** unir
  nodos de dos lienzos distintos ni apuntar a un nodo borrado. Con JSON eso queda en manos
  del código.
- **Guardado por nodo.** Escribir en un nodo manda un PATCH de ese nodo y no reescribe el
  lienzo entero en cada tecla. Con dos pestañas, lo peor que pasa es que gana la última
  escritura **de ese nodo**, no la del lienzo completo.
- **Las menciones siguen siendo consultables.** "Linked Issues" de personas y facturas busca
  `data-mention-id` en el HTML. Con filas es un `OR canvas_nodes.some.content contains`.
  Con JSON sería texto dentro de JSON.

### D3. IDs generados en el cliente ✅ recomendado

El navegador genera `crypto.randomUUID()` para cada nodo y arista, y el servidor lo acepta
(validado como UUID; un duplicado da 409).

Esto resuelve el problema que documentó el commit de los chips: crear algo de forma
optimista con un id temporal obliga a cambiarlo cuando responde el servidor, React Flow
remonta el nodo y **se pierde lo que se estaba escribiendo**. Con el id definitivo desde el
primer momento, crear un nodo es instantáneo **y** se puede editar enseguida. De paso,
**deshacer un borrado** se vuelve trivial: se re-POSTea la misma fila con el mismo id.

### D4. El lienzo vive en su propia ruta: `/issues/[id]` ✅ recomendado

Una nota canvas no cabe en el sheet lateral de detalle. Al abrirla se navega a
`/issues/<id>`, una página con el lienzo a pantalla completa (el botón de expandir ya existe
en el canvas de hoy). Ventajas: funciona el botón "atrás", sobrevive un refresh, se puede
compartir el link, y **los nodos se cargan solo al abrir esa nota** (la página de Issues no
carga el contenido de todos los lienzos). El deep link `/issues?issue=<id>` (el que usa
Linked Issues) redirige ahí cuando la nota es canvas.

### D5. Edición inline en el nodo (desktop); sheet en mobile ✅ recomendado

Es la esencia de un lienzo de ideas: se escribe donde está la idea (así funcionan Obsidian
Canvas y Heptabase).

- Cada nodo monta un TipTap **read-only**. Doble clic (o Enter con el nodo seleccionado) lo
  pasa a editable, con el cursor donde se hizo clic, sin remontar nada. Se sale con Escape o
  con un clic afuera.
- `onlyRenderVisibleElements` de React Flow monta solo los nodos visibles, así que un lienzo
  grande no tiene cien editores vivos.
- Delete/Backspace no borra el nodo mientras se escribe: React Flow ya ignora las teclas que
  vienen de un `contenteditable` (verificado en `@xyflow/system`, `isInputDOMNode`).
- En mobile, editar inline con el teclado virtual y zoom funciona mal. Tocar un nodo abre su
  contenido en un sheet inferior con el mismo editor.

### D6. Los nodos tienen el mismo texto enriquecido que la nota, con @ y # ✅ recomendado

"Texto enriquecido como la nota" implica lo mismo: negrita, headings, listas, código,
**@personas y #facturas**. Para no duplicar ~600 líneas, primero se **extrae el editor** de
`issue-detail.tsx` a un `RichTextEditor` compartido (TipTap, menciones, popovers, crear
factura desde #). La nota de texto y los nodos usan el mismo componente.

Consecuencia: "Linked Issues" (`GET /api/issues?personId=` / `invoiceId=`) y
`/api/issues/linked-counts` también buscan en el contenido de los nodos, contando una vez
por nota.

### D7. Conversiones permitidas (v1)

| Desde → hacia | ¿Se puede? | Qué pasa |
|---|---|---|
| tarea ↔ nota de texto | ✅ (como hoy) | sin cambios |
| nota de texto → canvas | ✅ | la descripción pasa a ser el primer nodo, en la misma transacción |
| canvas → nota de texto | ❌ v1 | tendría que aplanar nodos y perder aristas; queda para después |
| canvas → tarea | ❌ | una tarea no tiene lienzo; la API responde 409 |

### D8. El canvas global se elimina, en dos pasos ⚠️

1. **Se quita la vista, sus rutas API y sus componentes.** No es destructivo: las tablas y
   columnas quedan en la base, sin uso.
2. **Se dropean `IssueLink`, `CanvasLabel` y `Task.canvas_x/canvas_y`** en una migración
   aparte, con `ACEPTO PERDER ESTOS DATOS` y **tu OK explícito**. Antes se cuentan las filas en
   producción (Railway aplica la migración sola en el deploy desde `main`).

## 3. Modelo de datos

```prisma
enum NoteFormat {
  text
  canvas
}

model Issue {
  // … campos actuales …
  note_format  NoteFormat   @default(text)   // las notas existentes quedan en `text`
  canvas_nodes CanvasNode[]
  canvas_edges CanvasEdge[]
}

/// Una idea dentro de una nota canvas. `content` es HTML de TipTap, el mismo
/// formato que Issue.description (así las menciones se parsean igual).
model CanvasNode {
  id         String   @id @default(uuid())   // el cliente puede proveerlo (D3)
  issue_id   String
  content    String   @default("") @db.Text
  color      String?                          // clave de paleta, null = neutro
  x          Float
  y          Float
  width      Float    @default(280)
  height     Float    @default(160)
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  issue     Issue        @relation(fields: [issue_id], references: [id], onDelete: Cascade)
  edges_out CanvasEdge[] @relation("CanvasEdgeSource")
  edges_in  CanvasEdge[] @relation("CanvasEdgeTarget")

  @@unique([issue_id, id])   // destino de la FK compuesta de las aristas
}

/// Conexión dirigida entre dos ideas del MISMO lienzo. La FK compuesta
/// (issue_id, node_id) hace imposible unir nodos de dos notas distintas.
model CanvasEdge {
  id         String   @id @default(uuid())
  issue_id   String
  source_id  String
  target_id  String
  created_at DateTime @default(now())

  issue  Issue      @relation(fields: [issue_id], references: [id], onDelete: Cascade)
  source CanvasNode @relation("CanvasEdgeSource", fields: [issue_id, source_id], references: [issue_id, id], onDelete: Cascade)
  target CanvasNode @relation("CanvasEdgeTarget", fields: [issue_id, target_id], references: [issue_id, id], onDelete: Cascade)

  @@unique([issue_id, source_id, target_id])
  @@index([issue_id, target_id])
}
```

Solo en la migración, porque Prisma no los expresa. Van a `PROTECTED_CONSTRAINTS` de
`prisma/migrations.test.ts` para que un `migrate dev` no los borre sin que nadie lo note:

- `Task_canvas_only_for_notes`: `CHECK (category = 'note' OR note_format = 'text')`
- `CanvasEdge_no_self_link`: `CHECK (source_id <> target_id)`

Las FK compuestas compartiendo `issue_id` con la relación a `Issue` se validan con
`prisma validate` en el paso 1. Si Prisma se resiste, el plan B es validar en la API que
ambos nodos pertenezcan a la nota, con un test.

**Auditoría.** Se audita la nota como hoy (incluyendo `note_format`) y el **borrado de nodos
con su contenido en `before`**, de modo que un nodo borrado por error se pueda recuperar
desde el audit log. No se auditan posiciones, tamaños, ediciones de contenido ni aristas:
es estado del lienzo, y auditarlo taparía la historia importante (el mismo criterio que hoy
se aplica a las posiciones).

## 4. API

Todas con `requireSession()`, Zod y `toApiResponse`, como el resto. Si la nota no existe:
404. Si la nota no es canvas: 409.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/issues/{id}/canvas` | `{ nodes, edges }` |
| POST | `/api/issues/{id}/canvas/nodes` | crea `{id?, x, y, width?, height?, content?, color?}` → 201 |
| PATCH | `/api/issues/{id}/canvas/nodes/{nodeId}` | `content` / `color`; solo escribe las claves enviadas |
| DELETE | `/api/issues/{id}/canvas/nodes/{nodeId}` | borra el nodo (y sus aristas, por cascada); 404 = ya borrado |
| PATCH | `/api/issues/{id}/canvas/layout` | lote `{nodes: [{id, x, y, width?, height?}]}` (máx. 1000), sin auditar |
| POST | `/api/issues/{id}/canvas/edges` | `{id?, source_id, target_id}` → 201; duplicado 409; auto-enlace o nodo ajeno 400 |
| DELETE | `/api/issues/{id}/canvas/edges/{edgeId}` | 404 = ya borrada |

Cambios en las rutas existentes:

- `IssueSchema` suma `note_format`. En POST, `canvas` con `category: task` da 400.
- `PATCH /api/issues/{id}` aplica la tabla de D7 (text→canvas en una transacción; los
  demás casos prohibidos dan 409).
- `GET /api/issues?personId|invoiceId` y `linked-counts` también buscan en `CanvasNode.content`.
- Límites: `content` hasta 200 000 caracteres por nodo y coordenadas acotadas por
  `CANVAS_BOUND`, como hoy.

Se eliminan: `/api/issues/canvas` (PATCH), `/api/issues/canvas/labels[/id]` y
`/api/issues/links[/id]`. **Es un cambio que rompe el contrato de la API**, pero de bajo
riesgo: `API.md` nunca documentó esas rutas (solo aparecen en `PROJECT.md`).

## 5. UX

### Página de Issues

- El selector de vista queda en **board | list**. Si alguien tenía guardado `canvas` en
  localStorage, cae al board (ya ocurre hoy con cualquier valor que no reconoce).
- En la lista, las notas canvas llevan un ícono propio (`Waypoints`) y **al hacer clic se
  navega** a `/issues/<id>` en lugar de abrir el sheet.
- En la vista lista, "New Issue" pasa a ser un menú: **Note** / **Canvas**. El board sigue
  creando tareas directamente.
- En el menú de la fila, las notas de texto ganan "Convert to canvas" (con un diálogo que
  explica que la descripción pasa a ser el primer nodo). Las notas canvas no muestran
  "Convert to task".
- En el sheet de una nota de texto, el selector Type ofrece **Task · Note · Canvas**.
  Elegir Canvas es la misma conversión; después se navega al lienzo.

### Página del lienzo `/issues/[id]`

```
┌───────────────────────────────────────────────────────────────────────┐
│ ← Issues   Título de la idea padre ✎      ● Cliente ▾     [+] [⤢]     │
├───────────────────────────────────────────────────────────────────────┤
│  · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · │
│    ┌───────────────────┐            ┌───────────────────┐             │
│    │ Hipótesis         │───────────▶│ Riesgos           │             │
│    │ Si bajamos el fee │            │ • churn           │             │
│    │ con @Ana …        │            │ • #F-0042 atrasada│             │
│    └───────────────────┘            └───────────────────┘             │
│              │                                                        │
│              ▼                                                        │
│    ┌───────────────────┐                                              │
│    │ Próximo paso      │  ← seleccionado: paleta de color + resize    │
│    └───────────────────┘                                              │
└───────────────────────────────────────────────────────────────────────┘
```

| Gesto | Resultado |
|---|---|
| Doble clic en un espacio vacío | nodo nuevo ahí, ya en edición |
| Botón `+` | nodo nuevo en el centro de la vista, ya en edición |
| Arrastrar desde el punto de un nodo y soltar sobre otro nodo | conexión |
| Arrastrar desde el punto de un nodo y soltar en el vacío | **nodo nuevo conectado** ahí, en edición (el gesto de mapa mental) |
| Clic en un nodo | lo selecciona: aparecen las manijas de ancho (izquierda y derecha) y la barra de color |
| Doble clic / Enter en un nodo | edición inline con bubble menu, @ y # |
| Escape / clic afuera | sale de la edición |
| Delete / Backspace (sin estar editando) | borra lo seleccionado; toast **"Undo"** durante ~6 s |
| Dos dedos / pinch / shift+arrastrar | paneo, zoom, selección múltiple (como hoy) |

- **Las tarjetas no tienen scroll.** El ancho lo decide el usuario (manijas a izquierda y
  derecha); el alto se calcula solo según el contenido, siempre con el mismo padding
  inferior. Al ensanchar una tarjeta baja su alto; al angostarla, crece. La columna
  `height` de `CanvasNode` sigue existiendo, pero ningún cliente la usa para dibujar.
- Las aristas flotan: se reutiliza `FloatingEdge` y `edgeAnchor` (con sus tests). Llevan
  flecha y no tienen etiqueta en v1.
- El título y el cliente se editan en el header con los mismos `InlineTitle` e
  `InlineClient` de hoy.
- El viewport se recuerda **por lienzo** (clave de localStorage con el id).
- Autoguardado: contenido con debounce de 500 ms por nodo y layout en lote cada 400 ms. En
  ambos casos hay flush con `keepalive` al salir: es el mismo patrón que ya protege las
  posiciones.
- Estados: cargando (skeleton del lienzo), vacío ("Double-click anywhere to add your first
  idea"), error de guardado (toast y rollback, como hoy) y nota inexistente (404 con link a
  Issues).
- El copy va en inglés para ser consistente con el resto del módulo, aunque `CLAUDE.md` pide
  español en la UI. Si quieres, se pasa todo el módulo en otro momento.

## 6. Qué se elimina o se reutiliza

| Pieza | Destino |
|---|---|
| `issues-canvas.tsx`, `canvas-label-node.tsx` | se borran |
| `canvas-node.tsx` | la tarjeta de issue se borra; `FloatingEdge` pasa al lienzo nuevo |
| `lib/issue-canvas.ts` | quedan `edgeAnchor`, `snapToGrid`, `GRID_SIZE` y `CANVAS_BOUND`; salen `layoutUnplaced`, `isPlaced` y `CARD_*` |
| `lib/canvas-labels.ts` | la paleta se reutiliza para el color de los nodos (se renombra a `canvas-palette.ts`) |
| `IssuesView` | salen la vista canvas, el estado de links y labels y sus handlers (~350 líneas) |
| `app/issues/page.tsx` | deja de cargar links y labels |
| Validaciones `CanvasPositions*`, `CanvasLabel*`, `IssueLink*` | se reemplazan por las del lienzo nuevo |
| Copy del diálogo de bulk delete ("canvas connections") | se ajusta |
| `PROJECT.md`, `API.md` | se actualizan |

## 7. Riesgos

1. **Migración destructiva (paso D8.2)** que se aplica sola en producción. Va aparte, con
   conteo previo de filas y tu OK.
2. **Refactor del editor**: extraerlo de `issue-detail.tsx` (993 líneas) puede romper las
   menciones de las notas actuales. Se hace en un commit sin cambio de comportamiento y se
   verifica a mano: @persona, #factura, crear factura desde # y chip "(eliminado)".
3. **Rendimiento con muchos nodos**: un TipTap por nodo visible. Lo mitiga
   `onlyRenderVisibleElements`; si algún lienzo supera unos ~200 nodos visibles a la vez, se
   renderizan como HTML estático los que no están en edición.
4. **Concurrencia**: con dos pestañas sobre el mismo nodo gana la última escritura (es
   single-user; es aceptable).
5. **Mobile**: editar funciona vía sheet, pero no es la experiencia objetivo.
6. **Búsqueda**: el buscador de la lista busca solo por título, no dentro de los nodos.

## 8. Plan de implementación

Un commit por paso; cada uno pasa el gate de pre-commit (typecheck + vitest). Se trabaja en
la rama `feat/note-canvas` y se pushea a `dev`. A `main` solo cuando lo pidas.

1. **Datos**: schema y migración (`note_format`, `CanvasNode`, `CanvasEdge`, los dos CHECK),
   guard de migraciones, validaciones Zod, tests. No destructivo.
2. **API**: rutas del lienzo, reglas de conversión en POST/PATCH de issues (lógica pura en
   `lib/notes.ts`, con tests), menciones en nodos. Se verifica por HTTP con un token de
   prueba, como se hizo con el canvas actual.
3. **Editor compartido**: extraer `RichTextEditor`. Sin cambio de comportamiento.
4. **Lienzo**: ruta `/issues/[id]`, nodos, edición inline, aristas, resize, color, borrar
   con undo, viewport, autoguardado y sheet en mobile.
5. **Integración y limpieza**: lista (ícono, menú New, conversión, navegación), deep links y
   selector Type. Se quitan la vista canvas global, sus rutas y sus componentes.
6. **Docs**: `API.md` y `PROJECT.md`.
7. ⚠️ **Aparte y con OK explícito**: migración que dropea `IssueLink`, `CanvasLabel` y
   `canvas_x/canvas_y`.

## 9. Fuera de alcance en v1

Etiquetas en las aristas · grupos o marcos · chips de texto en el lienzo · canvas → texto
(aplanar) · buscar dentro de los nodos · undo/redo general del lienzo · colaboración en
tiempo real · exportar el lienzo como imagen.

## 10. Implementación: qué cambió respecto del diseño

- **Orden de commits.** El canvas global se retiró *primero* (sus piezas reutilizables
  renombradas: `lib/canvas-geometry.ts`, `lib/canvas-palette.ts`,
  `components/note-canvas/floating-edge.tsx`) y el lienzo nuevo se construyó encima. El
  resultado es el mismo; la rama no se mergea por partes.
- **Sin `onlyRenderVisibleElements`.** Desmontar un nodo al salir de la vista y volver a
  montarlo recargaría el contenido con el que se cargó, no el último tipeado. Con editores
  read-only, decenas de ideas no pesan. Si un lienzo llega a cientos, la salida es renderizar
  como HTML estático las tarjetas que no están en edición.
- **Escape.** ProseMirror marca *todo* Escape como manejado, así que "salir, salvo que el
  editor lo haya usado" no se puede decidir después del hecho. `RichTextEditor` tiene un
  `onEscape` que corre antes que los plugins y solo dispara si no hay una lista @/# abierta.
- **Ideas vacías.** Una tarjeta creada y abandonada sin escribir se borra sola, sin undo.
  Borrar una idea sin palabras **no se audita** (sería ruido); borrar una con texto sí, con
  contenido y conexiones en `before`.
- **Soltar un conector sobre el cuerpo de otra tarjeta la conecta**, no solo sobre su punto.
- **Escrituras sobre una tarjeta todavía en creación** (texto, color, posición, conexión,
  borrado) esperan su POST en lugar de dar 404.
- **Guardado al salir**: además del desmontaje, `pagehide` y `visibilitychange` (pestaña
  oculta) disparan el flush con `keepalive`.
- **Arreglado de paso**: el deep link `?issue=` de una nota escribía `localStorage` durante el
  render — en el servidor tiraba y sacaba la página entera del SSR.

### Hallazgos preexistentes, ya corregidos

- **Mismatch de hidratación en `/issues`** con la vista lista guardada: el servidor dibujaba
  el board (no tiene `localStorage`) y el cliente la lista. La vista ahora vive en una cookie
  que la página lee en el servidor.
- **`GET /api/issues/{id}` estaba documentado pero no existía.** Ahora existe, con la misma
  forma que la lista.

### Verificación

- 197 tests de vitest (reglas de conversión, schemas, menciones, geometría, guard de
  migraciones con los dos CHECK nuevos).
- Migración aplicada sobre un Postgres descartable y sondeada con SQL: tarea canvas, arista
  entre lienzos, auto-enlace y duplicado rechazados; cascadas correctas.
- 44 chequeos HTTP contra la API con un token de prueba.
- Recorridos en Chromium headless (sesión local, base descartable): editor de notas,
  lienzo completo, flujo mobile a 390px e integración con la página de Issues.
