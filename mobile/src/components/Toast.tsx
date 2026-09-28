import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { font, usePalette } from "@/lib/theme";

/**
 * One message at a time along the bottom, above the tab bar — "Note deleted ·
 * Undo". It outlives the screen that raised it, so deleting from a note and
 * landing back on the list still shows it.
 */

interface Toast {
  id: number;
  message: string;
  action?: { label: string; onPress: () => void };
}

const ToastContext = createContext<((message: string, action?: Toast["action"]) => void) | null>(null);

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}

/** As long as the Undo window of a deletion (src/notes/store.ts UNDO_MS). */
const VISIBLE_MS = 6000;

/** Clear of the tab bar (56) and the list's + button (18 + 56) above it. */
const ABOVE_TABS_AND_FAB = 56 + 18 + 56 + 12;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const c = usePalette();
  const insets = useSafeAreaInsets();

  const show = useCallback((message: string, action?: Toast["action"]) => {
    seq.current += 1;
    setToast({ id: seq.current, message, action });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + ABOVE_TABS_AND_FAB }]}>
          <View style={[styles.toast, { backgroundColor: c.ink }]} accessibilityLiveRegion="polite" testID="toast">
            <Text style={[styles.text, { color: c.bg }]}>{toast.message}</Text>
            {toast.action ? (
              <Pressable
                hitSlop={10}
                testID="toast-action"
                onPress={() => {
                  toast.action?.onPress();
                  setToast(null);
                }}
              >
                <Text style={[styles.action, { color: c.bg }]}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12 },
  toast: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12 },
  text: { flex: 1, fontFamily: font.medium, fontSize: 14 },
  action: { fontFamily: font.bold, fontSize: 14, textDecorationLine: "underline" },
});
