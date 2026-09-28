import type { AnyExtension } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import type { SuggestionOptions } from "@tiptap/suggestion";

/**
 * The schema of every note's rich text, for both editors that write it: the
 * web's, and the phone's — TipTap on a page inside a WebView, bundled from
 * mobile/editor-web by mobile/scripts/build-editor.mjs.
 *
 * The stored HTML is the contract between them. A note written on one has to
 * open, and save, byte for byte the same on the other, so everything that
 * shapes that HTML lives here and nowhere else: the extensions, the mention
 * markup, the trigger characters (a mention stores the one it was typed with).
 * What each editor draws on top — suggestion lists, toolbars — is UI and stays
 * with it. No React and no DOM here beyond what TipTap itself needs.
 */

/**
 * A mention keeps the label it was typed with. When the person or the invoice
 * it points at is gone, the chip is marked instead of removed — the text
 * around it was written with it in mind, and silently deleting a word from
 * someone's note is worse than showing it struck through.
 */
const deletedAttribute = {
  deleted: {
    default: false,
    parseHTML: (element: HTMLElement) =>
      element.getAttribute("data-deleted") === "true",
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.deleted ? { "data-deleted": "true" } : {},
  },
};

export const PersonMention = Mention.extend({
  addAttributes() {
    return { ...this.parent?.(), ...deletedAttribute };
  },
});

export const InvoiceMention = Mention.extend({
  name: "invoiceMention",
  addAttributes() {
    return { ...this.parent?.(), ...deletedAttribute };
  },
});

/** The node names the two mentions have in a document. */
export const MENTION_NODE = {
  person: "mention",
  invoice: "invoiceMention",
} as const;

/** What an editor decides about a suggestion list: what it offers, and how it draws it. */
export type MentionSuggestionUi<T> = Pick<SuggestionOptions<T>, "items" | "render">;

export interface RichTextExtensionOptions {
  /** A function when it can change after the editor is built. */
  placeholder: string | (() => string);
  // `any`: each editor offers its own item shape, and TipTap's suggestion
  // types are invariant in it.
  personSuggestion?: MentionSuggestionUi<any>;
  invoiceSuggestion?: MentionSuggestionUi<any>;
}

export function richTextExtensions({
  placeholder,
  personSuggestion,
  invoiceSuggestion,
}: RichTextExtensionOptions): AnyExtension[] {
  return [
    StarterKit,
    // One fixed colour, so a highlight is a bare <mark> — the colour lives in
    // each editor's CSS (a pastel amber), not in the stored HTML. ⌘⇧H.
    Highlight.configure({ multicolor: false }),
    Placeholder.configure({
      placeholder: typeof placeholder === "function" ? () => placeholder() : placeholder,
    }),
    PersonMention.configure({
      HTMLAttributes: { class: "mention" },
      suggestion: { ...personSuggestion, char: "@", allowSpaces: false },
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
      HTMLAttributes: { class: "invoice-mention" },
      suggestion: { ...invoiceSuggestion, char: "#", allowSpaces: false },
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
  ];
}
