import { StyleSheet, Text, View } from "react-native";
import { CloudOff, TriangleAlert } from "lucide-react-native";
import { fetchedLabel } from "@/lib/format";
import { font, usePalette } from "@/lib/theme";

/**
 * How current a business screen is: "Updated 5m ago", or — when that is not
 * the live picture — "Offline · Updated 2h ago" or "Couldn't refresh ·
 * Updated 2h ago". Screens that work offline show the time with the numbers,
 * so a stale figure is never mistaken for today's.
 */
export function Freshness({
  fetchedAt,
  online,
  error,
  now,
}: {
  fetchedAt: string | null;
  online: boolean;
  error: string | null;
  now: Date;
}) {
  const c = usePalette();
  if (!fetchedAt) return null;
  const when = fetchedLabel(fetchedAt, now);
  if (!online) {
    return (
      <View style={styles.row} testID="freshness-offline">
        <CloudOff size={13} color={c.soon} />
        <Text style={[styles.text, { color: c.soon }]}>Offline · {when}</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.row} testID="freshness-error">
        <TriangleAlert size={13} color={c.danger} />
        <Text style={[styles.text, { color: c.danger }]} numberOfLines={1}>
          Couldn&apos;t refresh · {when}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.row} testID="freshness">
      <Text style={[styles.text, { color: c.faint }]}>{when}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 18, paddingBottom: 8 },
  text: { fontFamily: font.medium, fontSize: 12 },
});
