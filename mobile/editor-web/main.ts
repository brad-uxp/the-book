import { Editor } from "@tiptap/core";
import type { SuggestionProps } from "@tiptap/suggestion";
import { MENTION_NODE } from "../../lib/rich-text/extensions";
import { syncMentionLabels } from "../../lib/rich-text/mention-sync";
import {
  TOOLBAR_ACTIONS,
  parseToPage,
  type ActiveFormats,
  type FromPage,
  type MentionKind,
  type MentionLabels,
  type ToPage,
  type ToolbarAction,
} from "../src/editor/protocol";
import { MARK_ACTIONS, lateTypedRange, recentLetters, type TypedLetter } from "../src/editor/typing";
import { pageExtensions } from "./extensions";

/**
 * The editor page inside the WebView: TipTap with the web's extensions, and
 * a bridge to RichTextEditor on the native side. The page has no network and
 * no storage — it holds one document, as the native side hands it over, and
 * reports back what it becomes.
 */

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

function send(message: FromPage) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

let editor: Editor | null = null;
let docKey = "";
let placeholder = "";
let labels: Record<MentionKind, Map<string, string>> = { person: new Map(), invoice: new Map() };

// ── Suggestions: detected here, listed and chosen on the native side ────────

type InsertMention = (attrs: { id: string; label: string }) => void;
const openSuggestion: Record<MentionKind, InsertMention | null> = { person: null, invoice: null };

function suggestionUi(kind: MentionKind) {
  const track = (props: SuggestionProps<unknown>) => {
    openSuggestion[kind] = props.command as InsertMention;
    send({ type: "suggestion", kind, query: props.query });
  };
  return {
    // The native list filters the people and invoices it holds.
    items: () => [],
    render: () => ({
      onStart: track,
      onUpdate: track,
      onExit: () => {
        openSuggestion[kind] = null;
        send({ type: "suggestionEnd" });
      },
    }),
  };
}

// ── What the toolbar does, and what it shows as active ───────────────────────
// The same set, and the same notion of "active", as the web's toolbar.

const RUN: Record<ToolbarAction, (e: Editor) => boolean> = {
  bold: (e) => e.chain().focus().toggleBold().run(),
  italic: (e) => e.chain().focus().toggleItalic().run(),
  highlight: (e) => e.chain().focus().toggleHighlight().run(),
  paragraph: (e) => e.chain().focus().setParagraph().run(),
  h2: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  h3: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  h4: (e) => e.chain().focus().toggleHeading({ level: 4 }).run(),
  bulletList: (e) => e.chain().focus().toggleBulletList().run(),
  orderedList: (e) => e.chain().focus().toggleOrderedList().run(),
  codeBlock: (e) => e.chain().focus().toggleCodeBlock().run(),
};

const IS_ACTIVE: Record<ToolbarAction, (e: Editor) => boolean> = {
  bold: (e) => e.isActive("bold"),
  italic: (e) => e.isActive("italic"),
  highlight: (e) => e.isActive("highlight"),
  paragraph: (e) => e.isActive("paragraph") && !e.isActive("heading"),
  h2: (e) => e.isActive("heading", { level: 2 }),
  h3: (e) => e.isActive("heading", { level: 3 }),
  h4: (e) => e.isActive("heading", { level: 4 }),
  bulletList: (e) => e.isActive("bulletList"),
  orderedList: (e) => e.isActive("orderedList"),
  codeBlock: (e) => e.isActive("codeBlock"),
};

let lastState = "";
function reportState() {
  if (!editor || settling) return;
  const active = {} as ActiveFormats;
  for (const action of TOOLBAR_ACTIONS) active[action] = IS_ACTIVE[action](editor);
  const message: FromPage = { type: "state", focused: editor.isFocused, active };
  const key = JSON.stringify(message);
  if (key === lastState) return;
  lastState = key;
  send(message);
}

// ── Changes ──────────────────────────────────────────────────────────────────
// Sent as soon as they happen, coalesced per task (a paste or an IME burst is
// one message). The native side debounces before saving; it can only flush
// what has already crossed, so nothing is held back here.

let changeQueued = false;
function queueChange() {
  if (changeQueued) return;
  changeQueued = true;
  setTimeout(() => {
    changeQueued = false;
    if (editor) send({ type: "change", docKey, html: editor.getHTML() });
  }, 0);
}

/** Flushes a change still queued for the current document, before it is replaced. */
function flushChange() {
  if (!changeQueued || !editor) return;
  changeQueued = false;
  send({ type: "change", docKey, html: editor.getHTML() });
}

