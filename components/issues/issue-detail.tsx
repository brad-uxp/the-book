"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  Heading4,
  List,
  ListOrdered,
  Code,
  Type,
  User,
  ArrowUpRight,
  FileText,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  type Issue,
  type Client,
  COLUMNS,
  InlineTitle,
  InlineStatus,
  InlineClient,
  InlineProgress,
  InlineDate,
  InlineCategory,
} from "./inline-editors";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import {
  MentionList,
  type MentionListRef,
  type MentionPerson,
} from "./mention-list";
import {
  InvoiceMentionList,
  type InvoiceMentionListRef,
  type MentionInvoice,
  formatInvoiceLabel,
} from "./invoice-mention-list";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import type { InvoiceInput } from "@/lib/validations";
import { useNow } from "@/hooks/use-now";

// ── Mention extensions with `deleted` attribute ─────────────────────────────

const PersonMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      deleted: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-deleted") === "true",
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.deleted ? { "data-deleted": "true" } : {},
      },
    };
  },
});

const InvoiceMention = Mention.extend({
  name: "invoiceMention",
  addAttributes() {
    return {
      ...this.parent?.(),
      deleted: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-deleted") === "true",
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.deleted ? { "data-deleted": "true" } : {},
      },
    };
  },
});

// ── Shared toolbar items ────────────────────────────────────────────────────

