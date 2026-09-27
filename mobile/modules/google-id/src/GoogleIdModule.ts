import { NativeModule, requireNativeModule } from "expo";

export type GoogleIdResult = {
  /** Google's ID token; its `aud` is the server client id passed in. */
  idToken: string;
  email: string;
  displayName: string | null;
};

declare class GoogleIdModule extends NativeModule<Record<string, never>> {
  signIn(serverClientId: string, nonce: string): Promise<GoogleIdResult>;
}

export default requireNativeModule<GoogleIdModule>("GoogleId");
