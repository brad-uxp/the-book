/**
 * The app version a phone reports with its push registration: the installed
 * build as Android sees it — "0.5.1+8", name and versionCode — not the JS
 * bundle's config, so the server tells builds apart even when only the
 * versionCode moved. Undefined when it doesn't fit the server's rule
 * (lib/validations.ts MobileDeviceSchema: ≤ 32 of [0-9A-Za-z.+-]).
 */
export function deviceAppVersion(installed: { name: string; code: number }): string | undefined {
  const v = `${installed.name}+${installed.code}`;
  return /^[0-9A-Za-z.+-]{1,32}$/.test(v) ? v : undefined;
}
