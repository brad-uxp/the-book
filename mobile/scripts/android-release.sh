#!/usr/bin/env bash
# Builds a signed release APK of book. — locally, with Android Studio's SDK and
# a JDK 21. No EAS. The finished APK is then published to book.'s own API and
# R2 as an in-app update (scripts/publish-release.sh) unless --no-publish.
#
# Gradle builds the APK UNSIGNED and never sees the key. apksigner signs it
# afterwards, reading the keystore password on stdin straight from the macOS
# Keychain through a pipe: never in an environment variable (where Gradle, its
# plugins, Metro and CMake would all inherit it), never a file, never the repo,
# never a command line (where `ps` would show it).
set -euo pipefail
cd "$(dirname "$0")/.."

# After building, the APK is published as an in-app update
# (scripts/publish-release.sh) unless --no-publish; --notes "…" is shown to
# the owner in the app's update prompt.
PUBLISH=1
NOTES=""
while (( $# )); do
  case "$1" in
    --no-publish) PUBLISH=0 ;;
    --notes) NOTES="${2:?--notes needs a text}"; shift ;;
    *) echo "Unknown option: $1 (use --no-publish, --notes \"…\")" >&2; exit 1 ;;
  esac
  shift
done

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

# The editor page is bundled into the app as a generated module; Metro needs it.
pnpm editor:build

pnpm expo prebuild --platform android --clean --no-install

# Expo's template caps Gradle at 2 GB of heap, which D8's dex merge outgrew
# once expo-sharing and expo-file-system joined (OutOfMemoryError in
# mergeDexRelease, 0.3.0). prebuild --clean rewrites gradle.properties, so the
# cap is raised here, for this build only.
# arm64-v8a only: the owner's phone (and every Android phone sold in years)
# is 64-bit ARM. Native code for four ABIs made the APK 118.6 MB; one makes it
# 52 MB — what the phone now downloads for each in-app update.
(cd android && ./gradlew --no-daemon --quiet \
  "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8" \
  -PreactNativeArchitectures=arm64-v8a \
  assembleRelease)

UNSIGNED="android/app/build/outputs/apk/release/app-release-unsigned.apk"
[[ -f "$UNSIGNED" ]] || { echo "Gradle did not produce $UNSIGNED" >&2; exit 1; }
BUILD_TOOLS="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ALIGNED="$WORK/aligned.apk"
APK="$WORK/book-release.apk"

# 4-byte alignment, and 16 KB pages for native libraries (Android 15+).
"$BUILD_TOOLS/zipalign" -P 16 -f 4 "$UNSIGNED" "$ALIGNED"

# The only place the password goes: this pipe, into apksigner's stdin. The key
# password is the store password, so apksigner reuses it.
security find-generic-password -s "$KEYCHAIN_SERVICE" -w \
  | "$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias book --ks-pass stdin --out "$APK" "$ALIGNED"

"$BUILD_TOOLS/zipalign" -c -P 16 4 "$APK" >/dev/null || { echo "APK is not aligned" >&2; exit 1; }
SHA1=$("$BUILD_TOOLS/apksigner" verify --print-certs "$APK" | sed -n 's/.*certificate SHA-1 digest: //p' | head -1)
if [[ "$SHA1" != "$EXPECTED_SHA1" ]]; then
  echo "Signed with the wrong certificate (SHA-1 $SHA1, expected $EXPECTED_SHA1). Not copying." >&2
  exit 1
fi

OUT="$HOME/Downloads/book-$VERSION-$CODE.apk"
cp "$APK" "$OUT"
echo "Signed with the release key (SHA-1 $SHA1)"
echo "APK: $OUT"

if (( PUBLISH )); then
  rc=0
  scripts/publish-release.sh "$OUT" "$NOTES" || rc=$?
  if (( rc == 2 )); then
    echo "Built but not published; install it over USB, or set up the token and run:"
    echo "  scripts/publish-release.sh \"$OUT\""
  elif (( rc != 0 )); then
    echo "Built, but publishing failed (exit $rc). Retry with: scripts/publish-release.sh \"$OUT\"" >&2
    exit "$rc"
  fi
fi
