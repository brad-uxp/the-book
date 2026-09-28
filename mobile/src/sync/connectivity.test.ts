import { test } from "node:test";
import assert from "node:assert/strict";
import { isOnline } from "./connectivity.ts";

test("en línea según Android, sin esperar la prueba de alcance a internet", () => {
  assert.equal(isOnline({ isConnected: true }), true);
  assert.equal(isOnline({ isConnected: false }), false);
  // Primer evento, todavía sin saber: se intenta y la request decide.
  assert.equal(isOnline({ isConnected: null }), true);
});

test("un 'sin internet' viejo de NetInfo no frena la vuelta de la red", () => {
  // Así llegaba al reconectar: red sí, alcance todavía el de antes (false).
  assert.equal(isOnline({ isConnected: true, isInternetReachable: false } as { isConnected: boolean }), true);
});
