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
import { FileText, Plus } from "lucide-react";
import { formatCents } from "@/lib/currency";

export interface MentionInvoice {
  id: string;
  invoice_number: string | null;
  client: { id: string; name: string; color_hex: string };
  status: string;
  amount_cents: number;
}

export function formatInvoiceLabel(inv: {
  invoice_number: string | null;
  client: { name: string };
  amount_cents: number;
}) {
  const num = inv.invoice_number ?? "?";
  return `Inv ${num}: ${inv.client.name} \u2014 ${formatCents(inv.amount_cents)}`;
}

export interface InvoiceMentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface InvoiceMentionListProps {
  items: MentionInvoice[];
  command: (attrs: { id: string; label: string }) => void;
  clientRect: DOMRect | null;
  onCreateNew: () => void;
}

export const InvoiceMentionList = forwardRef<
  InvoiceMentionListRef,
  InvoiceMentionListProps
>(({ items, command, clientRect, onCreateNew }, ref) => {
  // index 0 = "Create new", 1..N = invoice items
  const totalItems = items.length + 1;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelectedIndex(0), [items]);

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
    if (index === 0) {
      onCreateNew();
    } else {
      const item = items[index - 1];
      if (item) command({ id: item.id, label: formatInvoiceLabel(item) });
    }
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i + totalItems - 1) % totalItems);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % totalItems);
        return true;
      }
      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      ref={wrapperRef}
      className="fixed z-9999 rounded-lg border bg-popover p-1 shadow-md max-h-48 overflow-y-auto"
    >
      {/* Create new invoice */}
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          selectItem(0);
        }}
        className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded transition-colors ${
          selectedIndex === 0
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/50"
        }`}
      >
        <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium">Create new invoice</span>
      </button>

      {/* Existing invoices */}
      {items.map((item, index) => (
        <button
          key={item.id}
          onMouseDown={(e) => {
            e.preventDefault();
            selectItem(index + 1);
          }}
          className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded transition-colors ${
            index + 1 === selectedIndex
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          }`}
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: item.client.color_hex }}
          />
          <div className="flex flex-col items-start min-w-0">
            <span className="truncate font-medium">
              {formatInvoiceLabel(item)}
            </span>
            <span className="text-xs text-muted-foreground truncate capitalize">
              {item.status}
            </span>
          </div>
        </button>
      ))}

      {items.length === 0 && (
        <div className="px-2 py-1 text-sm text-muted-foreground">
          No invoices found
        </div>
      )}
    </div>
  );
});

InvoiceMentionList.displayName = "InvoiceMentionList";
