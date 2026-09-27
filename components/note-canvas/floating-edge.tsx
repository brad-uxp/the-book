"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";
import { X } from "lucide-react";
import { edgeAnchor, type Rect, type Side } from "@/lib/canvas-geometry";

/** Carried on the edge so a selected connection can remove itself. */
export type FloatingEdgeData = { onDelete?: (id: string) => void };

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

/**
 * A connection between two cards, anchored by geometry rather than to a fixed
 * handle. Drag either card anywhere and the line still leaves from the side
 * facing the other one.
 */
export const FloatingEdge = memo(function FloatingEdge({
  id,
  source,
  target,
  markerEnd,
  style,
  data,
  selected,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const onDelete = (data as FloatingEdgeData | undefined)?.onDelete;

  if (!sourceNode || !targetNode) return null;

  const from = rectOf(sourceNode);
  const to = rectOf(targetNode);
  const start = edgeAnchor(from, to);
  const end = edgeAnchor(to, from);

  const [path, labelX, labelY] = getBezierPath({
    sourceX: start.x,
    sourceY: start.y,
    sourcePosition: SIDE_TO_POSITION[start.side],
    targetX: end.x,
    targetY: end.y,
    targetPosition: SIDE_TO_POSITION[end.side],
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          strokeWidth: selected ? 2.5 : 1.5,
          stroke: selected ? "var(--primary)" : "var(--muted-foreground)",
          opacity: selected ? 1 : 0.55,
          ...style,
        }}
      />
      {/*
        The × appears on the selected edge: Delete works, but a connection you
        can only remove from the keyboard is a connection most people cannot
        remove.
      */}
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Remove connection"
            onClick={() => onDelete?.(id)}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="nodrag nopan pointer-events-auto absolute flex h-5 w-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
