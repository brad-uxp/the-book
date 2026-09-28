import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceAppVersion } from "./version.ts";

test("nombre y código de la build instalada", () => {
  assert.equal(deviceAppVersion({ name: "0.5.1", code: 8 }), "0.5.1+8");
});

test("dos builds con el mismo nombre se distinguen por el código", () => {
  assert.notEqual(deviceAppVersion({ name: "0.5.0", code: 7 }), deviceAppVersion({ name: "0.5.0", code: 10 }));
});

test("lo que el servidor no aceptaría no se manda", () => {
  assert.equal(deviceAppVersion({ name: "0.5.1 beta", code: 8 }), undefined);
  assert.equal(deviceAppVersion({ name: "x".repeat(40), code: 8 }), undefined);
});