// ── The keyboard: compositions and fast typing ───────────────────────────────
// Android keyboards compose the word being typed (it shows underlined) and
// only commit it at a space or a pick. Everything the native side asks for —
// a toolbar format, @ or #, a picked mention, a new document — arrives from
// outside the page, so it never ends that composition the way a click on the
// web would; and ProseMirror cannot change text or marks around a live one.
// Bold toggled while the keyboard composes came back with the word duplicated
// ("hel" + bold "hello") or was dropped for the letters typed right after B.
// So a composition is ended before any such command runs.
//
// The same messages race the typing itself: a format pressed right before
// the next letters can cross after them. So the page remembers the letters
// typed in the last seconds, and a format covers those that came in after
// its press (lateTypedRange).

/** Recently typed letters — when each came in and where it went. */
let letters: TypedLetter[] = [];
/** Set while settleComposition moves focus away and back: not a real blur. */
let settling = false;
/** Mention labels that changed during a composition, applied once it ends. */
let labelsPending = false;

function trackTyping(view: Editor["view"]) {
  // Letters committed one by one and letters the keyboard composes both come
  // through here, before the document changes. Registered after
  // ProseMirror's own listener, so the document holds everything before them.
  view.dom.addEventListener("beforeinput", (event) => {
    if (!editor) return;
    const { inputType } = event as InputEvent;
    if (inputType !== "insertText" && inputType !== "insertCompositionText") return;
    const now = Date.now();
    letters = recentLetters(letters, now);
    letters.push({ at: now, pos: editor.state.selection.from });
  });
  view.dom.addEventListener("compositionend", () => {
    if (!labelsPending) return;
    // After ProseMirror has settled the composition it just closed.
    setTimeout(() => {
      if (!editor || editor.view.composing || !labelsPending) return;
      labelsPending = false;
      syncLabels();
    }, 30);
  });
}

/**
 * Ends the keyboard's composition, if one is open, with its text committed
 * into the document. Moving focus away and straight back is the one thing a
 * page can do that makes the browser commit a composition and tell the
 * keyboard to drop it; the focus events it causes are not reported to the
 * native side, which never sees the editor lose focus.
 */
function settleComposition() {
  if (!editor || !editor.view.composing) return;
  const view = editor.view;
  settling = true;
  try {
    view.dom.blur();
    view.focus();
    // Read what was committed now, not in the next microtask.
    (view as unknown as { domObserver: { flush(): void } }).domObserver.flush();
  } finally {
    settling = false;
  }
  reportState();
}

/**
 * Runs a toolbar action. A mark toggled after the next letters were already
 * typed (the press crossed after them) covers those letters too — see
 * lateTypedRange.
 */
function format(action: ToolbarAction, pressedAt: number | undefined) {
  if (!editor) return;
  settleComposition();
  RUN[action](editor);
  const mark = MARK_ACTIONS[action];
  const range = mark ? lateTypedRange(letters, pressedAt, editor.state.selection.from) : null;
  if (!mark || !range) return;
  const { state } = editor;
  const type = state.schema.marks[mark];
  const tr = editor.isActive(mark)
    ? state.tr.addMark(range.from, range.to, type.create())
    : state.tr.removeMark(range.from, range.to, type);
  // Changing the text drops the stored marks; the toggle still applies to
  // what is typed next.
  tr.setStoredMarks(state.storedMarks);
  editor.view.dispatch(tr);
}

// ── Mention labels ───────────────────────────────────────────────────────────

function toMap(list: MentionLabels): Map<string, string> {
  return new Map(list);
}

/**
 * Renamed people and invoices get their new label; missing ones are marked
 * deleted — as the web does, with the same function. A kind whose list is not
 * known yet is left alone: an empty cache is not "everyone was deleted".
 */
function syncLabels() {
  if (!editor) return;
  const kinds: [string, Map<string, string>][] = [
    [MENTION_NODE.person, labels.person],
    [MENTION_NODE.invoice, labels.invoice],
  ];
  for (const [nodeName, map] of kinds) {
    if (map.size === 0) continue;
    const tr = syncMentionLabels(editor.state, nodeName, (id) => map.get(id) ?? null);
    if (tr) editor.view.dispatch(tr);
  }
}

// ── Mentions pressed ─────────────────────────────────────────────────────────

function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const invoice = target?.closest?.(".invoice-mention") as HTMLElement | null;
  const person = invoice ? null : (target?.closest?.(".mention") as HTMLElement | null);
  const chip = invoice ?? person;
  if (!chip || chip.dataset.deleted === "true") return;
  const id = invoice ? chip.dataset.invoiceId : chip.dataset.mentionId;
  if (id) send({ type: "mentionPress", kind: invoice ? "invoice" : "person", id });
}

