import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { handlePush, PUSH_TASK } from "@/push/task";
import { font, usePalette } from "@/lib/theme";

/**
 * Development only: `book://dev/push`. Runs the push task's own handler with
 * a payload typed here — the same code a real FCM message reaches — so the
 * fetch from the API, the local notification and the tap routing can be
 * checked on an emulator, where a real push would need the production key.
 * Release builds redirect home.
 */
function Button({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const c = usePalette();
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.button, { backgroundColor: c.surface, borderColor: c.line }]}>
      <Text style={{ color: c.ink, fontFamily: font.medium }}>{label}</Text>
    </Pressable>
  );
}

export default function DevPush() {
  const c = usePalette();
  const [id, setId] = useState("");
  const [log, setLog] = useState<string[]>([]);
  if (!__DEV__) return <Redirect href="/" />;

  const note = (line: string) => setLog((l) => [`${new Date().toISOString().slice(11, 19)} ${line}`, ...l].slice(0, 12));

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      note(`${label}: ${JSON.stringify(await fn())}`);
    } catch (err) {
      note(`${label}: error ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <Text style={{ color: c.ink, fontFamily: font.bold, fontSize: 22 }}>Push lab</Text>
      <TextInput
        testID="push-id"
        value={id}
        onChangeText={setId}
        placeholder="Notification id"
        placeholderTextColor={c.faint}
        autoCapitalize="none"
        style={[styles.input, { color: c.ink, borderColor: c.line }]}
      />
      <View style={styles.row}>
        <Button testID="push-notification" label="Simulate notification push" onPress={() => void run("notification", () => handlePush({ kind: "notification", id: id.trim() }))} />
        <Button testID="push-test" label="Simulate test push" onPress={() => void run("test", () => handlePush({ kind: "test" }))} />
        <Button
          testID="push-perm"
          label="Permission status"
          onPress={() => void run("permission", async () => (await Notifications.getPermissionsAsync()).status)}
        />
        <Button
          testID="push-task"
          label="Background task registered?"
          onPress={() => void run("task", () => TaskManager.isTaskRegisteredAsync(PUSH_TASK))}
        />
        <Button
          testID="push-token"
          label="FCM token (length)"
          onPress={() => void run("token", async () => (await Notifications.getDevicePushTokenAsync()).data.length)}
        />
      </View>
      {log.map((l, i) => (
        <Text key={i} style={{ color: c.muted, fontSize: 12 }} testID={`push-log-${i}`}>
          {l}
        </Text>
      ))}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  row: { gap: 8 },
  button: { borderWidth: 1, borderRadius: 10, padding: 12 },
});
