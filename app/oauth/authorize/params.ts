/** The authorization request's parameters (RFC 6749 §4.1.1, PKCE, RFC 8707) — the ones the consent form carries back. */
export const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;