// ── Commands from the native side ────────────────────────────────────────────

/**
 * Types the trigger character where the cursor is. The suggestion only opens
 * after a space or at the start of a line, as on the web, so one is added
 * when the cursor sits right after a word.
 */
function trigger(kind: MentionKind) {
  if (!editor) return;
  const char = kind === "person" ? "@" : "#";
  const { $from } = editor.state.selection;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, "\n", "￼");
  const needsSpace = before !== "" && !/\s/.test(before);
  editor.chain().focus().insertContent(needsSpace ? ` ${char}` : char).run();
}

function create(message: Extract<ToPage, { type: "init" }>) {
  docKey = message.docKey;
  placeholder = message.placeholder;
  labels = { person: toMap(message.people), invoice: toMap(message.invoices) };
  document.documentElement.classList.toggle("dark", message.dark);

  const mount = document.getElementById("editor");
  if (!mount) return;
  editor = new Editor({
    element: mount,
    extensions: pageExtensions({
      placeholder: () => placeholder,
      person: suggestionUi("person"),
      invoice: suggestionUi("invoice"),
    }),
    content: message.html,
    editable: message.editable,
    editorProps: {
      attributes: { class: "tiptap", autocapitalize: "sentences", spellcheck: "true" },
      // Keep the caret clear of the toolbar and the screen's edge.
      scrollMargin: 48,
      scrollThreshold: 48,
    },
    onUpdate: queueChange,
    onTransaction: ({ transaction }) => {
      if (transaction.docChanged) {
        for (const letter of letters) letter.pos = transaction.mapping.map(letter.pos, -1);
      }
      reportState();
    },
    onFocus: reportState,
    onBlur: reportState,
  });
  editor.view.dom.addEventListener("click", onClick);
  trackTyping(editor.view);
  syncLabels();
  if (message.autoFocus) {
    if (!editor.isEditable) editor.setEditable(true, false);
    editor.commands.focus("end");
  }
  reportState();
}

function handle(message: ToPage) {
  if (message.type === "init") {
    if (!editor) create(message);
    return;
  }
  if (!editor) return;
  switch (message.type) {
    case "load":
      settleComposition();
      flushChange();
      docKey = message.docKey;
      // Not an edit: replacing the document must not come back as a change.
      editor.commands.setContent(message.html, { emitUpdate: false });
      letters = [];
      syncLabels();
      reportState();
      break;
    case "editable":
      // `false`: switching read-only is not an edit.
      if (editor.isEditable !== message.editable) {
        editor.setEditable(message.editable, false);
        if (!message.editable) editor.commands.blur();
      }
      break;
    case "placeholder":
      placeholder = message.placeholder;
      // Placeholder decorations are recomputed on the next transaction.
      editor.view.dispatch(editor.state.tr);
      break;
    case "theme":
      document.documentElement.classList.toggle("dark", message.dark);
      break;
    case "mentionLabels":
      labels = { person: toMap(message.people), invoice: toMap(message.invoices) };
      // Not worth interrupting a word for: applied when the keyboard commits it.
      if (editor.view.composing) labelsPending = true;
      else syncLabels();
      break;
    case "format":
      if (editor.isEditable) format(message.action, message.at);
      break;
    case "trigger":
      if (editor.isEditable) {
        settleComposition();
        trigger(message.kind);
      }
      break;
    case "pick":
      settleComposition();
      openSuggestion[message.kind]?.({ id: message.id, label: message.label });
      break;
    case "focus":
      if (editor.isEditable) {
        settleComposition();
        editor.commands.focus("end");
      }
      break;
    case "blur":
      editor.commands.blur();
      break;
  }
}

function onMessage(event: Event) {
  const message = parseToPage((event as MessageEvent).data);
  if (message) handle(message);
}

// The native side resizes the page as the keyboard, the toolbar and the @/#
// list come and go. The caret has to stay in sight through that.
window.addEventListener("resize", () => {
  if (editor?.isFocused) editor.commands.scrollIntoView();
});

// The page never navigates: the only document it may show is itself. Links in
// a note are inert here — the web opens them, this page has nowhere to. TipTap
// opens a clicked link with window.open, and a read-only link would follow
// its href; neither can. (The native side also refuses every navigation.)
window.open = () => null;
document.addEventListener(
  "click",
  (event) => {
    if ((event.target as Element | null)?.closest?.("a")) event.preventDefault();
  },
  true
);

// Android's WebView delivers the native side's messages on `document`, iOS's
// on `window`.
document.addEventListener("message", onMessage);
window.addEventListener("message", onMessage);

send({ type: "ready" });
