book. for Android — Expo (React Native) app. Plan and decisions: `../docs/product/mobile-app.md`.

## Expo changes every SDK — don't trust memory

Read the `expo` major in `package.json` (57 today) and use the versioned docs,
`https://docs.expo.dev/versions/v<major>.0.0/`, or the index at
`https://docs.expo.dev/llms.txt`, before touching any Expo or React Native API.

## How this project differs from the template

- **pnpm only** (never npm/npx/yarn). `mobile/` is its **own** pnpm project:
  `pnpm-workspace.yaml` here stops pnpm at this directory, so this lockfile never
  mixes with the web's, which Railway installs. Add dependencies with
  `pnpm expo install <pkg>` (SDK-compatible versions).
- **No EAS, no Expo account.** Builds are local with Android Studio's SDK and a
  **JDK 21** (`/usr/libexec/java_home -v 21`). Not Android Studio's bundled JDK 25:
  it prints a native-access warning that AGP 8.12 (React Native 0.86) takes for a
  prefab error, and the native build fails.
  - debug: `pnpm android` (prebuild + install on the running emulator/phone);
  - release: `pnpm android:release` → signed APK in `~/Downloads`
    (`scripts/android-release.sh`; the keystore password comes from the macOS
    Keychain and never touches disk).
- **`android/` is generated** (`pnpm expo prebuild`); never edit it. Native config
  lives in `app.json` and `plugins/` — `with-release-signing.js` points debug
  builds at `~/.android/debug.keystore` (its SHA-1 is the one registered with
  Google) and release builds at `~/.android/book-release.jks`;
  `with-gradle-project-name.js` keeps Gradle from choking on the dot in "book.".
- **Shared code**: `@shared/*` → `../lib/*`, only pure modules that import
  nothing but each other (issues, notes, mentions, currency, text-limits,
  invoices, metrics-report). `lib/metrics` itself is NOT one (it imports
  date-fns through `lib/dates`): the phone never recomputes a dashboard
  number, it shows `GET /api/metrics`. Brand assets come
  from `../brand`.
- **Business tabs** (Invoices, Salaries, Metrics — `src/business/`): each keeps
  its last API answer in SQLite (`business_cache`) with its time and shows it
  offline; actions go straight to the API and invalidate what they change.
  The snapshots are wiped whenever the session ends.
- **The note editor** (`src/editor/`) is TipTap on a page bundled into the app,
  in a WebView. The page is `editor-web/`, built with the web's TipTap and
  `../lib/rich-text` by `pnpm editor:build` into
  `src/editor/editor-html.generated.ts` — not versioned; `start`, `android`,
  `typecheck`, `lint` and the release script build it first. It needs the repo
  root installed. `book://dev/editor` (development builds) shows it on its own.
- **Tests** run on the TypeScript sources with Node (`node --test
  --experimental-strip-types`). The shared `../lib` modules import each other
  without extensions, as the web expects; `scripts/test-resolve.mjs` (loaded by
  `pnpm test`) retries those imports as `.ts`.
- **Google sign-in** is `modules/google-id` (a local Expo module on Android's
  Credential Manager). The app asks Google for a token for the WEB OAuth client;
  the server verifies it (`/api/mobile/sign-in`).
- Development builds show a "Use API token" form on the sign-in screen for
  running against a local server; it is compiled out of release builds.

## Before calling anything done

`pnpm typecheck`, `pnpm lint`, `pnpm test`, and — for anything visible — run it
on the emulator.
