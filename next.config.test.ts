import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nextConfig from "./next.config";

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
