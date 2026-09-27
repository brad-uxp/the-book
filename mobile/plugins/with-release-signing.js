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
//  - release: ~/.android/book-release.jks. Gradle never sees it: the release
//             build type is left UNSIGNED, and scripts/android-release.sh
//             signs the finished APK with apksigner, feeding the password from
//             the macOS Keychain through a pipe. So the password never enters
//             the environment of Gradle, its plugins, Metro or CMake — only
//             apksigner's stdin.
//
// Fail closed: the template signs release with the debug key; that line is
// removed, so a release APK out of Gradle is unsigned and cannot be installed
// until the script signs it with the release key.
const { withAppBuildGradle } = require("expo/config-plugins");

const DEBUG_KEYSTORE = `storeFile file('debug.keystore')`;
const DEBUG_KEYSTORE_STANDARD = [
  `def standardDebugKeystore = file("\${System.getProperty('user.home')}/.android/debug.keystore")`,
  `            storeFile standardDebugKeystore.exists() ? standardDebugKeystore : file('debug.keystore')`,
].join("\n");

const MARKER = "// book.: release left unsigned — signed by scripts/android-release.sh";

function applySigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;

  if (!gradle.includes(DEBUG_KEYSTORE)) {
    throw new Error("with-release-signing: debug signing config not found in app/build.gradle");
  }
  gradle = gradle.replace(DEBUG_KEYSTORE, DEBUG_KEYSTORE_STANDARD);

  const releaseUsesDebug =
    /(release \{\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/;
  if (!releaseUsesDebug.test(gradle)) {
    throw new Error("with-release-signing: release buildType signing line not found");
  }
  return gradle.replace(releaseUsesDebug, `$1${MARKER}`);
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applySigning(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.applySigning = applySigning;
