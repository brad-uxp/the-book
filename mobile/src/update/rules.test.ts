import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSize, parseRelease, shouldCheck, updateFileName, UPDATE_CHECK_EVERY_MS } from "./rules.ts";

const release = {
  version: "0.4.3",
  version_code: 7,
  sha256: "a".repeat(64),
  size_bytes: 52_000_000,
  notes: "Canvas fix",
  download_url: "https://r2.example/mobile/releases/book-0.4.3-7.apk?sig",
};

test("pregunta al abrir, después cada 6 h, y siempre si se pide a mano", () => {
  const now = 1_000_000_000;
  assert.equal(shouldCheck(null, now), true);
  assert.equal(shouldCheck(now - 60_000, now), false);
  assert.equal(shouldCheck(now - UPDATE_CHECK_EVERY_MS, now), true);
  assert.equal(shouldCheck(now - 60_000, now, true), true);
  // Un reloj que retrocedió no deja la app sin preguntar para siempre.
  assert.equal(shouldCheck(now + 60_000, now), true);
});

test("una versión más nueva es una actualización", () => {
  assert.deepEqual(parseRelease({ release }, 6), release);
});

test("la misma o una anterior no", () => {
  assert.equal(parseRelease({ release }, 7), null);
  assert.equal(parseRelease({ release }, 8), null);
  assert.equal(parseRelease({ release: null }, 6), null);
});

test("respuestas con otra forma no se aceptan", () => {
  for (const bad of [
    { ...release, sha256: "xyz" },
    { ...release, version: "0.4" },
    { ...release, version_code: 7.5 },
    { ...release, size_bytes: 0 },
    { ...release, download_url: "javascript:alert(1)" },
    { ...release, download_url: "file:///data/evil.apk" },
    { ...release, download_url: "http://r2.example/x.apk" },
  ]) {
    assert.equal(parseRelease({ release: bad }, 6), null, JSON.stringify(bad));
  }
});

test("http solo si se permite (desarrollo, servidor en el Mac)", () => {
  const local = { ...release, download_url: "http://localhost:9010/x.apk" };
  assert.equal(parseRelease({ release: local }, 6), null);
  assert.equal(parseRelease({ release: local }, 6, { allowHttp: true })?.version_code, 7);
});

test("nombre del archivo y tamaño", () => {
  assert.equal(updateFileName(release), "book-0.4.3-7.apk");
  assert.equal(formatSize(52_000_000), "50 MB");
  assert.equal(formatSize(10), "1 MB");
});
