import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import type { Filter } from "@/lib/issues";
import { font, usePalette } from "@/lib/theme";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "note", label: "Notes" },
  { key: "canvas", label: "Canvas" },
  { key: "task", label: "Tasks" },
];

export function FilterChips({
  value,
  counts,
  onChange,
}: {
  value: Filter;
  counts: Record<Filter, number>;
  onChange: (f: Filter) => void;
}) {
  const c = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {FILTERS.map(({ key, label }) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[
              styles.chip,
              { borderColor: on ? c.primary : c.line, backgroundColor: on ? c.primary : "transparent" },
            ]}
          >
            <Text style={[styles.label, { color: on ? c.onPrimary : c.muted }]}>
              {label} <Text style={styles.count}>{counts[key]}</Text>
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  chip: { height: 32, paddingHorizontal: 13, borderRadius: 16, borderWidth: 1, justifyContent: "center" },
  label: { fontFamily: font.semibold, fontSize: 13 },
  count: { fontFamily: font.regular, opacity: 0.7 },
});
