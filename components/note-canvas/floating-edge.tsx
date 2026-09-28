"use client";

import { memo, useEffect, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  useInternalNode,
  useReactFlow,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";
import { RotateCcw, X } from "lucide-react";
import {
  connectionAnchors,
  isSide,
  type Rect,
  type Side,
} from "@/lib/canvas-geometry";

/** Which end of a connection. */
export type EdgeEnd = "source" | "target";

/** Carried on the edge so a selected connection can change or remove itself. */
export type FloatingEdgeData = {
  onDelete?: (id: string) => void;
  /** Gives both sides back to the canvas. */
  onResetSides?: (id: string) => void;
  /** An end let go on a card: on one of its dots (`side`), or on its body (null). */
  onMoveEnd?: (id: string, end: EdgeEnd, nodeId: string, side: Side | null) => void;
};

const SIDE_TO_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

function rectOf(node: InternalNode): Rect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    // measured is empty until the node has been through a layout pass. The
    // node's own declared size is what it is about to be rendered at, so the
    // first paint lands in the right place instead of at a 0×0 corner.
    width: node.measured.width ?? node.width ?? 0,
    height: node.measured.height ?? node.height ?? 0,
  };
}

/** Where a dragged end was let go: a dot on a card, a card's body, or nothing. */
function dropTarget(x: number, y: number): { nodeId: string; side: Side | null } | null {
  const under = document.elementFromPoint(x, y);
  const handle = under?.closest(".react-flow__handle");
  if (handle) {
    const nodeId = handle.getAttribute("data-nodeid");
    const side = handle.getAttribute("data-handleid");
    return nodeId ? { nodeId, side: isSide(side) ? side : null } : null;
  }
  const card = under?.closest(".react-flow__node");
  const nodeId = card?.getAttribute("data-id");
  return nodeId ? { nodeId, side: null } : null;
}

/**
 * A connection between two cards. Each end is either pinned to a side of its
 * card — the one the user dragged it from or to — or floats: anchored by
 * geometry to the side facing the other end, so dragging a card never leaves
 * a free end coming out of its wrong side.
 *
 * Selected, it shows a grip at each end: drag one onto another dot to move
 * that end to that side (or card), onto a card's body to let the side float
 * there; let go anywhere else and nothing changes.
 */
export const FloatingEdge = memo(function FloatingEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  markerEnd,
  style,
  data,
  selected,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const { screenToFlowPosition } = useReactFlow();
  const actions = data as FloatingEdgeData | undefined;
  const sourceSide = isSide(sourceHandleId) ? sourceHandleId : null;
  const targetSide = isSide(targetHandleId) ? targetHandleId : null;

  // The end being dragged, and where the pointer is (in flow coordinates).
  const [moving, setMoving] = useState<{ end: EdgeEnd; x: number; y: number } | null>(null);

  const movingEnd = moving?.end ?? null;
  useEffect(() => {
    if (!movingEnd) return;
    const end = movingEnd;
    const onMove = (e: PointerEvent) => {
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false });
      setMoving({ end, x: p.x, y: p.y });
    };
    const onUp = (e: PointerEvent) => {
      setMoving(null);
      const to = dropTarget(e.clientX, e.clientY);
      if (to) actions?.onMoveEnd?.(id, end, to.nodeId, to.side);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoving(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [actions, id, movingEnd, screenToFlowPosition]);

  if (!sourceNode || !targetNode) return null;

  const { start, end } = connectionAnchors(
    rectOf(sourceNode),
    rectOf(targetNode),
    sourceSide,
    targetSide
  );

  const [path, labelX, labelY] = getBezierPath({
    sourceX: start.x,
    sourceY: start.y,
    sourcePosition: SIDE_TO_POSITION[start.side],
    targetX: end.x,
    targetY: end.y,
    targetPosition: SIDE_TO_POSITION[end.side],
  });

  // While an end is dragged, a dashed line from the end that stays to the pointer.
  const preview = moving
    ? getBezierPath({
        sourceX: moving.end === "source" ? end.x : start.x,
        sourceY: moving.end === "source" ? end.y : start.y,
        sourcePosition: SIDE_TO_POSITION[moving.end === "source" ? end.side : start.side],
        targetX: moving.x,
        targetY: moving.y,
        targetPosition: Position.Top,
      })[0]
    : null;

  const pinned = sourceSide !== null || targetSide !== null;

  const grip = (which: EdgeEnd, at: { x: number; y: number }) => (
    <div
      key={which}
      role="button"
      tabIndex={-1}
      aria-label={which === "source" ? "Move the start of this connection" : "Move the end of this connection"}
      title="Drag onto a dot to pin this end to that side"
      data-edge-grip={which}
      onPointerDown={(e) => {
        // Not the pane's selection box, not a pan, not a new connection.
        e.stopPropagation();
        e.preventDefault();
        const p = screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false });
        setMoving({ end: which, x: p.x, y: p.y });
      }}
      style={{
        transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`,
        // Above the cards: an end sits on a card's edge, under its dots.
        zIndex: 2000,
      }}
      className="nodrag nopan pointer-events-auto absolute h-3.5 w-3.5 cursor-move rounded-full border-2 border-background bg-primary shadow-sm ring-2 ring-primary/30"
    />
  );

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          strokeWidth: selected ? 2.5 : 1.5,
          stroke: selected ? "var(--primary)" : "var(--muted-foreground)",
          opacity: moving ? 0.25 : selected ? 1 : 0.55,
          ...style,
        }}
      />
      {preview && (
        <path
          d={preview}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeDasharray="6 4"
          pointerEvents="none"
        />
      )}
      {/*
        On the selected edge: remove it (Delete works too, but a connection
        you can only remove from the keyboard is one most people cannot
        remove), give its sides back to the canvas, and move its ends.
      */}
      {selected && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
          >
            <button
              type="button"
              aria-label="Remove connection"
              title="Remove connection"
              onClick={() => actions?.onDelete?.(id)}
              className="flex h-5 w-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
            {pinned && (
              <button
                type="button"
                aria-label="Let the canvas choose the sides"
                title="Let the canvas choose the sides"
                onClick={() => actions?.onResetSides?.(id)}
                className="flex h-5 w-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>
          {!moving && grip("source", start)}
          {!moving && grip("target", end)}
        </EdgeLabelRenderer>
      )}
    </>
  );
});
