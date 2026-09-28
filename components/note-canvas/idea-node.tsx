"use client";

import { createContext, memo, useContext, useEffect, useRef } from "react";
import {
  Handle,
  NodeResizeControl,
  NodeToolbar,
  Position,
  ResizeControlVariant,
  useStore,
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
import { NODE_MAX_SIZE, NODE_MIN_WIDTH } from "@/lib/note-canvas";

/** The two sides a card is widened from. Its height is never set by hand. */
const WIDTH_SIDES = [Position.Left, Position.Right] as const;

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

/** Where a card sits and how wide it is — its height follows its content. */
export interface IdeaBox {
  x: number;
  y: number;
  width: number;
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
 *
 * The width is the user's; the height is the content's. A card never
 * scrolls: widen it and it gets shorter, narrow it and it grows, always with
 * the same padding under the last line. React Flow measures the height, so
 * edges and the toolbar follow the card as it grows while typing.
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

  // React Flow keeps a node `visibility: hidden` until it has measured it,
  // and a card with no fixed height must be measured before it can be shown.
  // Nothing hidden can take focus — so a brand-new card, open for typing,
  // focuses once it is measured, not before (it used to race and lose).
  // A boolean selector: this re-renders the card when it becomes measured,
  // not every time its height changes while typing.
  const measured = useStore(
    (s) => s.nodeLookup.get(id)?.measured?.height !== undefined
  );

  // Entering edit mode from the keyboard, or from creating the card: put the
  // cursor at the end. A double-click has already placed it where it landed.
  useEffect(() => {
    if (!editing || !measured) return;
    const handle = editorRef.current;
    if (handle && !handle.isFocused()) handle.focusEnd();
  }, [editing, measured]);

  return (
    <>
      {/*
        Width only, from either side: the whole edge is a grab area, with a
        visible grip at its bottom end — not in the middle, where the
        connection dot of that side sits and a drag would start a connection
        instead. Short and low enough to clear that dot on a one-line card,
        and high enough to stay off the rounded corner. `resizeDirection="horizontal"` is what keeps React Flow from
        writing a fixed height onto the node — with it, a resize sets the
        width attribute alone and the height stays measured.
      */}
      {selected &&
        !ctx.compact &&
        WIDTH_SIDES.map((side) => (
          <NodeResizeControl
            key={side}
            position={side}
            variant={ResizeControlVariant.Line}
            resizeDirection="horizontal"
            minWidth={NODE_MIN_WIDTH}
            maxWidth={NODE_MAX_SIZE}
            onResizeEnd={(_event, box) =>
              ctx.onResizeEnd(id, { x: box.x, y: box.y, width: box.width })
            }
            className="!border-transparent !border-[5px]"
          >
            <span className="pointer-events-none absolute bottom-[3px] left-1/2 h-2 w-1.5 -translate-x-1/2 rounded-full bg-primary/60" />
          </NodeResizeControl>
        ))}

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
          "relative w-full overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow",
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
            // No scroll area: the card is as tall as this box. The last
            // block's own bottom margin is dropped so the padding under the
            // last line is always exactly pb-3.
            // `!`: the editor's own `.tiptap p` margin is unlayered CSS, and
            // unlayered rules beat Tailwind's layered utilities.
            "px-3.5 pt-3 pb-3 [&_.tiptap>*:last-child]:mb-0!",
            // Editing: selecting text must not drag the card.
            editing && "nodrag cursor-text"
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
            className="text-sm"
          />
        </div>
      </div>

      {/*
        Where a connection is dragged from. All four are `source`: React Flow
        resolves an edge's source from `handleBounds.source` even in loose
        mode, so a node with only target handles would render no edge at all.
        Loose mode is what lets one of these also be dropped on.

        Shown on a hovered or selected card — four dots on every card at rest
        would turn the canvas into a pegboard. Selected is what a touch
        screen has instead of hover. The dot is 12 px, and its ::before
        widens the target to 24 px, so it does not have to be hunted for.
        Never on the card being typed in: there they sit on the text and get
        grabbed instead of it. They come back when typing ends.
        Siblings of the card, not children: the card clips its overflow, and
        a dot sits half outside.

        Hover goes through the `group/idea` class toNode puts on React
        Flow's node wrapper. Not an arbitrary selector: Tailwind turns the
        underscores of `.react-flow__node` into spaces, which is how an
        earlier version never showed the dots at all. `!` only where React
        Flow's own (unlayered) handle CSS sets the same property.
      */}
      {CONNECT_HANDLES.map(({ id: handleId, position }) => (
        <Handle
          key={handleId}
          id={handleId}
          type="source"
          position={position}
          className={cn(
            "!h-3 !w-3 !rounded-full !border-2 !border-background !bg-primary shadow-sm transition-[opacity,scale] hover:scale-150",
            "before:absolute before:-inset-1.5 before:rounded-full",
            editing
              ? "opacity-0 !pointer-events-none"
              : selected
                ? "opacity-100"
                : "opacity-0 group-hover/idea:opacity-100"
          )}
        />
      ))}
    </>
  );
});
