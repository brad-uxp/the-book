import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from "react-native";
import { Cloud, CloudAlert, CloudOff } from "lucide-react-native";
import { useSync } from "@/sync/SyncProvider";
import { syncSummary } from "@/sync/status";
import { font, usePalette } from "@/lib/theme";

/**
 * How the phone stands with the server, in the header: nothing when all is
 * synced, a spinner while syncing, a crossed cloud offline, and how many
 * changes are waiting. A tap says it in words.
 */
export function SyncBadge() {
  const { status, pending } = useSync();
  const c = usePalette();

  const failing = !!status.error && status.online;
  const quiet = status.online && !status.syncing && !failing && pending === 0;

  return (
    <Pressable
      testID="sync-badge"
      accessibilityRole="button"
      accessibilityLabel={syncSummary(status, pending, new Date())}
      hitSlop={8}
      onPress={() => Alert.alert("Sync", syncSummary(status, pending, new Date()))}
      style={[styles.badge, quiet && styles.quiet]}
    >
      {status.syncing ? (
        <ActivityIndicator size="small" color={c.muted} />
      ) : !status.online ? (
        <CloudOff size={20} color={c.muted} />
      ) : failing ? (
        <CloudAlert size={20} color={c.soon} />
      ) : (
        <Cloud size={20} color={quiet ? c.faint : c.muted} />
      )}
      {pending > 0 ? <Text style={[styles.count, { color: c.muted }]}>{pending}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: 14, minWidth: 24, height: 28, justifyContent: "center" },
  quiet: { opacity: 0.8 },
  count: { fontFamily: font.semibold, fontSize: 13 },
});
