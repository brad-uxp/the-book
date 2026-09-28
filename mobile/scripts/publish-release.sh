#!/usr/bin/env bash
# Publishes a signed book. APK as an in-app update: registers it with the API,
# uploads it to R2 through a short-lived presigned URL, and publishes it. The
# phone then offers it on its next check (docs/product/mobile-app.md → Publicar).
#
#   scripts/publish-release.sh <signed.apk> [notes]
#
# Authenticates with a release token (Settings → API tokens → Kind: App release)
# kept in the macOS Keychain. The token goes from `security` through a pipe into
# curl's config on stdin: never an environment variable, a file or a command
# line (where `ps` would show it).
#
# Exit codes: 0 published, 2 no release token in the Keychain (nothing sent),
# anything else a failure.
#
# Overridable for testing against a local server — none of these is a secret:
#   BOOK_API_URL                (default https://book.bolstro.com)
#   BOOK_RELEASE_TOKEN_SERVICE  (Keychain service, default "book. release token")
#   BOOK_EXPECTED_SIGNER_SHA1   (default: the release certificate)
set -euo pipefail

APK="${1:?usage: publish-release.sh <signed.apk> [notes]}"
NOTES="${2:-}"
[[ -f "$APK" ]] || { echo "No such file: $APK" >&2; exit 1; }

API="${BOOK_API_URL:-https://book.bolstro.com}"
SERVICE="${BOOK_RELEASE_TOKEN_SERVICE:-book. release token}"
ACCOUNT="book-release"
# The certificate registered in Google Cloud for com.bolstro.book (release).
EXPECTED_SHA1="${BOOK_EXPECTED_SIGNER_SHA1:-01d78ab820b2f742ab25f701f95dba2a5ce6d179}"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BUILD_TOOLS="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"

if ! security find-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; then
  cat >&2 <<EOM
Not published: no release token in the Keychain (service "$SERVICE").
One-time setup — book. → Settings → API tokens → Kind "App release" → Create,
copy the token, then run (it asks for the token; paste it):

  security add-generic-password -s "book. release token" -a book-release -U -w

EOM
  exit 2
fi

# What the APK says it is, not what app.json says: it is the file that ships.
# `sed -n 1p`, not `head -1`: head closes the pipe early, and under pipefail
# the writer's SIGPIPE would end the script without a word.
BADGING=$("$BUILD_TOOLS/aapt2" dump badging "$APK" | sed -n 1p)
PACKAGE=$(sed -n "s/.*package: name='\([^']*\)'.*/\1/p" <<<"$BADGING")
CODE=$(sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" <<<"$BADGING")
VERSION=$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<<"$BADGING")
[[ "$PACKAGE" == "com.bolstro.book" ]] || { echo "Not a book. APK (package $PACKAGE)" >&2; exit 1; }

# Android installs an update only over the same signing key; refuse anything
# else here rather than offer the phone a build it cannot install.
SHA1=$("$BUILD_TOOLS/apksigner" verify --print-certs "$APK" | sed -n 's/.*certificate SHA-1 digest: //p' | sed -n 1p)
[[ "$SHA1" == "$EXPECTED_SHA1" ]] || { echo "Signed with $SHA1, expected $EXPECTED_SHA1. Not publishing." >&2; exit 1; }

SHA256=$(shasum -a 256 "$APK" | cut -d' ' -f1)
SIZE=$(stat -f%z "$APK")

# The Authorization header, as a curl config line on stdin.
auth() {
  security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w \
    | sed 's/^/header = "Authorization: Bearer /; s/$/"/'
}

json_field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s)[process.argv[1]];if(v===undefined)process.exit(1);console.log(v)})' "$1"
}

BODY=$(node -e 'const [v,c,h,n,t]=process.argv.slice(1);console.log(JSON.stringify({version:v,version_code:Number(c),sha256:h,size_bytes:Number(n),notes:t}))' \
  "$VERSION" "$CODE" "$SHA256" "$SIZE" "$NOTES")

echo "Registering $VERSION ($CODE), $SIZE bytes…"
CREATED=$(auth | curl -sS --fail-with-body -K - -X POST -H "Content-Type: application/json" --data "$BODY" "$API/api/mobile/releases")
UPLOAD_URL=$(json_field upload_url <<<"$CREATED")

echo "Uploading…"
curl -sS --fail-with-body -X PUT -H "Content-Type: application/vnd.android.package-archive" \
  --upload-file "$APK" "$UPLOAD_URL" >/dev/null

echo "Publishing…"
auth | curl -sS --fail-with-body -K - -X POST "$API/api/mobile/releases/$CODE/publish" >/dev/null
echo "Published $VERSION ($CODE): the phone offers it on its next check."
