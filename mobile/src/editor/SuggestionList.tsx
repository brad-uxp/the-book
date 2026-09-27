import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { FileText, User } from "lucide-react-native";
import { font, usePalette } from "@/lib/theme";
import type { MentionKind } from "./protocol";

export interface SuggestionItem {
  id: string;
  /** What the mention will say — and what is inserted. */
  label: string;
  detail?: string | null;
}

/**
 * The @ or # list, drawn natively above the toolbar while a mention is being
 * typed. Choosing an item inserts it; typing on narrows it.
 */
export function SuggestionList({
  kind,
  items,
  onPick,
}: {
  kind: MentionKind;
  items: SuggestionItem[];
  onPick: (item: SuggestionItem) => void;
}) {
  const c = usePalette();
  const Icon = kind === "person" ? User : FileText;
  return (
    <View style={[styles.panel, { backgroundColor: c.raised, borderTopColor: c.line }]}>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.scroll}>
        {items.length === 0 ? (
          <Text style={[styles.empty, { color: c.muted }]}>
            {kind === "person" ? "No one by that name" : "No invoice matches"}
          </Text>
        ) : (
          items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surface }]}
            >
              <Icon size={18} color={c.muted} />
              <View style={styles.text}>
                <Text numberOfLines={1} style={[styles.label, { color: c.ink }]}>
                  {item.label}
                </Text>
                {item.detail ? (
                  <Text numberOfLines={1} style={[styles.detail, { color: c.muted }]}>
                    {item.detail}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderTopWidth: StyleSheet.hairlineWidth },
  // About four rows; the rest scrolls.
  scroll: { maxHeight: 208 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  text: { flex: 1 },
  label: { fontFamily: font.medium, fontSize: 15 },
  detail: { fontFamily: font.regular, fontSize: 13, marginTop: 1 },
  empty: { fontFamily: font.regular, fontSize: 14, paddingHorizontal: 16, paddingVertical: 16 },
});
