"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type OnConnectEnd,
  type OnNodeDrag,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2, Minimize2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { GRID_SIZE } from "@/lib/canvas-geometry";
import { isBlankHtml } from "@/lib/notes";
import {
  NODE_DEFAULT_HEIGHT,
  NODE_DEFAULT_WIDTH,
  NODE_MAX_SIZE,
  NODE_MIN_HEIGHT,
  DUPLICATE_OFFSET,
  copyIdeas,
  nodeOriginAt,
  repointConnections,
  type CanvasConnection,
  type CanvasIdea,
} from "@/lib/note-canvas";
import { createWheelDeviceTracker, zoomAtPoint } from "@/lib/wheel-device";
import { FloatingEdge } from "./floating-edge";
import {
  IdeaCanvasContext,
  IdeaNodeView,
  type IdeaBox,
  type IdeaCanvasActions,
  type IdeaNode,
} from "./idea-node";

/**
 * Defined once at module scope. React Flow warns loudly and re-mounts every
 * node if these objects change identity between renders.
 */
const nodeTypes = { idea: IdeaNodeView };
const edgeTypes = { floating: FloatingEdge };

/**
 * The stand-in drawn where a card started while it is ⌥-dragged. Only ever
 * in client state: never saved, selected, dragged or deleted.
 */
const GHOST_PREFIX = "ghost:";
const isGhost = (id: string) => id.startsWith(GHOST_PREFIX);

/** Arrow head. A literal colour: a CSS var does not resolve inside <marker>. */
const ARROW = {
  type: MarkerType.ArrowClosed,
  width: 16,
  height: 16,
  color: "#94a3b8",
} as const;

/** How far out and in the canvas zooms, by wheel, pinch or fit. */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;

/** What an idea says is saved this long after the last keystroke. */
const CONTENT_SAVE_MS = 500;

/** How long to gather moves and resizes before writing them as one batch. */
const LAYOUT_FLUSH_MS = 400;

/** Long enough to reach for, short enough not to linger over the canvas. */
const UNDO_MS = 6000;

/**
 * What a gesture changes on a card: where it is and, after a resize, how wide.
 * Never its height — the height is its content's, measured by React Flow.
 */
type LayoutEntry = {
  id: string;
  x: number;
  y: number;
  width?: number;
};

/**
 * The stored `height` is deliberately not applied: a card is as tall as its
 * content (see IdeaNodeView). Setting it here would pin the height and bring
 * back the scrolling cards this replaced.
 */
function toNode(idea: CanvasIdea, selected = false): IdeaNode {
  return {
    id: idea.id,
    type: "idea",
    // On React Flow's own wrapper, so a card's connection dots can show on
    // hover (`group-hover/idea:` in IdeaNodeView).
    className: "group/idea",
    position: { x: idea.x, y: idea.y },
    width: idea.width,
    selected,
    data: { content: idea.content, color: idea.color, rev: 0 },
  };
}

/** Where the user last panned to on THIS canvas. Per-viewer state, not data. */
function viewportKey(issueId: string): string {
  return `note-canvas-viewport:${issueId}`;
}

