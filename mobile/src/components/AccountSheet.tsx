import { StyleSheet, Text, View } from "react-native";
import { Bell, Download, LogOut, RefreshCw } from "lucide-react-native";
import { font, usePalette } from "@/lib/theme";
import { Sheet, SheetOption } from "@/components/Sheet";

/**
 * The account menu, as a sheet. It used to be an Alert, but Android shows at
 * most three buttons in one, and the menu outgrew that: sync status, the
 * installed version, checking for updates, a test notification and signing
 * out. The actions themselves stay with the caller.
 */
export function AccountSheet({
  visible,
  onClose,
  email,
  syncLine,
  updateLine,
  updateActionLabel,
  onUpdate,
  onTestNow,
  onTestLater,
  onSignOut,
}: {
  visible: boolean;
  onClose: () => void;
  email: string | null;
  syncLine: string;
  updateLine: string;
  /** "Check for updates", "Download", "Install" — what tapping it does now. */
  updateActionLabel: string;
  onUpdate: () => void;
  onTestNow: () => void;
  onTestLater: () => void;
  onSignOut: () => void;
}) {
  const c = usePalette();
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Sheet visible={visible} title={email ?? "Signed in"} onClose={onClose}>
      <View style={styles.status}>
        <Text style={[styles.line, { color: c.muted }]} testID="account-sync-line">
          {syncLine}
        </Text>
      </View>
      <SheetOption
        icon={<Download size={18} color={c.ink} />}
        label={updateActionLabel}
        detail={updateLine}
        onPress={run(onUpdate)}
        testID="account-update"
      />
      <SheetOption
        icon={<Bell size={18} color={c.ink} />}
        label="Test notification"
        detail="Send a push to this phone now"
        onPress={run(onTestNow)}
        testID="account-test-now"
      />
      <SheetOption
        icon={<RefreshCw size={18} color={c.ink} />}
        label="Test notification in 10 s"
        detail="Time to close the app or lock the screen"
        onPress={run(onTestLater)}
        testID="account-test-later"
      />
      <SheetOption
        icon={<LogOut size={18} color={c.danger} />}
        label="Sign out"
        detail="Also clears the notes from this phone"
        onPress={run(onSignOut)}
        testID="account-sign-out"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  status: { paddingHorizontal: 6, paddingBottom: 8 },
  line: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
});
