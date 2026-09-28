import { NativeModule, requireNativeModule } from "expo";

declare class AppUpdateModule extends NativeModule<Record<string, never>> {
  installedVersion(): { name: string; code: number };
  sha256(path: string): Promise<string>;
  canInstall(): boolean;
  openInstallSettings(): void;
  install(path: string): void;
}

export default requireNativeModule<AppUpdateModule>("AppUpdate");
