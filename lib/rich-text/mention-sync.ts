import type { EditorState, Transaction } from "@tiptap/pm/state";
// Relative, not "@/lib/…": this file is also bundled into the phone's editor,
// where "@/" means something else.
import { deletedMentionLabel } from "../mentions";

/**
 * Brings every mention of one kind in line with what it points at: the
 * current label when the person or invoice exists, the " (deleted)" mark when
 * it does not — and an older " (eliminado)" brought to the current suffix.
 *
 * `labelFor` answers with the label a mention of `id` should carry now, or
 * null when there is no such entity. Only call this with the complete list:
 * an entity missing because the list has not loaded yet would be marked
 * deleted, and that is saved.
 *
 * Returns the transaction to dispatch, or null when nothing needs to change.
 */
export function syncMentionLabels(
  state: EditorState,
  nodeName: string,
  labelFor: (id: string) => string | null
): Transaction | null {
  const tr = state.tr;
  let changed = false;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== nodeName) return;
    const label = labelFor(node.attrs.id);
    if (label !== null) {
      if (node.attrs.label !== label || node.attrs.deleted) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, label, deleted: false });
        changed = true;
      }
    } else {
      const deletedLabel = deletedMentionLabel(node.attrs.label);
      if (!node.attrs.deleted || node.attrs.label !== deletedLabel) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: deletedLabel, deleted: true });
        changed = true;
      }
    }
  });
  return changed ? tr : null;
}
