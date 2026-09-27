import { useState, type ComponentType } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GoogleG } from "@/components/GoogleG";
import { SignInCancelled, useAuth } from "@/lib/auth";
import { font, useIsDark, usePalette } from "@/lib/theme";

// Required only in development builds: `__DEV__` is folded to false in
// release, so this require — and the module — never reach the release bundle.
const DevTokenSignIn: ComponentType | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import would always be bundled
    require("@/components/DevTokenSignIn").DevTokenSignIn
  : null;

const WORDMARK_INK = require("../../../brand/png/wordmark-ink.png");
const WORDMARK_PAPER = require("../../../brand/png/wordmark-paper.png");

export default function SignIn() {
  const { signInWithGoogle } = useAuth();
  const c = usePalette();
  const isDark = useIsDark();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      if (!(e instanceof SignInCancelled)) {
        setError(e instanceof Error ? e.message : "Sign-in failed. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
      {/* Edge to edge, the window no longer shrinks for the keyboard. */}
      <KeyboardAvoidingView style={styles.content} behavior="padding">
        <View style={styles.brand}>
          <Image
            source={isDark ? WORDMARK_PAPER : WORDMARK_INK}
            style={styles.wordmark}
            resizeMode="contain"
            accessibilityLabel="book."
          />
          <Text style={[styles.tagline, { color: c.muted }]}>Your notes, invoices and salaries.</Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onGoogle}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.google,
              { backgroundColor: c.primary, opacity: pressed || busy ? 0.85 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={c.onPrimary} />
            ) : (
              <>
                <View style={styles.gBadge}>
                  <GoogleG size={16} />
                </View>
                <Text style={[styles.googleText, { color: c.onPrimary }]}>Continue with Google</Text>
              </>
            )}
          </Pressable>
          {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}
          <Text style={[styles.fine, { color: c.faint }]}>Only the accounts allowed on book. can sign in.</Text>
          {DevTokenSignIn ? <DevTokenSignIn /> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24 },
  brand: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  wordmark: { width: 200, height: 63 },
  tagline: { fontFamily: font.regular, fontSize: 15 },
  actions: { paddingBottom: 24, gap: 10 },
  google: { height: 52, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  gBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  googleText: { fontFamily: font.semibold, fontSize: 16 },
  error: { fontFamily: font.medium, fontSize: 14, textAlign: "center" },
  fine: { fontFamily: font.regular, fontSize: 12, textAlign: "center" },
});
