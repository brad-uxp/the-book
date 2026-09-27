import Mention from "@tiptap/extension-mention";

/**
 * The two mention nodes the editor knows, each with a `deleted` flag.
 *
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
