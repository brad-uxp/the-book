import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// react-native-svg paints every <Svg> into a bitmap of its layout size. On the
// canvas, one sized to the cards grew with the canvas until Android refused
// to draw it (243 MB — the app crashed opening a spread-out canvas). Every Svg
// here must be screen-sized: it fills the canvas area and moves its content
// through the view instead of being moved and scaled with the world.
const here = dirname(fileURLToPath(import.meta.url));

test("todo <Svg> del canvas ocupa la pantalla, nunca el tamaño del contenido", () => {
  const files = readdirSync(here).filter((f) => f.endsWith(".tsx"));
  let found = 0;
  for (const f of files) {
    const src = readFileSync(join(here, f), "utf8");
    for (const m of src.matchAll(/<Svg\b[^>]*>/g)) {
      found++;
      assert.match(m[0], /style=\{StyleSheet\.absoluteFill\}/, `${f}: ${m[0]}`);
      assert.doesNotMatch(m[0], /\b(width|height)=/, `${f}: ${m[0]}`);
    }
  }
  assert.ok(found >= 2, "expected the connections layer and the dragged-line layer");
});
