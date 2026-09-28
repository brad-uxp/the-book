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
import { formatInvoiceLabel } from "@/lib/mentions";
import { MENTION_NODE, richTextExtensions } from "@/lib/rich-text/extensions";
import { syncMentionLabels } from "@/lib/rich-text/mention-sync";
import { useMentionData } from "./mention-data";
import {
  MentionList,
  type MentionListRef,
  type MentionPerson,
} from "./mention-list";
import {
  InvoiceMentionList,
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

function setBubbleLayer(element: HTMLDivElement | null) {
  if (element) element.style.zIndex = "9999";
}

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
      // The layer goes on TipTap's own positioned element, which the ref
      // exposes: `className` only reaches the div inside it. Without it the
      // menu sat at z-index auto — under the full-screen canvas (fixed,
      // z-50), so it never showed there. Same layer as the mention lists.
      ref={setBubbleLayer}
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
  isFocused: () => boolean;
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
  /**
   * Put the cursor at the end as soon as the editor exists. For an idea just
   * created on a canvas: the editor is built after mount, so the card cannot
   * focus it from outside yet.
   */
  autoFocus?: boolean;
  /** The fixed formatting bar above the text. The bubble menu is always on. */
  toolbar?: boolean;
  /**
   * Escape pressed with no @/# suggestion list open. The editor has to be the
   * one to say so: ProseMirror marks every Escape as handled, and once the
   * suggestion plugin has closed its list there is no telling afterwards
   * whether the key was spent on that.
   */
  onEscape?: () => void;
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
  autoFocus = false,
  toolbar = false,
  onEscape,
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
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onChangeRef.current = onChange;
    onEscapeRef.current = onEscape;
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
    // The schema and the mention markup are shared with the phone's editor;
    // only how the suggestion lists are drawn is decided here.
    extensions: richTextExtensions({
      placeholder,
      personSuggestion: suggestionConfig,
      invoiceSuggestion: invoiceSuggestionConfig,
    }),
    content: value,
    onUpdate: ({ editor: ed }) => {
      if (isSyncingRef.current) return;
      onChangeRef.current(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: cn("tiptap outline-none", className),
      },
      // Runs before any plugin, so an open suggestion list is still marked in
      // the DOM here — and then Escape is its to close, not ours.
      handleKeyDown: (view, event) => {
        if (event.key !== "Escape" || !onEscapeRef.current) return false;
        if (view.dom.querySelector("[data-decoration-id]")) return false;
        onEscapeRef.current();
        return true;
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
  //
  // Leaving edit mode also drops focus. A read-only ProseMirror keeps its
  // `contenteditable` attribute (set to false), and React Flow ignores the
  // Delete key on anything carrying that attribute — so a card that kept
  // focus after editing could not be deleted from the keyboard.
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable, false);
      if (!editable) editor.commands.blur();
    }
  }, [editor, editable]);

  // Once, when the editor comes to exist — see `autoFocus`.
  useEffect(() => {
    if (editor && autoFocus) {
      if (!editor.isEditable) editor.setEditable(true, false);
      editor.commands.focus("end");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

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
      isFocused: () => editor?.isFocused ?? false,
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

  // Keep person chips in line with the people list: renamed, or marked
  // deleted. Only once the list has loaded — see syncMentionLabels.
  useEffect(() => {
    if (!editor || !peopleFetched) return;
    const tr = syncMentionLabels(
      editor.state,
      MENTION_NODE.person,
      (id) => people.find((p) => p.id === id)?.name ?? null
    );
    if (tr) editor.view.dispatch(tr);
  }, [editor, people, peopleFetched, docKey]);

  // The same for invoice chips.
  useEffect(() => {
    if (!editor || !invoicesFetched) return;
    const tr = syncMentionLabels(editor.state, MENTION_NODE.invoice, (id) => {
      const inv = invoices.find((i) => i.id === id);
      return inv ? formatInvoiceLabel(inv) : null;
    });
    if (tr) editor.view.dispatch(tr);
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
