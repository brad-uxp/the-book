// Copies google-services.json (the Firebase config for FCM push) into mobile/
// for `expo prebuild`, which reads it from app.json's android.googleServicesFile.
// The file is not a secret, but it stays out of git: it lives next to the repo,
// in theBookApp/ (override with GOOGLE_SERVICES_JSON=<path>).
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../google-services.json");
const source = process.env.GOOGLE_SERVICES_JSON ?? resolve(here, "../../../google-services.json");

if (!existsSync(source)) {
  console.error(
    `google-services: ${source} not found.\n` +
      "Download it from the Firebase console (project uxprogramming-crm → Android app com.bolstro.book)\n" +
      "and save it in theBookApp/, or set GOOGLE_SERVICES_JSON to its path. See docs/product/mobile-app.md (Push)."
  );
  process.exit(1);
}
copyFileSync(source, target);
console.log("google-services: copied into mobile/");
