import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nextConfig from "./next.config";
import { SYNC_PUSH_MAX_BYTES } from "./lib/sync-protocol";

/**
 * Lo que la config de Next promete sobre caché e imágenes.
 *
 * La caché pública iba por extensión (`/:path*.(svg|png|…)`) y alcanzaba
 * también /api/… y las páginas: respuestas a las que el proxy les suma la
 * cookie de sesión renovada. Ahora va por ruta exacta, solo a las imágenes de
 * /public. Y el optimizador de imágenes no corre: /_next/image no pasa por el
 * proxy, así que cualquiera podía hacerle bajar y recodificar imágenes ajenas.
 */

const PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));
const IMAGE = /\.(svg|png|jpe?g|gif|ico|webp|avif)$/i;

async function publicCacheRules() {
  const rules = await nextConfig.headers!();
  return rules.filter((rule) =>
    rule.headers.some((h) => h.key.toLowerCase() === "cache-control" && /\bpublic\b/i.test(h.value))
  );
}

describe("next.config — caché pública", () => {
  it("va solo a las imágenes que hay en /public, una por una", async () => {
    const sources = (await publicCacheRules()).map((rule) => rule.source).sort();
    const images = readdirSync(PUBLIC_DIR).filter((f) => IMAGE.test(f)).map((f) => `/${f}`).sort();
    expect(sources).toEqual(images);
  });

  it("cada regla es una ruta literal: nada que pueda alcanzar /api ni una página", async () => {
    for (const rule of await publicCacheRules()) {
      expect(rule.source).toMatch(/^\/[A-Za-z0-9._-]+$/);
      expect(rule.source.startsWith("/api")).toBe(false);
    }
  });
});

describe("next.config — imágenes", () => {
  it("sin optimizador y sin hosts remotos", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
    expect(nextConfig.images?.remotePatterns ?? []).toHaveLength(0);
  });
});

// Next guarda el cuerpo para el proxy antes de cualquier handler o chequeo de
// credencial. Por defecto, 10 MB por conexión, sin login. Tiene que quedar
// arriba del tope más grande de una ruta (el push de la sync), o Next le corta
// el cuerpo a un push válido.
describe("next.config — cuerpo antes del proxy", () => {
  const limit = nextConfig.experimental?.proxyClientMaxBodySize;

  it("es un número de bytes, menor que el default de 10 MB", () => {
    expect(typeof limit).toBe("number");
    expect(limit as number).toBeLessThan(10 * 1024 * 1024);
  });

  it("deja pasar el push de sync más grande, con margen para que la ruta conteste 413", () => {
    expect(limit as number).toBeGreaterThan(SYNC_PUSH_MAX_BYTES);
    expect((limit as number) - SYNC_PUSH_MAX_BYTES).toBeGreaterThanOrEqual(64 * 1024);
  });

  it("y arriba de los otros topes de las rutas (MCP 1 MB, sign-in y token 8 KB)", () => {
    for (const cap of [1024 * 1024, 8 * 1024]) expect(limit as number).toBeGreaterThan(cap);
  });
});
