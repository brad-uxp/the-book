import { useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  AtSign,
  Bold,
  Code,
  Hash,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  Italic,
  KeyboardOff,
  List,
  ListOrdered,
  Type,
  type LucideIcon,
} from "lucide-react-native";
import { usePalette } from "@/lib/theme";
import type { ActiveFormats, MentionKind, ToolbarAction } from "./protocol";
import { pressedAtEpoch } from "./typing";

/** The web's toolbar, in the web's order. */
const FORMATS: { action: ToolbarAction; icon: LucideIcon; label: string }[] = [
  { action: "bold", icon: Bold, label: "Bold" },
  { action: "italic", icon: Italic, label: "Italic" },
  { action: "highlight", icon: Highlighter, label: "Highlight" },
  { action: "paragraph", icon: Type, label: "Paragraph" },
  { action: "h2", icon: Heading2, label: "Heading 2" },
  { action: "h3", icon: Heading3, label: "Heading 3" },
  { action: "h4", icon: Heading4, label: "Heading 4" },
  { action: "bulletList", icon: List, label: "Bullet list" },
  { action: "orderedList", icon: ListOrdered, label: "Ordered list" },
  { action: "codeBlock", icon: Code, label: "Code block" },
];

const MENTIONS: { kind: MentionKind; icon: LucideIcon; label: string }[] = [
  { kind: "person", icon: AtSign, label: "Mention a person" },
  { kind: "invoice", icon: Hash, label: "Mention an invoice" },
];

/**
 * The formatting bar pinned above the keyboard. Its buttons never take focus
 * from the editor, so the keyboard stays up while formatting.
 */
export function EditorToolbar({
  active,
  onFormat,
  onMention,
  onHideKeyboard,
}: {
  active: ActiveFormats;
  /** `pressedAt`: when the button was touched — see pressedAtEpoch. */
  onFormat: (action: ToolbarAction, pressedAt: number) => void;
  onMention: (kind: MentionKind) => void;
  onHideKeyboard: () => void;
}) {
  const c = usePalette();
  /** When the button being pressed was touched: the next letters may reach the page first. */
  const pressedAt = useRef<number | null>(null);
  return (
    <View style={[styles.bar, { backgroundColor: c.bg, borderTopColor: c.line }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.buttons}
      >
        {FORMATS.map(({ action, icon: Icon, label }) => (
          <Pressable
            key={action}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: active[action] }}
            onPressIn={(e) => {
              pressedAt.current = pressedAtEpoch(e.nativeEvent.timestamp, performance.now(), Date.now());
            }}
            onPress={() => onFormat(action, pressedAt.current ?? Date.now())}
            style={({ pressed }) => [
              styles.button,
              (active[action] || pressed) && { backgroundColor: c.surface },
            ]}
          >
            <Icon size={20} color={active[action] ? c.ink : c.muted} strokeWidth={active[action] ? 2.4 : 2} />
          </Pressable>
        ))}
        <View style={[styles.divider, { backgroundColor: c.line }]} />
        {MENTIONS.map(({ kind, icon: Icon, label }) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => onMention(kind)}
            style={({ pressed }) => [styles.button, pressed && { backgroundColor: c.surface }]}
          >
            <Icon size={20} color={c.muted} />
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hide keyboard"
        onPress={onHideKeyboard}
        style={({ pressed }) => [
          styles.button,
          styles.hide,
          { borderLeftColor: c.line },
          pressed && { backgroundColor: c.surface },
        ]}
      >
        <KeyboardOff size={20} color={c.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  buttons: { alignItems: "center", paddingHorizontal: 6, gap: 2 },
  button: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: 6 },
  hide: {
    width: 52,
    height: 48,
    borderRadius: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
});
