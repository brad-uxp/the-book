import { StyleSheet, Text, View } from "react-native";
import { font, usePalette } from "@/lib/theme";

/** A tab whose content arrives in a later phase: says what, honestly. */
export function Upcoming({ title, items, when }: { title: string; items: string[]; when: string }) {
  const c = usePalette();
  return (
    <View style={[styles.wrap, { backgroundColor: c.bg }]}>
      <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
      <View style={styles.list}>
        {items.map((item) => (
          <Text key={item} style={[styles.item, { color: c.muted }]}>
            · {item}
          </Text>
        ))}
      </View>
      <Text style={[styles.when, { color: c.faint }]}>{when}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: "center", gap: 12 },
  title: { fontFamily: font.bold, fontSize: 18 },
  list: { gap: 4 },
  item: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  when: { fontFamily: font.medium, fontSize: 13 },
});
