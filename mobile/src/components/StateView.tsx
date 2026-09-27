import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { font, usePalette } from "@/lib/theme";

/** A centred message for loading, errors and empty lists — one layout for all three. */
export function StateView({
  title,
  body,
  loading,
  action,
}: {
  title?: string;
  body?: string;
  loading?: boolean;
  action?: { label: string; onPress: () => void };
}) {
  const c = usePalette();
  return (
    <View style={styles.wrap}>
      {loading ? <ActivityIndicator color={c.muted} /> : null}
      {title ? <Text style={[styles.title, { color: c.ink }]}>{title}</Text> : null}
      {body ? <Text style={[styles.body, { color: c.muted }]}>{body}</Text> : null}
      {action ? (
        <Pressable onPress={action.onPress} style={[styles.button, { borderColor: c.line }]} accessibilityRole="button">
          <Text style={[styles.buttonText, { color: c.ink }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  title: { fontFamily: font.semibold, fontSize: 16, textAlign: "center" },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 300 },
  button: { marginTop: 8, height: 40, paddingHorizontal: 18, borderRadius: 11, borderWidth: 1, justifyContent: "center" },
  buttonText: { fontFamily: font.semibold, fontSize: 14 },
});
