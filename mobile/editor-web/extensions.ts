import type { AnyExtension } from "@tiptap/core";
import { richTextExtensions, type MentionSuggestionUi } from "../../lib/rich-text/extensions";

/**
 * The page's extensions: the web's, through the same shared factory, with the
 * suggestion lists handed to the native side instead of drawn here.
 *
 * Its own module so the web's parity test (lib/rich-text/extensions.test.ts)
 * can build exactly what the page builds.
 */
export function pageExtensions(ui: {
  placeholder: () => string;
  person: MentionSuggestionUi<any>;
  invoice: MentionSuggestionUi<any>;
}): AnyExtension[] {
  return richTextExtensions({
    placeholder: ui.placeholder,
    personSuggestion: ui.person,
    invoiceSuggestion: ui.invoice,
  });
}
