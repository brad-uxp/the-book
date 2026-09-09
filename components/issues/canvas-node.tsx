"use client";

import { createContext, memo, useContext } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Calendar, ClipboardList, StickyNote, X } from "lucide-react";
import { formatDateShort } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  edgeAnchor,
  type Rect,
  type Side,
} from "@/lib/issue-canvas";
import { COLUMNS, type Issue } from "./inline-editors";

/**
 * Current time, shared by every card.
 *
 * useNow subscribes with its own interval, so calling it inside each card
 * would open one timer per card on screen. Reading it once at the canvas and
 * handing it down here keeps the node `data` objects stable — if the clock
 * lived in `data`, every card would be rebuilt once a minute.
 */
export const CanvasNowContext = createContext(0);

/** A `type`, not an `interface`: React Flow requires an index-signature fit. */
export type IssueNodeData = { issue: Issue };
export type IssueNode = Node<IssueNodeData, "issue">;

/** Carried on the edge so a selected connection can remove itself. */
export type FloatingEdgeData = { onDelete?: (id: string) => void };

const DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000;

const NOTE_COLOR = "#a78bfa";

const CONNECT_HANDLES = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

function statusColor(issue: Issue): string {
  if (issue.category === "note") return NOTE_COLOR;
  return COLUMNS.find((c) => c.id === issue.status)?.color ?? "#94a3b8";
}

// ── The card ─────────────────────────────────────────────────────────────────

/**
 * One issue on the canvas.
 *
 * Deliberately not an editor: the board's inline popovers fight with drag and
 * pan, and every gesture here is either "move this" or "open this". Editing
 * happens in the same detail sheet the board and the list open.
 */
export const CanvasIssueNode = memo(function CanvasIssueNode({
  data,
  selected,
}: NodeProps<IssueNode>) {
  const { issue } = data;
  const now = useContext(CanvasNowContext);

  const isNote = issue.category === "note";
  const color = statusColor(issue);
  const Icon = isNote ? StickyNote : ClipboardList;

  // Notes hide status and due date — same rule the convert dialog states.
  const dueAt = !isNote && issue.due_date ? new Date(issue.due_date).getTime() : null;
  const overdue = dueAt !== null && now > 0 && dueAt < now;
  const dueSoon =
    dueAt !== null && now > 0 && dueAt >= now && dueAt - now < DUE_SOON_MS;

  return (
    <div
      // Width is fixed so the canvas reads as a grid; height follows the
      // content and tops out at CARD_HEIGHT, because the title is clamped.
      style={{ width: CARD_WIDTH }}
      className={cn(
        "group/card relative rounded-lg border bg-card shadow-sm transition-shadow",
        selected
          ? "border-primary/40 ring-2 ring-primary/30"
          : "hover:border-primary/20 hover:shadow-md"
      )}
    >
      {/* Status stripe — the one place colour carries meaning on the card. */}
      <span
        className="absolute inset-y-0 left-0 w-1 overflow-hidden rounded-l-lg"
        style={{ backgroundColor: color }}
      />

      <div className="flex flex-col gap-1 py-1.5 pl-3.5 pr-2.5">
        <div className="flex items-start gap-1.5">
          <Icon className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {/* Two lines, then an ellipsis. A card is a label, not the issue. */}
          <p className="line-clamp-2 text-sm leading-tight font-medium wrap-break-word">
            {issue.title}
          </p>
        </div>

        <div className="flex items-center gap-2 overflow-hidden text-xs">
          {issue.client ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: issue.client.color_hex }}
              />
              <span className="truncate text-muted-foreground">
                {issue.client.name}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground/40">No client</span>
          )}

          {dueAt !== null && (
            <span
              className={cn(
                "ml-auto flex shrink-0 items-center gap-1",
                overdue
                  ? "text-destructive"
                  : dueSoon
                    ? "text-orange-500"
                    : "text-muted-foreground"
              )}
            >
              <Calendar className="h-3 w-3" />
              {formatDateShort(issue.due_date!)}
            </span>
          )}
        </div>
      </div>

      {/* Progress, as the card's own bottom edge. */}
      {!isNote && issue.progress > 0 && (
        <span
          className="absolute bottom-0 left-0 h-0.5 rounded-bl-lg transition-[width]"
          style={{
            width: `${Math.min(100, issue.progress)}%`,
            backgroundColor: color,
          }}
        />
      )}

      {/*
        Where a connection is dragged from. All four are `source`: React Flow
        resolves an edge's source from `handleBounds.source` even in loose
        mode, so a node with only target handles would render no edge at all.
        Loose mode is what lets one of these also be dropped on.

        Hidden until the card is hovered — four dots on every card at rest
        would turn the canvas into a pegboard.
      */}
      {CONNECT_HANDLES.map(({ id, position }) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={position}
          className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-muted-foreground !opacity-0 transition-all hover:!bg-primary group-hover/card:!opacity-100"
        />
      ))}
    </div>
  );
});

// ── The edge ─────────────────────────────────────────────────────────────────

const SIDE_TO_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

function rectOf(node: {
  internals: { positionAbsolute: { x: number; y: number } };
  measured: { width?: number; height?: number };
}): Rect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    // measured is empty until the node has been through a layout pass; the
    // constants are what the card is actually sized to, so the first paint
    // lands in the right place instead of at a 0×0 corner.
    width: node.measured.width ?? CARD_WIDTH,
    height: node.measured.height ?? CARD_HEIGHT,
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
  label,
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
        A custom edge draws only the path it is given, so a label set through
        the API would otherwise be stored and never shown.

        The × appears on the selected edge: Delete works, but a connection you
        can only remove from the keyboard is a connection most people cannot
        remove.
      */}
      {(label || selected) && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="absolute flex items-center gap-1"
          >
            {label && (
              <span className="pointer-events-none rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm">
                {label}
              </span>
            )}
            {selected && (
              <button
                type="button"
                aria-label="Remove connection"
                onClick={() => onDelete?.(id)}
                className="nodrag nopan pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
