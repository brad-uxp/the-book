# Credential Manager finds its Play Services provider by reflection; keep it if
# release builds are ever minified (Google's documented rule).
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}