function readViewport(issueId: string): Viewport | null {
  try {
    const raw = localStorage.getItem(viewportKey(issueId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Viewport>;
    if (
      typeof v.x === "number" &&
      typeof v.y === "number" &&
      typeof v.zoom === "number" &&
      Number.isFinite(v.x) &&
      Number.isFinite(v.y) &&
      v.zoom > 0
    ) {
      return { x: v.x, y: v.y, zoom: v.zoom };
    }
  } catch {
    // Private mode, cleared storage, hand-edited value — fit the view instead.
  }
  return null;
}

interface Props {
  issueId: string;
  initialIdeas: CanvasIdea[];
  initialConnections: CanvasConnection[];
}

/**
 * The canvas of a canvas note: ideas as cards of rich text, wired together.
 *
 * Wrapped so the inner canvas can use useReactFlow — it reads the viewport to
 * place new cards and deletes through the same path the Delete key uses.
 */
export function NoteCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ issueId, initialIdeas, initialConnections }: Props) {
  const compact = useMediaQuery("(max-width: 639px)");
  const [expanded, setExpanded] = useState(false);
  const base = `/api/issues/${issueId}/canvas`;

  const {
    screenToFlowPosition,
    deleteElements,
    getNodes,
    getEdges,
    getViewport,
    setViewport,
  } = useReactFlow<IdeaNode, Edge>();
  const paneRef = useRef<HTMLDivElement>(null);

  // Distinguishes "let go of a card" from "clicked a card": React Flow fires
  // a click at the end of a drag too.
  const draggedAt = useRef(0);

  const [initialViewport] = useState<Viewport | null>(() =>
    readViewport(issueId)
  );

  // The × on a selected connection. Deleting through React Flow keeps one
  // path — key, button or × — into onDelete and its undo.
  const deleteEdge = useCallback(
    (id: string) => void deleteElements({ edges: [{ id }] }),
    [deleteElements]
  );

  const toEdge = useCallback(
    (c: CanvasConnection): Edge => ({
      id: c.id,
      source: c.source_id,
      target: c.target_id,
      type: "floating",
      markerEnd: ARROW,
      data: { onDelete: deleteEdge },
    }),
    [deleteEdge]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<IdeaNode>(
    initialIdeas.map((idea) => toNode(idea))
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialConnections.map(toEdge)
  );

  // ── Waiting on creation ──────────────────────────────────────────────────
  //
  // A card is drawn and typed into before its POST lands. Anything that
  // writes to it — content, colour, position, a connection, a delete — waits
  // for that POST, or it would 404 against a row that does not exist yet.
  const creating = useRef(new Map<string, Promise<void>>());

  const whenCreated = useCallback((ids: string[]) => {
    return Promise.all(ids.map((id) => creating.current.get(id))).then(
      () => undefined
    );
  }, []);

  // ── Content ──────────────────────────────────────────────────────────────
  //
  // The editor keeps its own document; this is only the latest HTML per card,
  // for saving, for undo, and for deciding whether an abandoned card was
  // empty. Held in a ref, not state: a re-render per keystroke would redraw
  // the canvas for nothing.
  const latestContent = useRef(new Map<string, string>());
  const contentTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const saveContent = useCallback(
    (id: string, html: string, keepalive = false) => {
      whenCreated([id])
        .then(() =>
          fetch(`${base}/nodes/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: html }),
            keepalive,
          })
        )
        .then((res) => {
          // Gone (deleted meanwhile) is not a failure worth a toast.
          if (!res.ok && res.status !== 404) {
            throw new Error(`PATCH node ${res.status}`);
          }
        })
        .catch((err) => {
          console.error(err);
          toast.error("Could not save the idea");
        });
    },
    [base, whenCreated]
  );

  const onContentChange = useCallback(
    (id: string, html: string) => {
      latestContent.current.set(id, html);
      const timers = contentTimers.current;
      const pending = timers.get(id);
      if (pending) clearTimeout(pending);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          saveContent(id, html);
        }, CONTENT_SAVE_MS)
      );
    },
    [saveContent]
  );

  const flushContent = useCallback(() => {
    for (const [id, timer] of contentTimers.current) {
      clearTimeout(timer);
      const html = latestContent.current.get(id);
      if (html !== undefined) saveContent(id, html, true);
    }
    contentTimers.current.clear();
  }, [saveContent]);

  const contentOf = useCallback(
    (id: string) =>
      latestContent.current.get(id) ??
      getNodes().find((n) => n.id === id)?.data.content ??
      "",
    [getNodes]
  );

  /** A card as the API knows it, with the words as they are now — not as they were loaded. */
  const ideaOf = useCallback(
    (n: IdeaNode): CanvasIdea => ({
      id: n.id,
      content: contentOf(n.id),
      color: n.data.color,
      x: n.position.x,
      y: n.position.y,
      width: n.width ?? n.measured?.width ?? NODE_DEFAULT_WIDTH,
      // Only stored, never applied (the card sizes to its content) — but it
      // travels in a create, so keep it inside what the API accepts.
      height: Math.min(
        NODE_MAX_SIZE,
        Math.max(NODE_MIN_HEIGHT, Math.round(n.measured?.height ?? NODE_DEFAULT_HEIGHT))
      ),
    }),
    [contentOf]
  );

  // ── Layout ───────────────────────────────────────────────────────────────
  //
  // Keyed by id so repeated moves of the same card collapse into its latest
  // box instead of queueing.
  const pendingLayout = useRef(new Map<string, LayoutEntry>());
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushLayout = useCallback(() => {
    if (layoutTimer.current) {
      clearTimeout(layoutTimer.current);
      layoutTimer.current = null;
    }
    const batch = [...pendingLayout.current.values()];
    if (batch.length === 0) return;
    pendingLayout.current.clear();

    const send = () =>
      fetch(`${base}/layout`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: batch }),
        // The layout has to survive the tab closing right after a drag.
        keepalive: true,
      });

    // Only wait when a card in the batch is still being created — waiting
    // otherwise would push the write past a page unload.
    const waiting = batch.filter((b) => creating.current.has(b.id));
    (waiting.length > 0
      ? whenCreated(waiting.map((b) => b.id)).then(send)
      : send()
    ).catch(console.error);
  }, [base, whenCreated]);

  const queueLayout = useCallback(
    (entries: LayoutEntry[]) => {
      if (entries.length === 0) return;
      for (const entry of entries) {
        const prev = pendingLayout.current.get(entry.id);
        pendingLayout.current.set(entry.id, { ...prev, ...entry });
      }
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
      layoutTimer.current = setTimeout(flushLayout, LAYOUT_FLUSH_MS);
    },
    [flushLayout]
  );

  // Leaving — navigating away, closing the tab, backgrounding the phone —
  // must not lose the last words or the last move.
  useEffect(() => {
    const flushAll = () => {
      flushContent();
      flushLayout();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushAll();
    };
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      document.removeEventListener("visibilitychange", onVisibility);
      flushAll();
    };
  }, [flushContent, flushLayout]);

  // ── Creating ─────────────────────────────────────────────────────────────

  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * The card open in the phone sheet, with the words it opened with — read
   * when it opens, because the latest words live in a ref that render must
   * not touch.
   */
  const [sheet, setSheet] = useState<{ id: string; content: string } | null>(
    null
  );

  // Read by callbacks that must not be rebuilt when these change. Assigned
  // after commit, never during render: a render can be discarded.
  const editingRef = useRef(editingId);
  const compactRef = useRef(compact);
  useEffect(() => {
    editingRef.current = editingId;
    compactRef.current = compact;
  });

  const postIdea = useCallback(
    (idea: CanvasIdea) => {
      const done = fetch(`${base}/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(idea),
      }).then((res) => {
        if (!res.ok) throw new Error(`POST node ${res.status}`);
      });
      // What later writes wait on. It never rejects — a write waiting on a
      // card that failed to be created finds out from its own request — and
      // it removes itself once settled, so a batch flushed on page unload
      // only waits when there is really something to wait for.
      const tracked: Promise<void> = done
        .then(
          () => undefined,
          () => undefined
        )
        .finally(() => {
          if (creating.current.get(idea.id) === tracked) {
            creating.current.delete(idea.id);
          }
        });
      creating.current.set(idea.id, tracked);
      return done;
    },
    [base]
  );

  const postConnection = useCallback(
    (c: CanvasConnection) =>
      whenCreated([c.source_id, c.target_id]).then(() =>
        fetch(`${base}/edges`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        }).then((res) => {
          if (!res.ok) throw new Error(`POST edge ${res.status}`);
        })
      ),
    [base, whenCreated]
  );

  /**
   * Cards removed for being empty. A card pulled out of another's handle is
   * still having its connection written when it is discarded, and that write
   * can lose the race to the DELETE — which is expected here, not a failure
   * to tell anyone about.
   */
  const discarded = useRef(new Set<string>());

  /**
   * Removes a card that was never written in — no toast, no undo. An empty
   * card is a smudge that would otherwise have to be hunted down by hand.
   */
  const discardIdea = useCallback(
    (id: string) => {
      discarded.current.add(id);
      const timer = contentTimers.current.get(id);
      if (timer) clearTimeout(timer);
      contentTimers.current.delete(id);
      latestContent.current.delete(id);
      pendingLayout.current.delete(id);
      setNodes((prev) => prev.filter((n) => n.id !== id));
      setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
      whenCreated([id])
        .then(() => fetch(`${base}/nodes/${id}`, { method: "DELETE" }))
        .catch(console.error);
    },
    [base, setEdges, setNodes, whenCreated]
  );

  const stopEditing = useCallback(() => {
    const id = editingRef.current;
    if (!id) return;
    setEditingId(null);
    if (isBlankHtml(contentOf(id))) discardIdea(id);
  }, [contentOf, discardIdea]);

  const startEditing = useCallback(
    (id: string) => {
      if (editingRef.current && editingRef.current !== id) stopEditing();
      setEditingId(id);
    },
    [stopEditing]
  );

  const connect = useCallback(
    (source: string, target: string) => {
      if (source === target) return;
      if (getEdges().some((e) => e.source === source && e.target === target)) {
        return;
      }
      const connection = {
        id: crypto.randomUUID(),
        source_id: source,
        target_id: target,
      };
      setEdges((prev) => [...prev, toEdge(connection)]);
      postConnection(connection).catch((err) => {
        console.error(err);
        setEdges((prev) => prev.filter((e) => e.id !== connection.id));
        toast.error("Could not connect these ideas");
      });
    },
    [getEdges, postConnection, setEdges, toEdge]
  );

  /**
   * A new card, centred on a point, already open for typing. Optionally
   * connected from the card whose handle was dragged out to make it.
   *
   * Optimistic, with the id chosen here: the card is focused and typed into
   * before the server answers, and nothing about it has to change when it
   * does.
   */
  const createIdea = useCallback(
    (center: { x: number; y: number }, connectFrom?: string) => {
      if (editingRef.current) stopEditing();

      const idea: CanvasIdea = {
        id: crypto.randomUUID(),
        content: "",
        color: null,
        ...nodeOriginAt(center),
        width: NODE_DEFAULT_WIDTH,
        height: NODE_DEFAULT_HEIGHT,
      };
      const connection = connectFrom
        ? { id: crypto.randomUUID(), source_id: connectFrom, target_id: idea.id }
        : null;

      setNodes((prev) => [
        ...prev.map((n) => (n.selected ? { ...n, selected: false } : n)),
        toNode(idea, true),
      ]);
      if (connection) setEdges((prev) => [...prev, toEdge(connection)]);
      if (compactRef.current) setSheet({ id: idea.id, content: "" });
      else setEditingId(idea.id);

      postIdea(idea)
        .then(() => (connection ? postConnection(connection) : undefined))
        .catch((err) => {
          if (discarded.current.has(idea.id)) return;
          console.error(err);
          setNodes((prev) => prev.filter((n) => n.id !== idea.id));
          setEdges((prev) =>
            prev.filter((e) => e.source !== idea.id && e.target !== idea.id)
          );
          setEditingId((cur) => (cur === idea.id ? null : cur));
          setSheet((cur) => (cur?.id === idea.id ? null : cur));
          toast.error("Could not create the idea");
        });
    },
    [postConnection, postIdea, setEdges, setNodes, stopEditing, toEdge]
  );

  const createIdeaInView = useCallback(() => {
    const box = paneRef.current?.getBoundingClientRect();
    const center = box
      ? screenToFlowPosition({
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
        })
      : { x: 0, y: 0 };
    createIdea(center);
  }, [createIdea, screenToFlowPosition]);

  // ── Deleting, with undo ──────────────────────────────────────────────────

  const restore = useCallback(
    (
      ideas: CanvasIdea[],
      connections: CanvasConnection[],
      deleted: Promise<unknown>
    ) => {
      for (const idea of ideas) latestContent.current.set(idea.id, idea.content);
      setNodes((prev) => [...prev, ...ideas.map((idea) => toNode(idea))]);
      setEdges((prev) => [...prev, ...connections.map(toEdge)]);

      // Same ids as before: undo is the rows coming back, not copies of them.
      // After the delete has landed — a quick Undo would otherwise race it,
      // re-create the row, and then watch the DELETE remove it again.
      deleted
        .then(() => Promise.all(ideas.map(postIdea)))
        .then(() => Promise.all(connections.map(postConnection)))
        .catch((err) => {
          console.error(err);
          toast.error("Could not restore everything — reload to see what is saved");
        });
    },
    [postConnection, postIdea, setEdges, setNodes, toEdge]
  );

  const handleDelete = useCallback(
    ({ nodes: goneNodes, edges: goneEdges }: { nodes: IdeaNode[]; edges: Edge[] }) => {
      if (goneNodes.length === 0 && goneEdges.length === 0) return;

      const goneIds = new Set(goneNodes.map((n) => n.id));

      // Captured before anything else, with the words as they are now, so
      // undo brings back what was on screen.
      const ideas: CanvasIdea[] = goneNodes.map(ideaOf);
      const connections: CanvasConnection[] = goneEdges.map((e) => ({
        id: e.id,
        source_id: e.source,
        target_id: e.target,
      }));

      for (const id of goneIds) {
        const timer = contentTimers.current.get(id);
        if (timer) clearTimeout(timer);
        contentTimers.current.delete(id);
        pendingLayout.current.delete(id);
      }
      if (editingRef.current && goneIds.has(editingRef.current)) {
        setEditingId(null);
      }

      // A deleted card takes its connections with it on the server; only the
      // connections deleted on their own need a request.
      const loose = connections.filter(
        (c) => !goneIds.has(c.source_id) && !goneIds.has(c.target_id)
      );
      const requests = [
        ...ideas.map((i) =>
          whenCreated([i.id]).then(() =>
            fetch(`${base}/nodes/${i.id}`, { method: "DELETE" })
          )
        ),
        ...loose.map((c) =>
          whenCreated([c.source_id, c.target_id]).then(() =>
            fetch(`${base}/edges/${c.id}`, { method: "DELETE" })
          )
        ),
      ].map((p) =>
        p.then((res) => {
          // Already gone is the outcome we wanted.
          if (!res.ok && res.status !== 404) {
            throw new Error(`DELETE ${res.status}`);
          }
        })
      );

      const settled = Promise.allSettled(requests);
      settled.then((results) => {
        if (results.every((r) => r.status === "fulfilled")) return;
        console.error("[note-canvas] delete failed", results);
        toast.error("Could not delete — reload to see what is saved");
      });

      const wordy = ideas.filter((i) => !isBlankHtml(i.content)).length;
      const label =
        ideas.length === 0
          ? connections.length === 1
            ? "Connection removed"
            : `${connections.length} connections removed`
          : ideas.length === 1
            ? "Idea deleted"
            : `${ideas.length} ideas deleted`;

      // Nothing worth an undo: empty cards with no connections.
      if (wordy === 0 && connections.length === 0) return;

      toast(label, {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => restore(ideas, connections, settled),
        },
      });
    },
    [base, ideaOf, restore, whenCreated]
  );

  const deleteIdea = useCallback(
    (id: string) => void deleteElements({ nodes: [{ id }] }),
    [deleteElements]
  );

  // ── Duplicating ─────────────────────────────────────────────────────────
  //
  // A copy has the card's words, colour and width, a new id, and none of its
  // connections: those stay with the original, which stays where it is.

  const persistCopies = useCallback(
    (copies: CanvasIdea[]) => {
      for (const copy of copies) {
        postIdea(copy).catch((err) => {
          console.error(err);
          setNodes((prev) => prev.filter((n) => n.id !== copy.id));
          toast.error("Could not duplicate the idea");
        });
      }
    },
    [postIdea, setNodes]
  );

  /** ⌘D: copies of the selected cards, a step down and to the right, selected instead of them. */
  const duplicateSelection = useCallback(() => {
    const selected = getNodes().filter((n) => n.selected && !isGhost(n.id));
    if (selected.length === 0) return;
    const copies = copyIdeas(
      selected.map(ideaOf),
      (i) => ({ x: i.x + DUPLICATE_OFFSET, y: i.y + DUPLICATE_OFFSET }),
      () => crypto.randomUUID()
    );
    setNodes((prev) => [
      ...prev.map((n) => (n.selected ? { ...n, selected: false } : n)),
      ...copies.map((c) => toNode(c, true)),
    ]);
    persistCopies(copies);
  }, [getNodes, ideaOf, persistCopies, setNodes]);

  /**
   * ⌥ + drag: the cards under the pointer become the copies, and the
   * originals stay put. React Flow drags the cards it grabbed — the
   * originals — so while it does, a stand-in of each is drawn where it
   * started, holding its connections; on drop the originals go back in
   * place of their stand-ins and copies are created where they were dropped.
   */
  const altDrag = useRef<{
    origins: Map<string, { x: number; y: number }>;
    ghosts: Map<string, string>;
  } | null>(null);

  const handleDragStart = useCallback<OnNodeDrag<IdeaNode>>(
    (event, _node, dragged) => {
      if (!event.altKey || compactRef.current) return;
      const originals = dragged.filter((n) => !isGhost(n.id));
      if (originals.length === 0) return;
      const ghosts = new Map(originals.map((n) => [n.id, `${GHOST_PREFIX}${n.id}`]));
      altDrag.current = {
        origins: new Map(originals.map((n) => [n.id, { ...n.position }])),
        ghosts,
      };
      setNodes((prev) => [
        // First, so the dragged cards stay on top of them. `measured`, so
        // they are drawn at once instead of waiting to be measured.
        ...originals.map(
          (n): IdeaNode => ({
            ...toNode(ideaOf(n)),
            id: ghosts.get(n.id)!,
            measured: n.measured,
            selectable: false,
            draggable: false,
            connectable: false,
            deletable: false,
            focusable: false,
          })
        ),
        ...prev,
      ]);
      setEdges((prev) => repointConnections(prev, ghosts));
    },
    [ideaOf, setEdges, setNodes]
  );

  /**
   * The end of a ⌥ + drag, in two steps so nothing blinks: first the copies
   * are added under the cards still sitting where they were dropped (a new
   * card paints its words a frame after it mounts); once they have, the
   * originals go back over their stand-ins and the copies take the selection.
   */
  const finishAltDrag = useCallback(
    (dragged: IdeaNode[]) => {
      const alt = altDrag.current;
      if (!alt) return;
      altDrag.current = null;
      const originals = dragged.filter((n) => alt.origins.has(n.id));
      const copies = copyIdeas(originals.map(ideaOf), (i) => i, () => crypto.randomUUID());
      const measured = new Map(originals.map((n, i) => [copies[i].id, n.measured]));
      setNodes((prev) => [
        ...copies.map((c): IdeaNode => ({ ...toNode(c), measured: measured.get(c.id) })),
        ...prev,
      ]);
      persistCopies(copies);

      const back = new Map([...alt.ghosts].map(([id, ghost]) => [ghost, id]));
      const copyIds = new Set(copies.map((c) => c.id));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setNodes((prev) =>
            prev
              .filter((n) => !back.has(n.id))
              .map((n) => {
                const origin = alt.origins.get(n.id);
                if (origin) return { ...n, position: origin, selected: false };
                if (copyIds.has(n.id)) return { ...n, selected: true };
                return n.selected ? { ...n, selected: false } : n;
              })
          );
          setEdges((prev) => repointConnections(prev, back));
        })
      );
    },
    [ideaOf, persistCopies, setEdges, setNodes]
  );

  // ── Colour and size ──────────────────────────────────────────────────────

  const onColorChange = useCallback(
    (id: string, color: string | null) => {
      const before = getNodes().find((n) => n.id === id)?.data.color ?? null;
      if (before === color) return;
      const paint = (c: string | null) =>
        setNodes((prev) =>
          prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, color: c } } : n))
        );
      paint(color);

      whenCreated([id])
        .then(() =>
          fetch(`${base}/nodes/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ color }),
          })
        )
        .then((res) => {
          if (!res.ok) throw new Error(`PATCH colour ${res.status}`);
        })
        .catch((err) => {
          console.error(err);
          paint(before);
          toast.error("Could not change the colour");
        });
    },
    [base, getNodes, setNodes, whenCreated]
  );

  const onResizeEnd = useCallback(
    (id: string, box: IdeaBox) => {
      // Resizing from the left edge moves x as well as the width.
      queueLayout([{ id, x: box.x, y: box.y, width: box.width }]);
    },
    [queueLayout]
  );

  const actions = useMemo<IdeaCanvasActions>(
    () => ({
      editingId,
      compact,
      startEditing,
      stopEditing,
      onContentChange,
      onColorChange,
      onResizeEnd,
      onDelete: deleteIdea,
    }),
    [
      editingId,
      compact,
      startEditing,
      stopEditing,
      onContentChange,
      onColorChange,
      onResizeEnd,
      deleteIdea,
    ]
  );

  // ── React Flow handlers ──────────────────────────────────────────────────

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const source = "source" in c ? c.source : null;
      const target = "target" in c ? c.target : null;
      if (!source || !target || source === target) return false;
      // Both are also enforced by the database: a CHECK and a unique index.
      return !getEdges().some((e) => e.source === source && e.target === target);
    },
    [getEdges]
  );

  const handleConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) connect(c.source, c.target);
    },
    [connect]
  );

  /**
   * A connection dragged out of a card and let go somewhere other than a
   * handle. On another card's body: connect to it — aiming at a 14px dot is
   * not what anyone is trying to do. On empty canvas: a new idea there,
   * already connected, which is how a train of thought gets drawn.
   */
  const handleConnectEnd = useCallback<OnConnectEnd>(
    (event, state) => {
      if (state.isValid) return; // onConnect has it.
      const from = state.fromNode?.id;
      if (!from) return;

      const point =
        "changedTouches" in event ? event.changedTouches[0] : (event as MouseEvent);
      if (!point) return;
      const under = document.elementFromPoint(point.clientX, point.clientY);
      if (!under || !paneRef.current?.contains(under)) return;

      const card = under.closest(".react-flow__node");
      if (card) {
        const to = card.getAttribute("data-id");
        if (to) connect(from, to);
        return;
      }
      if (!under.closest(".react-flow__pane")) return;
      createIdea(
        screenToFlowPosition({ x: point.clientX, y: point.clientY }),
        from
      );
    },
    [connect, createIdea, screenToFlowPosition]
  );

  const handleDragStop = useCallback<OnNodeDrag<IdeaNode>>(
    (_event, _node, dragged) => {
      draggedAt.current = Date.now();
      // A ⌥ + drag moved copies, not the originals: nothing of theirs to save.
      if (altDrag.current) {
        finishAltDrag(dragged);
        return;
      }
      // One gesture, one write, however many cards it moved.
      queueLayout(
        dragged.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))
      );
    },
    [finishAltDrag, queueLayout]
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: IdeaNode) => {
      if (Date.now() - draggedAt.current < 150) return;
      // On a phone a card is edited in a sheet: tapping it opens it.
      if (compactRef.current) {
        setSheet({ id: node.id, content: contentOf(node.id) });
        return;
      }
      if (editingRef.current && editingRef.current !== node.id) stopEditing();
    },
    [contentOf, stopEditing]
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains("react-flow__pane")) return;
      createIdea(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [createIdea, screenToFlowPosition]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (editingRef.current || compactRef.current) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || target.closest("input, textarea")) return;

      // ⌘D (Ctrl+D off a Mac) duplicates the selection. Prevented, or the
      // browser would bookmark the page.
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        duplicateSelection();
        return;
      }

      // Enter on a selected card opens it for typing, like a double-click.
      if (event.key !== "Enter") return;
      const selected = getNodes().filter((n) => n.selected);
      if (selected.length !== 1) return;
      event.preventDefault();
      startEditing(selected[0].id);
    },
    [duplicateSelection, getNodes, startEditing]
  );

  // ⌥ over a card shows the copy cursor: what a ⌥ + drag will do. On the
  // wrapper, not in state — a key held down must not re-render the canvas.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const set = (on: boolean) => {
      if (on) pane.dataset.duplicating = "";
      else delete pane.dataset.duplicating;
    };
    const onKey = (e: KeyboardEvent) => set(e.altKey);
    const off = () => set(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", off);
    };
  }, []);

  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      try {
        localStorage.setItem(viewportKey(issueId), JSON.stringify(viewport));
      } catch {
        // Not being able to remember the viewport is not worth an error.
      }
    },
    [issueId]
  );

  // Escape leaves the expanded canvas — but not while a card is being edited
  // (Escape belongs to it) or a dialog is open (it belongs there).
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (editingRef.current) return;
      if (document.querySelector("[role='dialog'][data-state='open']")) return;
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // ── Wheel: the mouse zooms, two fingers pan ─────────────────────────────
  //
  // React Flow is set to pan on scroll, which is what two fingers on a
  // trackpad want — and its pinch zoom comes with it. A mouse wheel is told
  // apart (lib/wheel-device.ts) and caught before React Flow sees it, to zoom
  // around the cursor instead.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const track = createWheelDeviceTracker();
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // a pinch: React Flow zooms
      if (track(e, e.timeStamp) !== "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      const point = screenToFlowPosition(
        { x: e.clientX, y: e.clientY },
        { snapToGrid: false }
      );
      void setViewport(
        zoomAtPoint(getViewport(), point, e, { min: MIN_ZOOM, max: MAX_ZOOM })
      );
    };
    // Capture, so it runs before React Flow's own listener further down.
    pane.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => pane.removeEventListener("wheel", onWheel, { capture: true });
  }, [screenToFlowPosition, getViewport, setViewport]);

  // ── Mobile sheet ─────────────────────────────────────────────────────────

  const closeSheet = useCallback(() => {
    const id = sheet?.id;
    setSheet(null);
    if (!id) return;
    const html = contentOf(id);
    if (isBlankHtml(html)) {
      discardIdea(id);
      return;
    }
    // The card's own editor is still showing what it loaded; this is what
    // makes it reload the words written in the sheet.
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, content: html, rev: n.data.rev + 1 } }
          : n
      )
    );
  }, [contentOf, discardIdea, setNodes, sheet]);

  // Closed if its card was deleted meanwhile.
  const sheetOpen = !!sheet && nodes.some((n) => n.id === sheet.id);

  return (
    <div
      ref={paneRef}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      // The right button pans, so the browser's menu must not pop up at the
      // end of the drag. Inside a card being edited it stays: that is where
      // spell-check suggestions and paste live.
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return;
        e.preventDefault();
      }}
      className={cn(
        // `note-canvas` scopes this canvas's cursor rules (app/globals.css).
        "note-canvas relative w-full overflow-hidden border bg-background",
        expanded
          ? // Above the sidebar (also z-50, but earlier in the DOM) and below
            // dialogs, whose portals are appended last to <body>.
            "fixed inset-0 z-50 rounded-none"
          : "h-[calc(100dvh-8.5rem)] min-h-96 rounded-xl lg:h-[calc(100dvh-6rem)]"
      )}
    >
      <IdeaCanvasContext.Provider value={actions}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          // The app has one theme, light (there is no ThemeProvider). Left
          // to "system", React Flow went dark on a Mac in dark mode and the
          // cards' text, which follows the app, became unreadable.
          colorMode="light"
          onNodeDragStart={handleDragStart}
          onNodeDragStop={handleDragStop}
          onNodeClick={handleNodeClick}
          onPaneClick={stopEditing}
          onMoveEnd={handleMoveEnd}
          defaultViewport={initialViewport ?? undefined}
          fitView={initialViewport === null}
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          snapToGrid
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          zoomOnDoubleClick={false}
          onConnect={handleConnect}
          onConnectEnd={handleConnectEnd}
          isValidConnection={isValidConnection}
          onDelete={handleDelete}
          // Loose: a connection can be dropped on any handle, not only on one
          // declared as a target. All four dots on a card are sources.
          connectionMode={ConnectionMode.Loose}
          // Generous, so dropping near a card counts as dropping on it.
          connectionRadius={40}
          connectionLineStyle={{ strokeWidth: 2, stroke: "#94a3b8" }}
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
          // As a whiteboard: the mouse wheel zooms around the cursor (see
          // the wheel effect above), two fingers on a trackpad pan and a
          // pinch zooms, the right (or middle) button drags the canvas, and
          // the left button on empty canvas draws a selection box.
          panOnScroll
          // One to one, like scrolling a page: the content follows the
          // fingers. (React Flow's default moves it half as far.)
          panOnScrollSpeed={1}
          panOnDrag={[1, 2]}
          selectionOnDrag
          // Partial: the box only has to touch a card to take it. Requiring
          // the whole card inside is fussy with tall cards.
          selectionMode={SelectionMode.Partial}
          // The box needs no key held down; Shift (or Cmd/Ctrl) is for
          // adding and removing cards from a selection by clicking them.
          selectionKeyCode={null}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={GRID_SIZE * 3}
            size={1}
          />
        </ReactFlow>
      </IdeaCanvasContext.Provider>

      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <Button
          size="icon"
          className="h-8 w-8 shadow-sm"
          title="New idea"
          aria-label="New idea"
          onClick={createIdeaInView}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="hidden h-8 w-8 bg-card shadow-sm sm:inline-flex"
          title={expanded ? "Collapse canvas" : "Expand canvas"}
          aria-label={expanded ? "Collapse canvas" : "Expand canvas"}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="text-sm text-muted-foreground/70">
            {compact
              ? "Tap + to add your first idea."
              : "Double-click anywhere to add your first idea."}
          </p>
        </div>
      )}

      {/* Phone-sized: a card is written in a sheet, not in place — typing on
          a zoomed card under an on-screen keyboard does not work. */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
      >
        <SheetContent
          side="bottom"
          className="h-[85dvh] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Idea</SheetTitle>
          </SheetHeader>
          {/* Padding on an inner box, not on the scroller: a sticky toolbar
              sticks below its scroller's padding, and would cover the first
              line. Same structure as the detail sheet. */}
          {sheet && (
            <div className="h-full overflow-y-auto">
              <div className="px-5 py-6">
                <RichTextEditor
                  docKey={sheet.id}
                  value={sheet.content}
                  onChange={(html) => onContentChange(sheet.id, html)}
                  toolbar
                  autoFocus={isBlankHtml(sheet.content)}
                  placeholder="Write an idea…"
                  className="min-h-[200px] text-sm"
                />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
