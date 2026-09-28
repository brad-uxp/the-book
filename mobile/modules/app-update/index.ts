import AppUpdate from "./src/AppUpdateModule";

/** The version of the app running now (versionName, versionCode). */
export function installedVersion(): { name: string; code: number } {
  return AppUpdate.installedVersion();
}

/** sha256 (hex) of a downloaded update in cache/updates/, computed natively as a stream. */
export function sha256OfUpdate(fileUri: string): Promise<string> {
  return AppUpdate.sha256(fileUri);
}

/** Whether Android lets book. open the installer (the owner allows it once in Settings). */
export function canInstallUpdates(): boolean {
  return AppUpdate.canInstall();
}

/** Opens Android's "Install unknown apps" page for book. */
export function openInstallSettings(): void {
  AppUpdate.openInstallSettings();
}

/** Hands a verified update in cache/updates/ to Android's installer, which asks the owner to confirm. */
export function installUpdate(fileUri: string): void {
  AppUpdate.install(fileUri);
}
