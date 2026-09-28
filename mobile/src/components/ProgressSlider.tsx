import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { font, statusColor, usePalette } from "@/lib/theme";

const STEP = 5;

/**
 * A task's progress, 0–100 in steps of 5: drag or tap along the track. The
 * value is saved when the finger lifts, not on every step of the drag.
 */
export function ProgressSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const c = usePalette();
  const [live, setLive] = useState(value);
  // A new value from the note (the sync, or Undo) replaces the one shown.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setLive(value);
  }

  const width = useRef(0);
  const current = useRef(value);
  const commit = useRef(onChange);
  useEffect(() => {
    commit.current = onChange;
  });

  const at = (x: number) => {
    const ratio = width.current > 0 ? Math.min(1, Math.max(0, x / width.current)) : 0;
    return Math.round((ratio * 100) / STEP) * STEP;
  };
  const track = (e: GestureResponderEvent) => {
    current.current = at(e.nativeEvent.locationX);
    setLive(current.current);
  };

  return (
    <View style={styles.row}>
      <View
        style={styles.hit}
        onLayout={(e: LayoutChangeEvent) => (width.current = e.nativeEvent.layout.width)}
        accessibilityRole="adjustable"
        accessibilityLabel="Progress"
        accessibilityValue={{ min: 0, max: 100, now: live }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          const next = Math.min(100, Math.max(0, live + (e.nativeEvent.actionName === "increment" ? 10 : -10)));
          setLive(next);
          commit.current(next);
        }}
        testID="progress-slider"
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={track}
        onResponderMove={track}
        onResponderRelease={() => commit.current(current.current)}
      >
        <View pointerEvents="none" style={[styles.track, { backgroundColor: c.surface }]}>
          <View style={[styles.fill, { width: `${live}%`, backgroundColor: statusColor.in_progress }]} />
        </View>
        <View
          pointerEvents="none"
          style={[styles.thumb, { left: `${live}%`, backgroundColor: c.bg, borderColor: statusColor.in_progress }]}
        />
      </View>
      <Text style={[styles.value, { color: c.ink }]}>{live}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  hit: { flex: 1, height: 36, justifyContent: "center" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%" },
  thumb: { position: "absolute", width: 20, height: 20, borderRadius: 10, borderWidth: 2, marginLeft: -10, top: 8 },
  value: { fontFamily: font.semibold, fontSize: 13, width: 40, textAlign: "right", fontVariant: ["tabular-nums"] },
});
