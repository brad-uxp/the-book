/**
 * The messages between the editor page (TipTap inside the WebView, built from
 * editor-web/) and RichTextEditor on the native side.
 *
 * Everything crosses as JSON through postMessage, in both directions — never
 * as JavaScript assembled from strings — and each side parses what it gets
 * with the functions below and drops anything that does not fit. Pure and
 * dependency-free: it is compiled into the page and into the app alike.
 */

export type MentionKind = "person" | "invoice";

export const TOOLBAR_ACTIONS = [
  "bold",
  "italic",
  "highlight",
  "paragraph",
  "h2",
  "h3",
  "h4",
  "bulletList",
  "orderedList",
  "codeBlock",
] as const;

export type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];

export type ActiveFormats = Record<ToolbarAction, boolean>;

/**
 * id → the label a mention of it should carry. Empty means "not known yet",
 * never "all of them were deleted".
 */
export type MentionLabels = [id: string, label: string][];

/** Native → page. */
export type ToPage =
  | {
      type: "init";
      docKey: string;
      html: string;
      editable: boolean;
      placeholder: string;
      autoFocus: boolean;
      dark: boolean;
      people: MentionLabels;
      invoices: MentionLabels;
    }
  | { type: "load"; docKey: string; html: string }
  | { type: "editable"; editable: boolean }
  | { type: "placeholder"; placeholder: string }
  | { type: "theme"; dark: boolean }
  | { type: "mentionLabels"; people: MentionLabels; invoices: MentionLabels }
  | { type: "format"; action: ToolbarAction }
  | { type: "trigger"; kind: MentionKind }
  | { type: "pick"; kind: MentionKind; id: string; label: string }
  | { type: "focus" }
  | { type: "blur" };

/** Page → native. */
export type FromPage =
  | { type: "ready" }
  | { type: "change"; docKey: string; html: string }
  | { type: "state"; focused: boolean; active: ActiveFormats }
  | { type: "suggestion"; kind: MentionKind; query: string }
  | { type: "suggestionEnd" }
  | { type: "mentionPress"; kind: MentionKind; id: string };

type Obj = Record<string, unknown>;

function parseObject(raw: unknown): Obj | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
  } catch {
    return null;
  }
}

const isString = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isKind = (v: unknown): v is MentionKind => v === "person" || v === "invoice";
const isAction = (v: unknown): v is ToolbarAction =>
  (TOOLBAR_ACTIONS as readonly unknown[]).includes(v);

function isLabels(v: unknown): v is MentionLabels {
  return (
    Array.isArray(v) &&
    v.every((pair) => Array.isArray(pair) && pair.length === 2 && isString(pair[0]) && isString(pair[1]))
  );
}

function isActive(v: unknown): v is ActiveFormats {
  if (!v || typeof v !== "object") return false;
  return TOOLBAR_ACTIONS.every((a) => isBool((v as Obj)[a]));
}

export function parseToPage(raw: unknown): ToPage | null {
  const m = parseObject(raw);
  if (!m) return null;
  switch (m.type) {
    case "init":
      return isString(m.docKey) &&
        isString(m.html) &&
        isBool(m.editable) &&
        isString(m.placeholder) &&
        isBool(m.autoFocus) &&
        isBool(m.dark) &&
        isLabels(m.people) &&
        isLabels(m.invoices)
        ? (m as ToPage)
        : null;
    case "load":
      return isString(m.docKey) && isString(m.html) ? (m as ToPage) : null;
    case "editable":
      return isBool(m.editable) ? (m as ToPage) : null;
    case "placeholder":
      return isString(m.placeholder) ? (m as ToPage) : null;
    case "theme":
      return isBool(m.dark) ? (m as ToPage) : null;
    case "mentionLabels":
      return isLabels(m.people) && isLabels(m.invoices) ? (m as ToPage) : null;
    case "format":
      return isAction(m.action) ? (m as ToPage) : null;
    case "trigger":
      return isKind(m.kind) ? (m as ToPage) : null;
    case "pick":
      return isKind(m.kind) && isString(m.id) && isString(m.label) ? (m as ToPage) : null;
    case "focus":
    case "blur":
      return m as ToPage;
    default:
      return null;
  }
}

export function parseFromPage(raw: unknown): FromPage | null {
  const m = parseObject(raw);
  if (!m) return null;
  switch (m.type) {
    case "ready":
    case "suggestionEnd":
      return m as FromPage;
    case "change":
      return isString(m.docKey) && isString(m.html) ? (m as FromPage) : null;
    case "state":
      return isBool(m.focused) && isActive(m.active) ? (m as FromPage) : null;
    case "suggestion":
      return isKind(m.kind) && isString(m.query) ? (m as FromPage) : null;
    case "mentionPress":
      return isKind(m.kind) && isString(m.id) ? (m as FromPage) : null;
    default:
      return null;
  }
}
