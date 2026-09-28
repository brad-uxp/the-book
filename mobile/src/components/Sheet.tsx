import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { font, usePalette } from "@/lib/theme";

/** A bottom sheet: a scrim that closes it, a grab bar, a title and its content. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: c.bg, paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.grab, { backgroundColor: c.line }]} />
        <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
        {children}
      </View>
    </Modal>
  );
}

/** One choice in a sheet: an icon, a label, a line of explanation, a check when chosen. */
export function SheetOption({
  icon,
  label,
  detail,
  selected,
  disabled,
  onPress,
  testID,
}: {
  icon?: ReactNode;
  label: string;
  detail?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [styles.option, { backgroundColor: pressed ? c.surface : "transparent", opacity: disabled ? 0.45 : 1 }]}
    >
      {icon ? <View style={[styles.icon, { backgroundColor: c.surface }]}>{icon}</View> : null}
      <View style={styles.optionText}>
        <Text style={[styles.label, { color: c.ink }]}>{label}</Text>
        {detail ? <Text style={[styles.detail, { color: c.muted }]}>{detail}</Text> : null}
      </View>
      {selected ? <View style={[styles.check, { backgroundColor: c.accent }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.38)" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 12, paddingTop: 8, maxHeight: "80%" },
  grab: { width: 38, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: 10 },
  title: { fontFamily: font.semibold, fontSize: 16, marginHorizontal: 6, marginBottom: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 14 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  optionText: { flex: 1 },
  label: { fontFamily: font.semibold, fontSize: 15 },
  detail: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, marginTop: 1 },
  check: { width: 10, height: 10, borderRadius: 5 },
});
