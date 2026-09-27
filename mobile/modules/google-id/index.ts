import GoogleId, { type GoogleIdResult } from "./src/GoogleIdModule";

export type { GoogleIdResult };

/** Error codes the native side throws (see GoogleIdModule.kt). */
export type GoogleIdErrorCode =
  | "ERR_CANCELLED"
  | "ERR_NO_ACCOUNT"
  | "ERR_NO_ACTIVITY"
  | "ERR_SIGN_IN_FAILED";

export function signInWithGoogle(serverClientId: string, nonce: string): Promise<GoogleIdResult> {
  return GoogleId.signIn(serverClientId, nonce);
}

export function googleIdErrorCode(error: unknown): GoogleIdErrorCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("ERR_") ? (code as GoogleIdErrorCode) : null;
}
