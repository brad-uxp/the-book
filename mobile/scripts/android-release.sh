#!/usr/bin/env bash
# Builds a signed release APK of book. — locally, with Android Studio's SDK and
# a JDK 21. No EAS, nothing uploaded.
#
# The keystore password is read from the macOS Keychain into the environment
# of the Gradle process only: never written to a file, never in the repo,
# never on a command line (where `ps` would show it). Gradle runs without a
# daemon so no long-lived process keeps it in its environment.
set -euo pipefail
cd "$(dirname "$0")/.."

# Not Android Studio's bundled JDK (25): it prints a native-access warning that
# the Android Gradle Plugin of React Native 0.86 takes for a prefab error.
JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null)" || {
  echo "JDK 21 not found — see docs/product/mobile-app.md (Compilar)" >&2; exit 1;
}
export JAVA_HOME
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

KEYSTORE="$HOME/.android/book-release.jks"
KEYCHAIN_SERVICE="book. Android release keystore"
# The certificate registered in Google Cloud for com.bolstro.book (release).
EXPECTED_SHA1="01d78ab820b2f742ab25f701f95dba2a5ce6d179"

[[ -f "$KEYSTORE" ]] || { echo "Missing $KEYSTORE — see docs/product/mobile-app.md (Compilar)" >&2; exit 1; }

# A release always talks to production (config.ts also ignores this outside dev).
unset EXPO_PUBLIC_API_URL

VERSION=$(node -p "require('./app.json').expo.version")
CODE=$(node -p "require('./app.json').expo.android.versionCode")

pnpm expo prebuild --platform android --clean --no-install

BOOK_RELEASE_KEYSTORE_PASSWORD="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w)"
export BOOK_RELEASE_KEYSTORE="$KEYSTORE" BOOK_RELEASE_KEY_ALIAS="book" BOOK_RELEASE_KEYSTORE_PASSWORD
(cd android && ./gradlew --no-daemon --quiet assembleRelease)
unset BOOK_RELEASE_KEYSTORE_PASSWORD BOOK_RELEASE_KEYSTORE BOOK_RELEASE_KEY_ALIAS

APK="android/app/build/outputs/apk/release/app-release.apk"
BUILD_TOOLS="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
SHA1=$("$BUILD_TOOLS/apksigner" verify --print-certs "$APK" | sed -n 's/.*certificate SHA-1 digest: //p' | head -1)
if [[ "$SHA1" != "$EXPECTED_SHA1" ]]; then
  echo "Signed with the wrong certificate (SHA-1 $SHA1, expected $EXPECTED_SHA1). Not copying." >&2
  exit 1
fi

OUT="$HOME/Downloads/book-$VERSION-$CODE.apk"
cp "$APK" "$OUT"
echo "Signed with the release key (SHA-1 $SHA1)"
echo "APK: $OUT"
