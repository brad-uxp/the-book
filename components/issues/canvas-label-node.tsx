"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LABEL_COLOR_KEYS,
  LABEL_COLORS,
  LABEL_MAX_LENGTH,
  LABEL_MAX_WIDTH,
  labelColor,
  type CanvasLabel,
} from "@/lib/canvas-labels";

/** A `type`, not an `interface`: React Flow requires an index-signature fit. */
export type LabelNodeData = {
  label: CanvasLabel;
  onCommitText: (id: string, text: string) => void;
  onSetColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
};
export type LabelNode = Node<LabelNodeData, "label">;

/**
 * A text chip on the canvas.
 *
 * No handles, so it cannot be connected to anything: an edge is a statement
 * about work, and a chip is a heading. It also means React Flow will not let a
 * connection be dropped on one, without any rule having to say so.
 *
 * A chip created with no text opens straight into its editor, and blurring it
 * while still empty removes it — an untitled chip is a smudge on the canvas
 * that has to be hunted down and deleted by hand.
 */
export const CanvasLabelNode = memo(function CanvasLabelNode({
  data,
  selected,
}: NodeProps<LabelNode>) {
  const { label, onCommitText, onSetColor, onDelete } = data;
  const color = labelColor(label.color);

  const [editing, setEditing] = useState(() => label.text === "");
  const [draft, setDraft] = useState(label.text);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Text can change underneath us — another tab, a rolled-back save — but not
  // while it is being typed into.
  useEffect(() => {
    if (!editing) setDraft(label.text);
  }, [label.text, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === label.text) return;
    if (next === "") {
      onDelete(label.id);
      return;
    }
    onCommitText(label.id, next);
  };

  const cancel = () => {
    setDraft(label.text);
    setEditing(false);
    // Abandoning a chip that never had text leaves nothing worth keeping.
    if (label.text === "") onDelete(label.id);
  };

  return (
    <div className="relative" style={{ maxWidth: LABEL_MAX_WIDTH }}>
      {/*
        The chip's own toolbar, shown while it is selected. A popover would
        need a portal and would fight the canvas transform; this rides along
        with the node.
      */}
      {selected && !editing && (
        <div className="nodrag nopan absolute -top-9 left-0 z-10 flex items-center gap-1 rounded-lg border bg-card p-1 shadow-md">
          {LABEL_COLOR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              title={LABEL_COLORS[key].label}
              aria-label={LABEL_COLORS[key].label}
              onClick={() => onSetColor(label.id, key)}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border-2 transition-transform hover:scale-110",
                label.color === key ? "border-foreground" : "border-transparent"
              )}
              style={{ backgroundColor: LABEL_COLORS[key].hex }}
            >
              {label.color === key && (
                <Check className="h-3 w-3 text-background" />
              )}
            </button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            aria-label="Delete label"
            onClick={() => onDelete(label.id)}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div
        onDoubleClick={() => setEditing(true)}
        className={cn(
          "rounded-full border px-3 py-1.5 text-sm font-medium transition-shadow",
          selected ? "shadow-md ring-2 ring-primary/30" : "shadow-sm"
        )}
        style={{
          backgroundColor: `${color.hex}20`,
          borderColor: `${color.hex}55`,
          color: color.hex,
        }}
      >
        {editing ? (
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            maxLength={LABEL_MAX_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              // Enter commits; Shift+Enter is a line break. Escape abandons.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
              // Backspace inside the editor is text, not "delete this node".
              e.stopPropagation();
            }}
            placeholder="Label…"
            className="nodrag nopan w-full resize-none bg-transparent text-center leading-tight outline-none placeholder:text-current/40"
            style={{ color: color.hex }}
          />
        ) : (
          <p className="text-center leading-tight break-words whitespace-pre-wrap">
            {label.text}
          </p>
        )}
      </div>
    </div>
  );
});
