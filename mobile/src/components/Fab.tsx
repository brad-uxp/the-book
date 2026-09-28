import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Plus, SquareCheck, StickyNote, Waypoints } from "lucide-react-native";
import { font, usePalette } from "@/lib/theme";

/**
 * The + of the notes list. A tap makes a text note straight away; holding it
 * (≈0.4 s, with a buzz) offers the other kinds. Canvas is shown but not yet
 * offered: drawing one on the phone arrives with the canvas itself.
 */
export function Fab({ onCreate }: { onCreate: (kind: "note" | "task") => void }) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);

  const pick = (kind: "note" | "task") => {
    setMenu(false);
    onCreate(kind);
  };

  return (
    <>
      <Pressable
        testID="fab"
        accessibilityRole="button"
        accessibilityLabel="New note"
        accessibilityHint="Hold for more kinds"
        onPress={() => onCreate("note")}
        onLongPress={() => {
          Vibration.vibrate(12);
          setMenu(true);
        }}
        delayLongPress={400}
        style={({ pressed }) => [styles.fab, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
      >
        <Plus size={24} color={c.onPrimary} strokeWidth={2.2} />
      </Pressable>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)} statusBarTranslucent navigationBarTranslucent>
        <Pressable style={styles.scrim} onPress={() => setMenu(false)} accessibilityLabel="Close" />
        <View style={[styles.menu, { bottom: insets.bottom + 56 + 18 + 72 }]}>
          <View style={[styles.item, { backgroundColor: c.surface, borderColor: c.line }]} accessibilityState={{ disabled: true }}>
            <Waypoints size={18} color={c.faint} />
            <Text style={[styles.itemText, { color: c.faint }]}>Canvas</Text>
            <Text style={[styles.soon, { color: c.faint }]}>Arrives soon</Text>
          </View>
          <MenuItem label="Task" icon={<SquareCheck size={18} color={c.ink} />} onPress={() => pick("task")} testID="fab-task" />
          <MenuItem label="Note" icon={<StickyNote size={18} color={c.ink} />} onPress={() => pick("note")} testID="fab-note" />
        </View>
      </Modal>
    </>
  );
}

function MenuItem({ label, icon, onPress, testID }: { label: string; icon: React.ReactNode; onPress: () => void; testID: string }) {
  const c = usePalette();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.item, { backgroundColor: pressed ? c.surface : c.raised, borderColor: c.line }]}
    >
      {icon}
      <Text style={[styles.itemText, { color: c.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 18,
    bottom: 18,
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.38)" },
  menu: { position: "absolute", right: 18, gap: 8, alignItems: "flex-end" },
  item: { flexDirection: "row", alignItems: "center", gap: 10, height: 44, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, elevation: 4 },
  itemText: { fontFamily: font.semibold, fontSize: 15 },
  soon: { fontFamily: font.medium, fontSize: 12 },
});
