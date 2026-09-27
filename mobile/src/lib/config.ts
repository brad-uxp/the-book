/**
 * Where the app talks to, and as whom it asks Google to sign in.
 *
 * The API URL can be overridden only in development builds (e.g. the emulator
 * reaching a local server at http://10.0.2.2:3011). A release build always
 * talks to production, whatever the environment it was built in.
 */
const PRODUCTION_API = "https://book.bolstro.com";

export const API_URL = (
  __DEV__ && process.env.EXPO_PUBLIC_API_URL ? process.env.EXPO_PUBLIC_API_URL : PRODUCTION_API
).replace(/\/$/, "");

/**
 * The WEB OAuth client of book. — public by nature (it is in the web login's
 * redirect). Google puts it as the `aud` of the ID token, and the server only
 * accepts tokens for it. The Android OAuth clients are never referenced in
 * code: Google matches them by package and signing certificate.
 */
export const GOOGLE_WEB_CLIENT_ID =
  "348255215221-1d3g6nrfa33f7dujl3eslhjgvfishjia.apps.googleusercontent.com";
