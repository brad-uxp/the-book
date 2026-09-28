import { useCallback, useEffect, useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RichTextEditor, type MentionInvoice, type MentionPerson } from "@/editor/RichTextEditor";
import { font, usePalette } from "@/lib/theme";

/**
 * An idea, open for writing: a tall bottom sheet with the note's editor — the
 * same formatting and @/# mentions — as the prototype has it. Writing never
 * happens inside a card: zoom and the keyboard make that unusable on a phone.
 *
 * Saves as it is typed (the editor hands its HTML over within 300 ms, and
 * whatever is pending when it closes). Done, the system back, or tapping
 * above the sheet closes it.
 */
export function IdeaSheet({
  idea,
  people,
  invoices,
  onSave,
  onClose,
  onMentionPress,
}: {
  /** The idea being written, with the text it opened with; null when closed. */
  idea: { id: string; html: string; isNew: boolean } | null;
  people: MentionPerson[];
  invoices: MentionInvoice[];
  /** A new text for the idea, with the text this change started from. */
  onSave: (id: string, html: string, previous: string) => void;
  onClose: (id: string) => void;
  onMentionPress: (m: { kind: "person" | "invoice"; id: string }) => void;
}) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  // What the last save wrote: the base the next one is judged against.
  const saved = useRef<{ id: string; html: string } | null>(null);
  const ideaId = idea?.id ?? null;
  const ideaHtml = idea?.html ?? "";
  useEffect(() => {
    // Only when another idea opens: the editor's own saves update it below.
    saved.current = ideaId ? { id: ideaId, html: ideaHtml } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideaId]);

  const onChange = useCallback(
    (html: string) => {
      const s = saved.current;
      if (!s || s.html === html) return;
      onSave(s.id, html, s.html);
      saved.current = { id: s.id, html };
    },
    [onSave]
  );

  const close = () => {
    if (idea) onClose(idea.id);
  };

  return (
    <Modal visible={idea !== null} transparent animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: c.bg, paddingBottom: insets.bottom }]} testID="idea-sheet">
        <View style={[styles.grab, { backgroundColor: c.line }]} />
        <View style={styles.bar}>
          <Text style={[styles.title, { color: c.ink }]}>{idea?.isNew ? "New idea" : "Idea"}</Text>
          <Pressable onPress={close} hitSlop={8} style={[styles.done, { backgroundColor: c.primary }]} accessibilityRole="button" testID="idea-done">
            <Text style={[styles.doneText, { color: c.onPrimary }]}>Done</Text>
          </Pressable>
        </View>
        {idea ? (
          <View style={styles.body}>
            <RichTextEditor
              docKey={idea.id}
              initialHtml={idea.html}
              onChange={onChange}
              autoFocus
              placeholder="Write an idea…"
              people={people}
              invoices={invoices}
              onMentionPress={onMentionPress}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.38)" },
  sheet: { height: "88%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, overflow: "hidden" },
  grab: { width: 38, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: 6 },
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingBottom: 4 },
  title: { flex: 1, fontFamily: font.semibold, fontSize: 16 },
  done: { height: 34, paddingHorizontal: 14, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  doneText: { fontFamily: font.semibold, fontSize: 14 },
  body: { flex: 1 },
});
