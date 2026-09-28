/**
 * The phone's tests run on the TypeScript sources directly
 * (`--experimental-strip-types`), and Node's ES module resolver needs file
 * extensions. The web's shared modules (`../lib`, `@shared/*` in the app)
 * import each other without them, as the web's bundler and Metro expect —
 * so when an extensionless relative import is not found, try it as `.ts`.
 *
 * Loaded with `node --import` by `pnpm test`; the app never runs it.
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (err?.code === "ERR_MODULE_NOT_FOUND" && relative && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});
