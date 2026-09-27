"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { User } from "lucide-react";

export interface MentionPerson {
  id: string;
  name: string;
  role: { id: string; name: string } | null;
  status: "active" | "inactive";
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MentionListProps {
  items: MentionPerson[];
  command: (attrs: { id: string; label: string }) => void;
  clientRect: DOMRect | null;
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command, clientRect }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => setSelectedIndex(0), [items]);

    // Position the dropdown near the cursor using floating-ui
    useLayoutEffect(() => {
      const el = wrapperRef.current;
      if (!el || !clientRect) return;

      const virtualEl = { getBoundingClientRect: () => clientRect };
      computePosition(virtualEl as Element, el, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [offset(8), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      });
    }, [clientRect]);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) command({ id: item.id, label: item.name });
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div
          ref={wrapperRef}
          className="fixed z-9999 rounded-lg border bg-popover p-2 shadow-md text-sm text-muted-foreground"
        >
          No people found
        </div>
      );
    }

    return (
      <div
        ref={wrapperRef}
        className="fixed z-9999 rounded-lg border bg-popover p-1 shadow-md max-h-48 overflow-y-auto"
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            onMouseDown={(e) => {
              e.preventDefault();
              selectItem(index);
            }}
            className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded transition-colors ${
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50"
            }`}
          >
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="flex flex-col items-start min-w-0">
              <span className="truncate font-medium">{item.name}</span>
              {item.role && (
                <span className="text-xs text-muted-foreground truncate">
                  {item.role.name}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    );
  }
);

MentionList.displayName = "MentionList";
