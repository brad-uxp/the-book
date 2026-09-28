import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/components/Toast";
import { SyncProvider } from "@/sync/SyncProvider";
import { useIsDark, usePalette } from "@/lib/theme";

// The splash stays up until fonts and the saved session are both ready, so the
// first frame is already the right screen in the right typeface.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  return (
    // The canvas's gestures (react-native-gesture-handler) need this at the root.
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <AuthProvider>
        <SyncProvider>
          <ToastProvider>
            <Gate fontsLoaded={fontsLoaded} />
          </ToastProvider>
        </SyncProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function Gate({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { state } = useAuth();
  const c = usePalette();
  const isDark = useIsDark();
  const ready = fontsLoaded && state.status !== "loading";

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => undefined);
  }, [c.bg]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  const signedIn = state.status === "signed-in";
  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        {/* Nothing with data is reachable without a token, and the sign-in
            screen is unreachable with one. */}
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="note/[id]" />
          <Stack.Screen name="canvas/[id]" />
          <Stack.Screen name="invoice/[id]" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
