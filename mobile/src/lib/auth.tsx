import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import * as Device from "expo-device";
import { googleIdErrorCode, signInWithGoogle } from "../../modules/google-id";
import { ApiError, apiRequest } from "./api";
import { GOOGLE_WEB_CLIENT_ID } from "./config";

/**
 * The app's session: an API token from POST /api/mobile/sign-in, kept in the
 * phone's secure storage (Android Keystore-backed), never in plain storage.
 */

const TOKEN_KEY = "book.api-token";
const EMAIL_KEY = "book.account-email";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; token: string; email: string | null };

interface AuthContextValue {
  state: AuthState;
  /** Google sign-in, end to end. Resolves when signed in; throws a readable Error. */
  signInWithGoogle: () => Promise<void>;
  /** Development builds only: sign in with an API token pasted by hand. */
  signInWithToken: (token: string) => Promise<void>;
  /** Revokes this phone's token on the server (best effort) and forgets it. */
  signOut: () => Promise<void>;
  /** The server refused the token (401): forget it without calling the server. */
  expire: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Thrown when the user backs out of Google's sheet: not an error to show. */
export class SignInCancelled extends Error {}

type SignInResponse = { token: string; email: string };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [token, email] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(EMAIL_KEY),
      ]).catch(() => [null, null]);
      if (cancelled) return;
      setState(token ? { status: "signed-in", token, email } : { status: "signed-out" });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const store = useCallback(async (token: string, email: string | null) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    if (email) await SecureStore.setItemAsync(EMAIL_KEY, email);
    else await SecureStore.deleteItemAsync(EMAIL_KEY);
    setState({ status: "signed-in", token, email });
  }, []);

  const forget = useCallback(async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(EMAIL_KEY),
    ]).catch(() => undefined);
    setState({ status: "signed-out" });
  }, []);

  const googleSignIn = useCallback(async () => {
    // 1. A single-use nonce, so the ID token Google signs is only good once.
    const { nonce } = await apiRequest<{ nonce: string }>("/api/mobile/nonce", { method: "POST" });

    // 2. Google's own sign-in sheet (Credential Manager).
    let idToken: string;
    try {
      ({ idToken } = await signInWithGoogle(GOOGLE_WEB_CLIENT_ID, nonce));
    } catch (err) {
      const code = googleIdErrorCode(err);
      if (code === "ERR_CANCELLED") throw new SignInCancelled();
      if (code === "ERR_NO_ACCOUNT") {
        throw new Error("Add your Google account to this phone first, then try again.");
      }
      throw new Error("Google sign-in didn't work. Try again.");
    }

    // 3. Exchange it for this phone's API token.
    try {
      const res = await apiRequest<SignInResponse>("/api/mobile/sign-in", {
        method: "POST",
        body: { id_token: idToken, device_name: Device.modelName ?? "Android" },
      });
      await store(res.token, res.email);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        throw new Error("This Google account can't use book.");
      }
      if (err instanceof ApiError && err.status === 429) {
        throw new Error("Too many attempts. Wait a few minutes and try again.");
      }
      throw err instanceof Error ? err : new Error("Sign-in failed. Try again.");
    }
  }, [store]);

  const tokenSignIn = useCallback(
    async (pasted: string) => {
      if (!__DEV__) throw new Error("Not available");
      const token = pasted.trim();
      // Proves the token works before keeping it.
      await apiRequest("/api/issues", { token });
      await store(token, null);
    },
    [store]
  );

  const signOut = useCallback(async () => {
    if (state.status === "signed-in") {
      await apiRequest("/api/mobile/sign-out", { method: "POST", token: state.token }).catch(
        () => undefined // Offline or already revoked: forgetting it locally is what matters.
      );
    }
    await forget();
  }, [state, forget]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signInWithGoogle: googleSignIn, signInWithToken: tokenSignIn, signOut, expire: forget }),
    [state, googleSignIn, tokenSignIn, signOut, forget]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
