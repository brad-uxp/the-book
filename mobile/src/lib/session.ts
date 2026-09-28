/**
 * Where the app's session lives in the phone's secure storage. Shared by the
 * auth provider and the push task, which runs headless — without React —
 * when a push arrives with the app closed, and must not import the provider.
 */
export const TOKEN_KEY = "book.api-token";
export const EMAIL_KEY = "book.account-email";
