import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Download, X } from "lucide-react-native";
import { font, usePalette } from "@/lib/theme";
import { formatSize } from "./rules";
import { useUpdate } from "./UpdateProvider";

/**
 * "Update available" at the top of the notes list: the version, its notes,
 * and one button that walks download → install. Hidden with × until the next
 * start; the account menu can always check again.
 */
export function UpdateBanner() {
  const { state, dismissed, download, install, dismiss } = useUpdate();
  const c = usePalette();
  if (state.status === "idle" || (dismissed && state.status === "available")) return null;

  const { release } = state;
  const title =
    state.status === "ready"
      ? `book. ${release.version} is ready to install`
      : state.status === "downloading"
        ? `Downloading ${release.version}… ${Math.round(state.progress * 100)}%`
        : `Update available: ${release.version}`;
  const body =
    state.status === "failed"
      ? state.message
      : state.status === "ready"
        ? "Android will ask you to confirm."
        : release.notes || `${formatSize(release.size_bytes)} download.`;

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]} testID="update-banner">
      <View style={styles.text}>
        <Text style={[styles.title, { color: c.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.body, { color: c.muted }]} numberOfLines={2}>
          {body}
        </Text>
        {state.status === "downloading" ? (
          <View style={[styles.track, { backgroundColor: c.line }]}>
            <View style={[styles.bar, { backgroundColor: c.accent, width: `${Math.round(state.progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      {state.status === "downloading" ? (
        <ActivityIndicator color={c.accent} />
      ) : (
        <Pressable
          testID="update-action"
          accessibilityRole="button"
          onPress={state.status === "ready" ? install : () => void download()}
          style={[styles.button, { backgroundColor: c.primary }]}
        >
          <Download size={16} color={c.onPrimary} />
          <Text style={[styles.buttonText, { color: c.onPrimary }]}>
            {state.status === "ready" ? "Install" : state.status === "failed" ? "Retry" : "Download"}
          </Text>
        </Pressable>
      )}
      {state.status === "available" ? (
        <Pressable accessibilityLabel="Hide" hitSlop={10} onPress={dismiss} testID="update-dismiss">
          <X size={16} color={c.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: font.semibold, fontSize: 14 },
  body: { fontFamily: font.regular, fontSize: 13 },
  track: { height: 3, borderRadius: 2, marginTop: 6, overflow: "hidden" },
  bar: { height: 3 },
  button: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 9 },
  buttonText: { fontFamily: font.semibold, fontSize: 13 },
});