function getToolbarItems(editor: Editor) {
  return [
    {
      icon: Bold,
      action: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
      label: "Bold",
    },
    {
      icon: Italic,
      action: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
      label: "Italic",
    },
    {
      icon: Type,
      action: () => editor.chain().focus().setParagraph().run(),
      active: editor.isActive("paragraph") && !editor.isActive("heading"),
      label: "Paragraph",
    },
    {
      icon: Heading2,
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading", { level: 2 }),
      label: "Heading 2",
    },
    {
      icon: Heading3,
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor.isActive("heading", { level: 3 }),
      label: "Heading 3",
    },
    {
      icon: Heading4,
      action: () => editor.chain().focus().toggleHeading({ level: 4 }).run(),
      active: editor.isActive("heading", { level: 4 }),
      label: "Heading 4",
    },
    {
      icon: List,
      action: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
      label: "Bullet list",
    },
    {
      icon: ListOrdered,
      action: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
      label: "Ordered list",
    },
    {
      icon: Code,
      action: () => editor.chain().focus().toggleCodeBlock().run(),
      active: editor.isActive("codeBlock"),
      label: "Code block",
    },
  ];
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  const items = getToolbarItems(editor);

  return (
    <div className="flex items-center gap-0.5 border-b pb-2 mb-3 sticky top-0 bg-background z-10 pt-6 -mt-6">
      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.action}
          className={cn(
            "p-1.5 rounded hover:bg-accent transition-colors",
            item.active && "bg-accent text-accent-foreground"
          )}
        >
          <item.icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

// ── Bubble Menu ──────────────────────────────────────────────────────────────

function SelectionBubbleMenu({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  const items = getToolbarItems(editor);

  return (
    <BubbleMenu
      editor={editor}
      className="z-50"
      options={{
        placement: "bottom",
        flip: true,
        offset: 8,
      }}
    >
      <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95 duration-150">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={item.action}
            className={cn(
              "p-1.5 rounded hover:bg-accent transition-colors",
              item.active && "bg-accent text-accent-foreground"
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </BubbleMenu>
  );
}

// ── Mention Click Popover ────────────────────────────────────────────────────

function MentionPopover({
  mention,
  people,
  onClose,
}: {
  mention: { id: string; label: string; rect: DOMRect };
  people: MentionPerson[];
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLAnchorElement>(null);
  const person = people.find((p) => p.id === mention.id);

  // Position above the chip
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;

    const virtualEl = { getBoundingClientRect: () => mention.rect };
    computePosition(virtualEl as Element, el, {
      strategy: "fixed",
      placement: "top",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
  }, [mention.rect]);

  // Close on click outside
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".mention-popover") && !target.closest(".mention")) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [onClose]);

  return (
    <a
      ref={popoverRef}
      href={`/salaries?person=${mention.id}`}
      className="mention-popover fixed z-9999 rounded-lg border bg-popover p-3 shadow-md animate-in fade-in-0 zoom-in-95 duration-150 w-48 block no-underline hover:shadow-lg transition-shadow"
    >
      <ArrowUpRight className="absolute top-2 right-2 h-3 w-3 text-muted-foreground" />
      <div className="flex items-start gap-2">
        <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="min-w-0 pr-4">
          <p className="text-sm font-medium truncate text-foreground">{mention.label}</p>
          {person?.role && (
            <p className="text-xs text-muted-foreground">{person.role.name}</p>
          )}
        </div>
      </div>
    </a>
  );
}

// ── Invoice Click Popover ────────────────────────────────────────────────────

function InvoicePopover({
  invoice,
  invoices,
  onClose,
}: {
  invoice: { id: string; label: string; rect: DOMRect };
  invoices: MentionInvoice[];
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLAnchorElement>(null);
  const inv = invoices.find((i) => i.id === invoice.id);

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;

    const virtualEl = { getBoundingClientRect: () => invoice.rect };
    computePosition(virtualEl as Element, el, {
      strategy: "fixed",
      placement: "top",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
  }, [invoice.rect]);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest(".invoice-popover") &&
        !target.closest(".invoice-mention")
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [onClose]);

  return (
    <a
      ref={popoverRef}
      href={`/invoices?invoice=${invoice.id}`}
      className="invoice-popover fixed z-9999 rounded-lg border bg-popover p-3 shadow-md animate-in fade-in-0 zoom-in-95 duration-150 w-48 block no-underline hover:shadow-lg transition-shadow"
    >
      <ArrowUpRight className="absolute top-2 right-2 h-3 w-3 text-muted-foreground" />
      <div className="flex items-start gap-2">
        <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="min-w-0 pr-4">
          <p className="text-sm font-medium truncate text-foreground">
            {invoice.label}
          </p>
          {inv && (
            <p className="text-xs text-muted-foreground capitalize">
              {inv.status}
            </p>
          )}
        </div>
      </div>
    </a>
  );
}

// ── IssueDetail ──────────────────────────────────────────────────────────────

interface IssueDetailProps {
  issue: Issue | null;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  onUpdate: (id: string, patch: Partial<Issue>) => void;
}

export function IssueDetail({
  issue,
  onOpenChange,
  clients,
  onUpdate,
}: IssueDetailProps) {
  const col = issue ? COLUMNS.find((c) => c.id === issue.status) : null;
  const [expanded, setExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("issues-detail-expanded") === "true";
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem("issues-detail-expanded", String(expanded));
  }, [expanded]);

  // Refs to avoid stale closures in editor callbacks. Assigned after commit,
  // not during render: a render can be thrown away or replayed, and mutating a
  // ref there would leave it pointing at props from a render that never
  // committed. No dependency array — these must track every render.
  const issueRef = useRef(issue);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    issueRef.current = issue;
    onUpdateRef.current = onUpdate;
  });
  const isSyncingRef = useRef(false);

  const now = useNow();

  const isDueSoon = (dateStr: string | null) => {
    if (!dateStr || !now) return false;
    const diff = new Date(dateStr).getTime() - now;
    return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000;
  };

  const isOverdue = (dateStr: string | null) => {
    if (!dateStr || !now) return false;
    return new Date(dateStr).getTime() < now;
  };

  // Fetch people for @mention suggestions
  const [people, setPeople] = useState<MentionPerson[]>([]);
  const [peopleFetched, setPeopleFetched] = useState(false);
  const peopleRef = useRef<MentionPerson[]>([]);

  useEffect(() => {
    fetch("/api/people")
      .then((r) => r.json())
      .then((data: Array<{ id: string; name: string; status: string; role: { id: string; name: string } | null }>) => {
        const mapped: MentionPerson[] = data.map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          status: p.status as "active" | "inactive",
        }));
        setPeople(mapped);
        peopleRef.current = mapped;
        setPeopleFetched(true);
      })
      .catch(console.error);
  }, []);

  // Mention suggestion — rendered as a React component in the tree
  // (no ReactRenderer / manual DOM) so it stays inside Radix's dialog content
  const mentionListRef = useRef<MentionListRef>(null);
  const [mentionSuggestion, setMentionSuggestion] = useState<{
    items: MentionPerson[];
    command: (attrs: { id: string; label: string }) => void;
    clientRect: DOMRect | null;
  } | null>(null);

  const [suggestionConfig] = useState(() => ({
    char: "@",
    allowSpaces: false,
    items: ({ query }: { query: string }) => {
      const active = peopleRef.current.filter((p) => p.status === "active");
      if (!query) return active.slice(0, 8);
      const lower = query.toLowerCase();
      return active
        .filter(
          (p) =>
            p.name.toLowerCase().includes(lower) ||
            p.role?.name.toLowerCase().includes(lower)
        )
        .slice(0, 8);
    },
    render: () => {
      return {
        onStart: (props: SuggestionProps<MentionPerson>) => {
          setMentionSuggestion({
            items: props.items,
            command: (attrs) => props.command(attrs as any),
            clientRect: props.clientRect?.() ?? null,
          });
        },
        onUpdate: (props: SuggestionProps<MentionPerson>) => {
          setMentionSuggestion({
            items: props.items,
            command: (attrs) => props.command(attrs as any),
            clientRect: props.clientRect?.() ?? null,
          });
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === "Escape") {
            setMentionSuggestion(null);
            return true;
          }
          return mentionListRef.current?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          setMentionSuggestion(null);
        },
      };
    },
  }));

  // Fetch invoices for #mention suggestions
  const [invoices, setInvoices] = useState<MentionInvoice[]>([]);
  const [invoicesFetched, setInvoicesFetched] = useState(false);
  const invoicesRef = useRef<MentionInvoice[]>([]);

  const fetchInvoices = () => {
    fetch("/api/invoices")
      .then((r) => r.json())
      .then((data: MentionInvoice[]) => {
        setInvoices(data);
        invoicesRef.current = data;
        setInvoicesFetched(true);
      })
      .catch(console.error);
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  // Invoice suggestion state + config
  const invoiceMentionListRef = useRef<InvoiceMentionListRef>(null);
  const [invoiceSuggestion, setInvoiceSuggestion] = useState<{
    items: MentionInvoice[];
    command: (attrs: { id: string; label: string }) => void;
    clientRect: DOMRect | null;
  } | null>(null);

  const [invoiceSuggestionConfig] = useState(() => ({
    char: "#",
    allowSpaces: false,
    items: ({ query }: { query: string }) => {
      const all = invoicesRef.current;
      if (!query) return all.slice(0, 8);
      const lower = query.toLowerCase();
      return all
        .filter(
          (inv) =>
            inv.invoice_number?.toLowerCase().includes(lower) ||
            inv.client.name.toLowerCase().includes(lower)
        )
        .slice(0, 8);
    },
    render: () => {
      return {
        onStart: (props: SuggestionProps<MentionInvoice>) => {
          setInvoiceSuggestion({
            items: props.items,
            command: (attrs) => props.command(attrs as any),
            clientRect: props.clientRect?.() ?? null,
          });
        },
        onUpdate: (props: SuggestionProps<MentionInvoice>) => {
          setInvoiceSuggestion({
            items: props.items,
            command: (attrs) => props.command(attrs as any),
            clientRect: props.clientRect?.() ?? null,
          });
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === "Escape") {
            setInvoiceSuggestion(null);
            return true;
          }
          return invoiceMentionListRef.current?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          setInvoiceSuggestion(null);
        },
      };
    },
  }));

  // "Create new invoice" flow
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
  const [createInvoiceLoading, setCreateInvoiceLoading] = useState(false);
  const [referrers, setReferrers] = useState<Array<{ id: string; name: string; color_hex: string }>>([]);
  const pendingInvoiceCommandRef = useRef<
    ((attrs: { id: string; label: string }) => void) | null
  >(null);

  const handleInvoiceCreateNew = () => {
    if (invoiceSuggestion) {
      pendingInvoiceCommandRef.current = invoiceSuggestion.command;
      setInvoiceSuggestion(null);
    }
    fetch("/api/referrers").then((r) => r.json()).then(setReferrers).catch(() => {});
    setCreateInvoiceOpen(true);
  };

  const handleInvoiceCreateSubmit = async (input: InvoiceInput) => {
    setCreateInvoiceLoading(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Error creating invoice");
        return;
      }
      const created = await res.json();
      const label = formatInvoiceLabel(created);
      pendingInvoiceCommandRef.current?.({ id: created.id, label });
      pendingInvoiceCommandRef.current = null;
      fetchInvoices();
      setCreateInvoiceOpen(false);
    } finally {
      setCreateInvoiceLoading(false);
    }
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Add a description..." }),
      PersonMention.configure({
        HTMLAttributes: {
          class: "mention",
        },
        suggestion: suggestionConfig,
        renderHTML({ options, node }) {
          return [
            "span",
            {
              ...options.HTMLAttributes,
              "data-mention-id": node.attrs.id,
              "data-mention-label": node.attrs.label,
              ...(node.attrs.deleted ? { "data-deleted": "true" } : {}),
            },
            `${node.attrs.label}`,
          ];
        },
      }),
      InvoiceMention.configure({
        HTMLAttributes: {
          class: "invoice-mention",
        },
        suggestion: invoiceSuggestionConfig,
        renderHTML({ options, node }) {
          return [
            "span",
            {
              ...options.HTMLAttributes,
              "data-invoice-id": node.attrs.id,
              "data-invoice-label": node.attrs.label,
              ...(node.attrs.deleted ? { "data-deleted": "true" } : {}),
            },
            `${node.attrs.label}`,
          ];
        },
      }),
    ],
    content: issue?.description || "",
    onUpdate: ({ editor: ed }) => {
      if (isSyncingRef.current) return;
      const t = issueRef.current;
      if (t) {
        onUpdateRef.current(t.id, { description: ed.getHTML() });
      }
    },
    editorProps: {
      attributes: {
        class: "tiptap outline-none min-h-[200px] text-sm",
      },
    },
  });

  // Sync editor content when switching between issues
  // isSyncingRef prevents onUpdate from firing during programmatic setContent
  useEffect(() => {
    if (editor && issue) {
      const current = editor.getHTML();
      if (current !== (issue.description || "")) {
        isSyncingRef.current = true;
        editor.commands.setContent(issue.description || "");
        isSyncingRef.current = false;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id, editor]);

  // Mention click popovers
  const [clickedMention, setClickedMention] = useState<{
    id: string;
    label: string;
    rect: DOMRect;
  } | null>(null);

  const [clickedInvoice, setClickedInvoice] = useState<{
    id: string;
    label: string;
    rect: DOMRect;
  } | null>(null);

  useEffect(() => {
    const editorEl = editor?.view?.dom;
    if (!editorEl) return;

    const handleClick = (e: Event) => {
      const target = (e as MouseEvent).target as HTMLElement;

      const invoiceEl = target.closest?.(".invoice-mention") as HTMLElement | null;
      if (invoiceEl) {
        e.preventDefault();
        if (invoiceEl.dataset.deleted === "true") return;
        setClickedMention(null);
        setClickedInvoice({
          id: invoiceEl.dataset.invoiceId || "",
          label: invoiceEl.dataset.invoiceLabel || "",
          rect: invoiceEl.getBoundingClientRect(),
        });
        return;
      }

      const mentionEl = target.closest?.(".mention") as HTMLElement | null;
      if (mentionEl) {
        e.preventDefault();
        if (mentionEl.dataset.deleted === "true") return;
        setClickedInvoice(null);
        setClickedMention({
          id: mentionEl.dataset.mentionId || "",
          label: mentionEl.dataset.mentionLabel || "",
          rect: mentionEl.getBoundingClientRect(),
        });
      }
    };

    editorEl.addEventListener("click", handleClick);
    return () => editorEl.removeEventListener("click", handleClick);
  }, [editor]);

  // Dynamic label sync for person mentions (+ deleted detection)
  useEffect(() => {
    if (!editor || !peopleFetched) return;
    const { doc } = editor.state;
    const tr = editor.state.tr;
    let changed = false;
    doc.descendants((node, pos) => {
      if (node.type.name === "mention") {
        const person = people.find((p) => p.id === node.attrs.id);
        if (person) {
          // Entity exists — sync label and clear deleted flag
          if (node.attrs.label !== person.name || node.attrs.deleted) {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              label: person.name,
              deleted: false,
            });
            changed = true;
          }
        } else if (!node.attrs.deleted) {
          // Entity was deleted — mark chip
          const deletedLabel = node.attrs.label.replace(/ \(eliminado\)$/, "") + " (eliminado)";
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            label: deletedLabel,
            deleted: true,
          });
          changed = true;
        }
      }
    });
    if (changed) editor.view.dispatch(tr);
     
  }, [editor, people, peopleFetched, issue?.id]);

  // Dynamic label sync for invoice mentions (+ deleted detection)
  useEffect(() => {
    if (!editor || !invoicesFetched) return;
    const { doc } = editor.state;
    const tr = editor.state.tr;
    let changed = false;
    doc.descendants((node, pos) => {
      if (node.type.name === "invoiceMention") {
        const inv = invoices.find((i) => i.id === node.attrs.id);
        if (inv) {
          const label = formatInvoiceLabel(inv);
          if (node.attrs.label !== label || node.attrs.deleted) {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              label,
              deleted: false,
            });
            changed = true;
          }
        } else if (!node.attrs.deleted) {
          const deletedLabel = node.attrs.label.replace(/ \(eliminado\)$/, "") + " (eliminado)";
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            label: deletedLabel,
            deleted: true,
          });
          changed = true;
        }
      }
    });
    if (changed) editor.view.dispatch(tr);
     
  }, [editor, invoices, invoicesFetched, issue?.id]);

  return (
    <>
    <Sheet open={!!issue} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        fadeOnly={expanded}
        className={cn(
          "w-full sm:max-w-none p-0 flex flex-col transition-all duration-300",
          expanded
            ? "sm:w-[80%] sm:h-[90vh] sm:inset-0 sm:m-auto sm:rounded-xl sm:border"
            : "sm:w-1/2"
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{issue?.title ?? "Issue"}</SheetTitle>
        </SheetHeader>

        {issue && (
          <>
            <div className="flex-1 overflow-y-auto">
              {/* Properties header */}
              <div className="px-8 py-6 space-y-4 border-b">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <InlineTitle
                      value={issue.title}
                      onCommit={(title) => onUpdate(issue.id, { title })}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => setExpanded(!expanded)}
                    >
                      {expanded ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </Button>
                    <div className="w-px h-4 bg-border" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => onOpenChange(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-20 shrink-0">
                      Type
                    </span>
                    <InlineCategory
                      value={issue.category}
                      onCommit={(category) => onUpdate(issue.id, { category })}
                    />
                  </div>

                  {issue.category === "task" && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20 shrink-0">
                        Status
                      </span>
                      <InlineStatus
                        value={issue.status}
                        onCommit={(status) => onUpdate(issue.id, { status })}
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-20 shrink-0">
                      Client
                    </span>
                    <InlineClient
                      issue={issue}
                      clients={clients}
                      onCommit={(clientId) => {
                        const c = clientId
                          ? clients.find((cl) => cl.id === clientId) ?? null
                          : null;
                        onUpdate(issue.id, {
                          client_id: clientId,
                          client: c
                            ? {
                                id: c.id,
                                name: c.name,
                                color_hex: c.color_hex,
                              }
                            : null,
                        });
                      }}
                    />
                  </div>

                  {issue.category === "task" && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20 shrink-0">
                        Progress
                      </span>
                      <div className="w-28">
                        <InlineProgress
                          value={issue.progress}
                          color={col?.color ?? "#94a3b8"}
                          onCommit={(v) => onUpdate(issue.id, { progress: v })}
                        />
                      </div>
                    </div>
                  )}

                  {issue.category === "task" && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20 shrink-0">
                        Due date
                      </span>
                      <InlineDate
                        value={issue.due_date}
                        status={issue.status}
                        isDueSoon={isDueSoon(issue.due_date)}
                        isOverdue={isOverdue(issue.due_date)}
                        onCommit={(iso) => onUpdate(issue.id, { due_date: iso })}
                      />
                    </div>
                  )}
                </div>

              </div>

              {/* Description editor */}
              <div className="px-12 py-6">
                <EditorToolbar editor={editor} />
                <EditorContent editor={editor} />
                <SelectionBubbleMenu editor={editor} />
              </div>
            </div>

            {/* Mention suggestion dropdown — inside SheetContent so Radix
                doesn't intercept pointer events */}
            {mentionSuggestion && (
              <MentionList
                ref={mentionListRef}
                items={mentionSuggestion.items}
                command={mentionSuggestion.command}
                clientRect={mentionSuggestion.clientRect}
              />
            )}

            {/* Invoice suggestion dropdown */}
            {invoiceSuggestion && (
              <InvoiceMentionList
                ref={invoiceMentionListRef}
                items={invoiceSuggestion.items}
                command={invoiceSuggestion.command}
                clientRect={invoiceSuggestion.clientRect}
                onCreateNew={handleInvoiceCreateNew}
              />
            )}

            {/* Mention click popover */}
            {clickedMention && (
              <MentionPopover
                mention={clickedMention}
                people={people}
                onClose={() => setClickedMention(null)}
              />
            )}

            {/* Invoice click popover */}
            {clickedInvoice && (
              <InvoicePopover
                invoice={clickedInvoice}
                invoices={invoices}
                onClose={() => setClickedInvoice(null)}
              />
            )}
          </>
        )}
      </SheetContent>

    </Sheet>

    {/* Create invoice dialog — outside Sheet so it stacks properly */}
    <Dialog open={createInvoiceOpen} onOpenChange={setCreateInvoiceOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Invoice</DialogTitle>
        </DialogHeader>
        <InvoiceForm
          clients={clients}
          referrers={referrers}
          onSubmit={handleInvoiceCreateSubmit}
          onCancel={() => {
            setCreateInvoiceOpen(false);
            pendingInvoiceCommandRef.current = null;
          }}
          loading={createInvoiceLoading}
        />
      </DialogContent>
    </Dialog>
    </>
  );
}
