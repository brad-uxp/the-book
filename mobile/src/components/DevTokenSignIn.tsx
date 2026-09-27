import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "@/lib/auth";
import { font, usePalette } from "@/lib/theme";

/**
 * DEVELOPMENT BUILDS ONLY — sign in with an API token pasted by hand, to run
 * the app against a local server where Google sign-in cannot work.
 *
 * sign-in.tsx requires this module behind `__DEV__`; release builds fold that
 * to false and never bundle it (verified by searching the release bundle for
 * "Use API token").
 */
export function DevTokenSignIn() {
  const { signInWithToken } = useAuth();
  const c = usePalette();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <View style={[styles.box, { borderColor: c.line }]}>
      <Text style={[styles.tag, { color: c.soon }]}>DEVELOPMENT BUILD</Text>
      <TextInput
        value={token}
        onChangeText={setToken}
        placeholder="tb_…"
        placeholderTextColor={c.faint}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
        testID="dev-token-input"
      />
      <Pressable
        testID="dev-token-submit"
        disabled={busy || token.trim().length < 10}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await signInWithToken(token.trim());
          } catch (e) {
            setError(e instanceof Error ? e.message : "That token didn't work");
          } finally {
            setBusy(false);
          }
        }}
        style={[styles.button, { borderColor: c.line, opacity: busy ? 0.5 : 1 }]}
      >
        <Text style={[styles.buttonText, { color: c.ink }]}>Use API token</Text>
      </Pressable>
      {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 18, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", gap: 8 },
  tag: { fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6 },
  input: { height: 40, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, fontFamily: font.regular, fontSize: 13 },
  button: { height: 40, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: font.semibold, fontSize: 14 },
  error: { fontFamily: font.regular, fontSize: 13 },
});
