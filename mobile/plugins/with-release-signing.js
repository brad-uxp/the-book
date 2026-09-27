// Signing for book. builds, applied at prebuild so android/ stays generated.
//
// Google Sign-In only works when the APK's signing certificate matches an
// Android OAuth client registered for com.bolstro.book (see
// docs/product/mobile-app.md). Two are registered:
//
//  - debug:   the standard Android Studio key, ~/.android/debug.keystore.
//             The generated project would otherwise sign debug builds with
//             the template's own android/app/debug.keystore — a different
//             SHA-1, and Google would refuse sign-in with DEVELOPER_ERROR.
//  - release: ~/.android/book-release.jks. Its password lives in the macOS
//             Keychain and reaches Gradle only as environment variables set by
//             scripts/android-release.sh — never a file, never the repo.
//
// Fail closed: a release build without those variables has no store file and
// Gradle refuses to package it, so an APK signed with a debug key cannot ship
// by accident.
const { withAppBuildGradle } = require("expo/config-plugins");

const DEBUG_KEYSTORE = `storeFile file('debug.keystore')`;
const DEBUG_KEYSTORE_STANDARD = [
  `def standardDebugKeystore = file("\${System.getProperty('user.home')}/.android/debug.keystore")`,
  `            storeFile standardDebugKeystore.exists() ? standardDebugKeystore : file('debug.keystore')`,
].join("\n");

const RELEASE_SIGNING = `
        release {
            // Set only by scripts/android-release.sh. Absent => release cannot be signed.
            def releaseStore = System.getenv("BOOK_RELEASE_KEYSTORE")
            if (releaseStore) {
                storeFile file(releaseStore)
                storePassword System.getenv("BOOK_RELEASE_KEYSTORE_PASSWORD")
                keyAlias System.getenv("BOOK_RELEASE_KEY_ALIAS")
                keyPassword System.getenv("BOOK_RELEASE_KEYSTORE_PASSWORD")
            }
        }`;

function applySigning(gradle) {
  if (gradle.includes("BOOK_RELEASE_KEYSTORE")) return gradle;

  if (!gradle.includes(DEBUG_KEYSTORE)) {
    throw new Error("with-release-signing: debug signing config not found in app/build.gradle");
  }
  gradle = gradle.replace(DEBUG_KEYSTORE, DEBUG_KEYSTORE_STANDARD);

  const signingBlock = /signingConfigs \{\n(\s+debug \{[\s\S]*?\n\s+\})/;
  if (!signingBlock.test(gradle)) {
    throw new Error("with-release-signing: signingConfigs block not found");
  }
  gradle = gradle.replace(signingBlock, (m) => `${m}${RELEASE_SIGNING}`);

  const releaseUsesDebug =
    /(release \{\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/;
  if (!releaseUsesDebug.test(gradle)) {
    throw new Error("with-release-signing: release buildType signing line not found");
  }
  return gradle.replace(releaseUsesDebug, "$1signingConfig signingConfigs.release");
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applySigning(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.applySigning = applySigning;
