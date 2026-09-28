import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { font, usePalette } from "@/lib/theme";

/** A row of chips, one chosen — the same look as the notes filters. */
export function Segments<K extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (key: K) => void;
  testIDPrefix?: string;
}) {
  const c = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map(({ key, label, count }) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            testID={testIDPrefix ? `${testIDPrefix}-${key}` : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.chip, { borderColor: on ? c.primary : c.line, backgroundColor: on ? c.primary : "transparent" }]}
          >
            <Text style={[styles.label, { color: on ? c.onPrimary : c.muted }]}>
              {label}
              {count !== undefined ? <Text style={styles.count}> {count}</Text> : null}
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
