"use client";

import { createContext, memo, useContext, useEffect, useRef } from "react";
import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Ban, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/rich-text/rich-text-editor";
import {
  CANVAS_COLORS,
  CANVAS_COLOR_KEYS,
  canvasColor,
} from "@/lib/canvas-palette";
import {
  NODE_MAX_SIZE,
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
} from "@/lib/note-canvas";

/** A `type`, not an `interface`: React Flow requires an index-signature fit. */
export type IdeaNodeData = {
  /** What the card was loaded or last re-synced with — not every keystroke. */
  content: string;
  color: string | null;
  /**
   * Bumped when the content is replaced from outside the card's own editor
   * (the mobile sheet), which is what tells the editor to reload it.
   */
  rev: number;
};
export type IdeaNode = Node<IdeaNodeData, "idea">;

export interface IdeaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What a card can ask of the canvas. Through context rather than node data:
 * callbacks in `data` would have to be rebuilt into every node, and which
 * card is being edited changes far more often than the nodes do.
 */
export interface IdeaCanvasActions {
  editingId: string | null;
  /** Phone-sized: a card is edited in a sheet, never in place. */
  compact: boolean;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  onContentChange: (id: string, html: string) => void;
  onColorChange: (id: string, color: string | null) => void;
  onResizeEnd: (id: string, box: IdeaBox) => void;
  onDelete: (id: string) => void;
}

export const IdeaCanvasContext = createContext<IdeaCanvasActions | null>(null);

function useIdeaCanvas(): IdeaCanvasActions {
  const ctx = useContext(IdeaCanvasContext);
  if (!ctx) throw new Error("IdeaNodeView must render inside IdeaCanvasContext");
  return ctx;
}

const CONNECT_HANDLES = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

/**
 * One idea on a canvas note: a card of rich text.
 *
 * Read-only until double-clicked (or Enter while selected) — then it is the
 * same editor a text note has, in place, with the cursor where the click was.
 * Read-only is what lets the card be dragged by its text; editing marks the
 * text `nodrag` so selecting words does not move the card.
 */
export const IdeaNodeView = memo(function IdeaNodeView({
  id,
  data,
  selected,
  dragging,
}: NodeProps<IdeaNode>) {
  const ctx = useIdeaCanvas();
  const editing = ctx.editingId === id;
  const editorRef = useRef<RichTextEditorHandle>(null);
  const color = data.color ? canvasColor(data.color) : null;

  // Entering edit mode from the keyboard, or from creating the card: put the
  // cursor at the end. A double-click has already placed it where it landed.
  useEffect(() => {
    if (!editing) return;
    const handle = editorRef.current;
    if (handle && !handle.isFocused()) handle.focusEnd();
  }, [editing]);

  return (
    <>
      <NodeResizer
        isVisible={selected && !ctx.compact}
        minWidth={NODE_MIN_WIDTH}
        minHeight={NODE_MIN_HEIGHT}
        maxWidth={NODE_MAX_SIZE}
        maxHeight={NODE_MAX_SIZE}
        onResizeEnd={(_event, box) => ctx.onResizeEnd(id, box)}
        lineClassName="!border-primary/40"
        handleClassName="!h-2.5 !w-2.5 !rounded-sm !border-primary/60 !bg-background"
      />

      {/*
        Colour and delete. NodeToolbar renders outside the pan/zoom transform,
        so it stays the same size at any zoom.
      */}
      <NodeToolbar
        isVisible={selected && !dragging && !editing}
        position={Position.Top}
        offset={10}
      >
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-md">
          <button
            type="button"
            title="No colour"
            aria-label="No colour"
            onClick={() => ctx.onColorChange(id, null)}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full border-2 bg-card text-muted-foreground transition-transform hover:scale-110",
              data.color === null ? "border-foreground" : "border-border"
            )}
          >
            <Ban className="h-3 w-3" />
          </button>
          {CANVAS_COLOR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              title={CANVAS_COLORS[key].label}
              aria-label={CANVAS_COLORS[key].label}
              onClick={() => ctx.onColorChange(id, key)}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border-2 transition-transform hover:scale-110",
                data.color === key ? "border-foreground" : "border-transparent"
              )}
              style={{ backgroundColor: CANVAS_COLORS[key].hex }}
            >
              {data.color === key && <Check className="h-3 w-3 text-background" />}
            </button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            title="Delete idea"
            aria-label="Delete idea"
            onClick={() => ctx.onDelete(id)}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </NodeToolbar>

      <div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow",
          selected || editing
            ? "ring-2 ring-primary/30"
            : "hover:shadow-md"
        )}
        style={
          color
            ? {
                borderColor: `${color.hex}88`,
                backgroundImage: `linear-gradient(${color.hex}1f, ${color.hex}1f)`,
              }
            : undefined
        }
        onDoubleClick={(e) => {
          if (ctx.compact || editing) return;
          ctx.startEditing(id);
          editorRef.current?.focusAt(e.clientX, e.clientY);
        }}
      >
        {color && (
          <span
            className="absolute inset-x-0 top-0 h-1"
            style={{ backgroundColor: color.hex }}
          />
        )}
        <div
          className={cn(
            "h-full overflow-y-auto px-3.5 pt-3 pb-2",
            // Editing: selecting text must not drag the card. Selected or
            // editing: the wheel scrolls a long idea instead of the canvas.
            editing && "nodrag cursor-text",
            (editing || selected) && "nowheel"
          )}
        >
          <RichTextEditor
            ref={editorRef}
            docKey={`${id}:${data.rev}`}
            value={data.content}
            onChange={(html) => ctx.onContentChange(id, html)}
            // Leaves the card — unless a suggestion list was open, which
            // the editor closes instead.
            onEscape={ctx.stopEditing}
            editable={editing}
            autoFocus={editing}
            overlays="portal"
            placeholder="Write an idea…"
            className="min-h-full text-sm"
          />
        </div>
      </div>

      {/*
        Where a connection is dragged from. All four are `source`: React Flow
        resolves an edge's source from `handleBounds.source` even in loose
        mode, so a node with only target handles would render no edge at all.
        Loose mode is what lets one of these also be dropped on.

        Hidden until the card is hovered — four dots on every card at rest
        would turn the canvas into a pegboard. Siblings of the card, not
        children: the card clips its overflow, and a dot sits half outside.
      */}
      {CONNECT_HANDLES.map(({ id: handleId, position }) => (
        <Handle
          key={handleId}
          id={handleId}
          type="source"
          position={position}
          className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-muted-foreground !opacity-0 transition-all hover:!bg-primary [.react-flow__node:hover_&]:!opacity-100"
        />
      ))}
    </>
  );
});
