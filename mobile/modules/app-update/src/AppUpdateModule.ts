import { NativeModule, requireNativeModule } from "expo";

declare class AppUpdateModule extends NativeModule<Record<string, never>> {
  installedVersion(): { name: string; code: number };
  sha256(path: string): Promise<string>;
  /** "ok" only for an APK of this package signed by this app's key. */
  verify(path: string): Promise<"ok" | "wrong_package" | "wrong_signer" | "unreadable">;
  canInstall(): boolean;
  openInstallSettings(): void;
  install(path: string): void;
}

export default requireNativeModule<AppUpdateModule>("AppUpdate");
