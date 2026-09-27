"use client";

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type {
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import {
  ArrowUpRight,
  Bold,
  Code,
  FileText,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  List,
  ListOrdered,
  Type,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InvoiceMention, PersonMention } from "./mention-extensions";
import { useMentionData } from "./mention-data";
import {
  MentionList,
  type MentionListRef,
  type MentionPerson,
} from "./mention-list";
import {
  InvoiceMentionList,
  formatInvoiceLabel,
  type InvoiceMentionListRef,
  type MentionInvoice,
} from "./invoice-mention-list";

// ── Toolbar items ────────────────────────────────────────────────────────────

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

function SelectionBubbleMenu({
  editor,
  appendTo,
}: {
  editor: Editor | null;
  appendTo?: () => HTMLElement;
}) {
  if (!editor) return null;

  const items = getToolbarItems(editor);

  return (
    <BubbleMenu
      editor={editor}
      className="z-50"
      appendTo={appendTo}
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

// ── RichTextEditor ───────────────────────────────────────────────────────────

export interface RichTextEditorHandle {
  /**
   * Makes the editor editable and puts the cursor at a screen point — where
   * someone double-clicked a read-only card — or at the end when the point is
   * not over text.
   */
  focusAt: (clientX: number, clientY: number) => void;
  focusEnd: () => void;
}

interface RichTextEditorProps {
  /**
   * Which document this is. When it changes, the editor swaps its content for
   * `value` — the detail sheet keeps one editor while moving between issues.
   * `value` alone changing does NOT replace what is on screen: it is the
   * editor's own output coming back, and resetting it would jump the cursor.
   */
  docKey: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Read-only when false; toggling it never remounts the editor. */
  editable?: boolean;
  /** The fixed formatting bar above the text. The bubble menu is always on. */
  toolbar?: boolean;
  /**
   * Where suggestion lists, mention popovers and the bubble menu render.
   *
   * `inline` keeps them in the React tree, next to the editor — required
   * inside a Radix dialog or sheet, which ignores pointer events on anything
   * outside its content.
   *
   * `portal` sends them to document.body — required inside a canvas node,
   * whose ancestor carries the pan/zoom transform: a fixed element under a
   * transform is positioned against that ancestor, not the screen, and would
   * be drawn scaled with the canvas.
   */
  overlays?: "inline" | "portal";
  /** Classes for the editable surface itself. */
  className?: string;
  ref?: Ref<RichTextEditorHandle>;
}

/**
 * The rich-text editor behind every note: a text note's description and each
 * idea on a canvas note. Bold, headings, lists, code, @person and #invoice
 * mentions — the same in both places, because a canvas idea is "the same text
 * as a note", only smaller.
 *
 * Needs a <MentionDataProvider> above it for the people and invoices lists.
 */
export function RichTextEditor({
  docKey,
  value,
  onChange,
  placeholder = "Add a description...",
  editable = true,
  toolbar = false,
  overlays = "inline",
  className,
  ref,
}: RichTextEditorProps) {
  const {
    people,
    peopleFetched,
    peopleRef,
    invoices,
    invoicesFetched,
    invoicesRef,
    requestCreateInvoice,
  } = useMentionData();

  // Latest callback for the editor, which is built once. Assigned after
  // commit, never during render: a render can be thrown away or replayed.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const isSyncingRef = useRef(false);

  // Mention suggestion — rendered as a React component in the tree (no
  // ReactRenderer / manual DOM) so it can stay inside a Radix dialog.
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

  const handleInvoiceCreateNew = () => {
    if (!invoiceSuggestion) return;
    requestCreateInvoice(invoiceSuggestion.command);
    setInvoiceSuggestion(null);
  };

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
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
    content: value,
    onUpdate: ({ editor: ed }) => {
      if (isSyncingRef.current) return;
      onChangeRef.current(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: cn("tiptap outline-none", className),
      },
    },
  });

  // Swap the content when the document changes (a different issue).
  // isSyncingRef keeps the programmatic setContent from echoing back as an
  // edit.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      isSyncingRef.current = true;
      editor.commands.setContent(value);
      isSyncingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, editor]);

  // `false` as the second argument: flipping read-only on and off is not an
  // edit, and must not fire onUpdate — that would save unchanged text every
  // time a card is opened.
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable, false);
    }
  }, [editor, editable]);

  useImperativeHandle(
    ref,
    () => ({
      focusAt: (clientX, clientY) => {
        if (!editor) return;
        if (!editor.isEditable) editor.setEditable(true, false);
        const hit = editor.view.posAtCoords({ left: clientX, top: clientY });
        editor.chain().focus(hit ? hit.pos : "end").run();
      },
      focusEnd: () => {
        if (!editor) return;
        if (!editor.isEditable) editor.setEditable(true, false);
        editor.chain().focus("end").run();
      },
    }),
    [editor]
  );

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
  }, [editor, people, peopleFetched, docKey]);

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
  }, [editor, invoices, invoicesFetched, docKey]);

  const floating =
    mentionSuggestion || invoiceSuggestion || clickedMention || clickedInvoice ? (
      <>
        {mentionSuggestion && (
          <MentionList
            ref={mentionListRef}
            items={mentionSuggestion.items}
            command={mentionSuggestion.command}
            clientRect={mentionSuggestion.clientRect}
          />
        )}

        {invoiceSuggestion && (
          <InvoiceMentionList
            ref={invoiceMentionListRef}
            items={invoiceSuggestion.items}
            command={invoiceSuggestion.command}
            clientRect={invoiceSuggestion.clientRect}
            onCreateNew={handleInvoiceCreateNew}
          />
        )}

        {clickedMention && (
          <MentionPopover
            mention={clickedMention}
            people={people}
            onClose={() => setClickedMention(null)}
          />
        )}

        {clickedInvoice && (
          <InvoicePopover
            invoice={clickedInvoice}
            invoices={invoices}
            onClose={() => setClickedInvoice(null)}
          />
        )}
      </>
    ) : null;

  return (
    <>
      {toolbar && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} />
      <SelectionBubbleMenu
        editor={editor}
        appendTo={overlays === "portal" ? () => document.body : undefined}
      />
      {floating &&
        (overlays === "portal" ? createPortal(floating, document.body) : floating)}
    </>
  );
}
