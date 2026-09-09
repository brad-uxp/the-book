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
import { Calendar, ClipboardList, StickyNote } from "lucide-react";
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

const DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000;

const NOTE_COLOR = "#a78bfa";

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
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow",
        selected
          ? "border-primary/40 ring-2 ring-primary/30"
          : "hover:border-primary/20 hover:shadow-md"
      )}
    >
      {/* Status stripe — the one place colour carries meaning on the card. */}
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: color }}
      />

      <div className="flex h-full flex-col py-2 pl-3.5 pr-2.5">
        <div className="flex items-start gap-1.5">
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="line-clamp-2 text-sm leading-snug font-medium wrap-break-word">
            {issue.title}
          </p>
        </div>

        <div className="mt-auto flex items-center gap-2 overflow-hidden text-xs">
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
          className="absolute bottom-0 left-0 h-0.5 transition-[width]"
          style={{
            width: `${Math.min(100, issue.progress)}%`,
            backgroundColor: color,
          }}
        />
      )}

      {/*
        Edges float — they compute their own anchors from the two boxes — so
        these exist only because React Flow needs a handle to attach to. They
        become the connection targets in the next step.
      */}
      <Handle
        type="target"
        position={Position.Left}
        className="!pointer-events-none !h-0 !w-0 !min-w-0 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!pointer-events-none !h-0 !w-0 !min-w-0 !border-0 !bg-transparent !opacity-0"
      />
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
  selected,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

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
      */}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="pointer-events-none absolute rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
