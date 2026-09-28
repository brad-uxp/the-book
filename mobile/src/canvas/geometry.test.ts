import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionAnchors, sideAnchor } from "../../../lib/canvas-geometry.ts";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  cardAt,
  clampZoom,
  distanceToEdge,
  dotAt,
  dotPoints,
  edgePath,
  fitView,
  pinchView,
  toScreen,
  toWorld,
  type CardBox,
} from "./geometry.ts";

const box = (id: string, x: number, y: number, w = 200, h = 80): CardBox => ({ id, x, y, w, h });

test("mundo ↔ pantalla son inversos", () => {
  const v = { x: 30, y: -12, z: 0.75 };
  const s = toScreen(v, 100, 40);
  assert.deepEqual(toWorld(v, s.x, s.y), { x: 100, y: 40 });
});

test("el zoom queda entre los límites de la web", () => {
  assert.equal(clampZoom(10), MAX_ZOOM);
  assert.equal(clampZoom(0.01), MIN_ZOOM);
  assert.equal(clampZoom(1.3), 1.3);
});

test("pellizco: el punto del mundo bajo los dedos sigue bajo los dedos, aunque se muevan", () => {
  const start = { x: 10, y: 20, z: 1 };
  const focal0 = { x: 150, y: 300 };
  const worldUnder = toWorld(start, focal0.x, focal0.y);
  const focal = { x: 180, y: 260 };
  const v = pinchView(start, focal0, focal, 1.6);
  assert.equal(v.z, 1.6);
  const back = toScreen(v, worldUnder.x, worldUnder.y);
  assert.ok(Math.abs(back.x - focal.x) < 1e-9 && Math.abs(back.y - focal.y) < 1e-9);
});

test("la tarjeta de arriba (la última dibujada) gana el toque", () => {
  const boxes = [box("a", 0, 0), box("b", 100, 40)];
  assert.equal(cardAt(boxes, 150, 60), 1);
  assert.equal(cardAt(boxes, 10, 10), 0);
  assert.equal(cardAt(boxes, 500, 500), -1);
});

test("los puntos de conexión son los de la web (sideAnchor)", () => {
  const b = box("a", 12, 34, 280, 96);
  for (const p of dotPoints(b)) {
    const a = sideAnchor({ x: b.x, y: b.y, width: b.w, height: b.h }, p.side);
    assert.deepEqual({ x: p.x, y: p.y }, { x: a.x, y: a.y });
  }
});

test("un punto se agarra dentro de un radio en píxeles de pantalla, a cualquier zoom", () => {
  const b = box("a", 0, 0, 200, 80);
  const far = { x: 0, y: 0, z: 0.5 };
  // Right dot at world (200, 40) → screen (100, 20) at z 0.5.
  assert.equal(dotAt(b, far, 110, 25, 22), "right");
  assert.equal(dotAt(b, far, 140, 25, 22), null);
  assert.equal(dotAt(b, { x: 0, y: 0, z: 2 }, 400 - 15, 80, 22), "right");
});

test("la línea arranca y termina donde dicen los anclajes compartidos, y la flecha apunta a la tarjeta", () => {
  const from = { x: 0, y: 0, width: 200, height: 80 };
  const to = { x: 400, y: 0, width: 200, height: 80 };
  const e = edgePath(from, to);
  const { start, end } = connectionAnchors(from, to);
  assert.deepEqual([e.start, e.end], [start, end]);
  assert.match(e.d, /^M200,40 C/);
  assert.match(e.arrow, /^M400,40 /);
  // Horizontal line: the mid point sits halfway.
  assert.ok(Math.abs(e.mid.x - 300) < 1e-9 && Math.abs(e.mid.y - 40) < 1e-9);
});

test("con lados fijados, cada extremo sale del medio de su lado", () => {
  const from = { x: 0, y: 0, width: 200, height: 80 };
  const to = { x: 400, y: 300, width: 200, height: 80 };
  const e = edgePath(from, to, "bottom", "left");
  assert.deepEqual({ x: e.start.x, y: e.start.y, side: e.start.side }, { x: 100, y: 80, side: "bottom" });
  assert.deepEqual({ x: e.end.x, y: e.end.y, side: e.end.side }, { x: 400, y: 340, side: "left" });
});

test("tocar la línea: cerca de la curva es poca distancia, lejos es mucha", () => {
  const e = edgePath({ x: 0, y: 0, width: 200, height: 80 }, { x: 400, y: 200, width: 200, height: 80 });
  assert.ok(distanceToEdge(e.mid, e) < 1);
  assert.ok(distanceToEdge({ x: e.start.x, y: e.start.y }, e) < 1e-9);
  assert.ok(distanceToEdge({ x: 300, y: -200 }, e) > 100);
});

test("encuadrar: todo entra, centrado, sin pasar de zoom 1", () => {
  const boxes = [box("a", -100, -50, 200, 80), box("b", 900, 600, 200, 80)];
  const v = fitView(boxes, 400, 800, 24);
  for (const b of boxes) {
    const tl = toScreen(v, b.x, b.y);
    const br = toScreen(v, b.x + b.w, b.y + b.h);
    assert.ok(tl.x >= 23.99 && tl.y >= 0 && br.x <= 376.01 && br.y <= 800);
  }
  const one = fitView([box("a", 0, 0, 100, 40)], 400, 800);
  assert.equal(one.z, 1);
  assert.deepEqual(toScreen(one, 50, 20), { x: 200, y: 400 });
});

test("encuadrar un canvas vacío deja el origen a la vista", () => {
  assert.deepEqual(fitView([], 400, 900), { x: 200, y: 300, z: 1 });
});
