import { test } from "node:test";
import assert from "node:assert/strict";
import { readPushPayload, shouldShowInForeground, targetFor } from "./payload.ts";

const ID = "3f2c9a4e-1b2d-4c8e-9f00-0a1b2c3d4e5f";

test("lee el push tal como lo entrega expo-notifications en Android (RemoteMessage serializado)", () => {
  const task = {
    collapseKey: "com.bolstro.book",
    data: { dataString: null, kind: "notification", id: ID },
    from: "348255215221",
    notification: null,
    priority: 1,
  };
  assert.deepEqual(readPushPayload(task), { kind: "notification", id: ID });
});

test("también el mapa directo y un dataString con JSON", () => {
  assert.deepEqual(readPushPayload({ kind: "test" }), { kind: "test" });
  assert.deepEqual(readPushPayload({ data: { dataString: JSON.stringify({ kind: "notification", id: ID }) } }), {
    kind: "notification",
    id: ID,
  });
});

test("cualquier otra cosa se ignora", () => {
  for (const bad of [null, undefined, "x", {}, { data: {} }, { data: { kind: "notification" } }, { data: { kind: "notification", id: "../../etc" } }, { data: { kind: "sync" } }, { data: { dataString: "{nope" } }]) {
    assert.equal(readPushPayload(bad), null, JSON.stringify(bad));
  }
});

test("a dónde lleva tocar la notificación", () => {
  assert.deepEqual(targetFor("invoice", "inv-1"), { screen: "invoice", id: "inv-1" });
  assert.deepEqual(targetFor("issue", "t-1"), { screen: "issue", id: "t-1" });
  assert.deepEqual(targetFor("person", "p-1"), { screen: "salaries" });
  assert.deepEqual(targetFor("salary_increase_reminder", "r-1"), { screen: "salaries" });
  assert.deepEqual(targetFor("subscription", "s-1"), { screen: "home" });
  assert.deepEqual(targetFor("invoice", "no/valid"), { screen: "home" });
  assert.equal(targetFor("something-else", "x"), null);
});

test("en primer plano solo se muestran las notificaciones con título (nunca el push vacío)", () => {
  assert.equal(shouldShowInForeground({ title: "Invoice due: Avatar", body: "…" }), true);
  assert.equal(shouldShowInForeground({ title: null, body: null }), false);
  assert.equal(shouldShowInForeground({ title: "  " }), false);
});
