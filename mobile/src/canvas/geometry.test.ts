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
  edgeScreenPaths,
  fitView,
  grabRadius,
  pinchView,
  pinchStep,
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

test("zoom lejano: el centro de una tarjeta chica la agarra a ella, no a un punto", () => {
  const b = box("a", 0, 0, 280, 70);
  const far = { x: 0, y: 0, z: 0.57 };
  const center = { x: 140, y: 35 };
  const r = grabRadius(b, far, center.x, center.y, 26);
  // 70 × 0.57 ≈ 40 px tall on screen: a quarter of it is ~10 px.
  assert.ok(r < 11, String(r));
  const sx = center.x * far.z;
  const sy = center.y * far.z;
  assert.equal(dotAt(b, far, sx, sy, r), null);
  // Just outside the bottom edge, the full radius still finds the dot.
  assert.equal(grabRadius(b, far, 140, 75, 26), 26);
  assert.equal(dotAt(b, far, 140 * 0.57, 75 * 0.57, 26), "bottom");
});

test("zoom cercano: dentro de una tarjeta grande el radio completo vale", () => {
  const b = box("a", 0, 0, 280, 160);
  assert.equal(grabRadius(b, { x: 0, y: 0, z: 1.5 }, 140, 150, 26), 26);
});

test("una conexión en pantalla, con la vista identidad, es la misma que en el mundo", () => {
  const e = edgePath({ x: 0, y: 0, width: 200, height: 80 }, { x: 400, y: 200, width: 200, height: 80 }, "bottom", "left");
  const s = edgeScreenPaths(e.points, { x: 0, y: 0, z: 1 });
  assert.equal(s.d, e.d);
  assert.equal(s.arrow, e.arrow);
});

test("una conexión en pantalla sigue a la vista: cada punto es toScreen del punto del mundo", () => {
  const e = edgePath({ x: 0, y: 0, width: 200, height: 80 }, { x: 900, y: 600, width: 200, height: 80 });
  const v = { x: 30, y: -12, z: 0.5 };
  const s = edgeScreenPaths(e.points, v);
  const a = toScreen(v, e.start.x, e.start.y);
  const b = toScreen(v, e.end.x, e.end.y);
  assert.ok(s.d.startsWith(`M${a.x},${a.y} C`), s.d);
  assert.ok(s.d.endsWith(` ${b.x},${b.y}`), s.d);
  assert.ok(s.arrow.startsWith(`M${b.x},${b.y} L`), s.arrow);
});

test("la flecha escala con el zoom, como cuando la dibujaba el mundo", () => {
  const e = edgePath({ x: 0, y: 0, width: 200, height: 80 }, { x: 600, y: 0, width: 200, height: 80 });
  const corners = (arrow: string) => arrow.match(/-?[\d.]+,-?[\d.]+/g)!.map((p) => p.split(",").map(Number));
  const [tip1, c1] = corners(edgeScreenPaths(e.points, { x: 0, y: 0, z: 1 }).arrow);
  const [tip2, c2] = corners(edgeScreenPaths(e.points, { x: 0, y: 0, z: 2 }).arrow);
  const len = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  assert.ok(Math.abs(len(tip2, c2) - 2 * len(tip1, c1)) < 0.05);
});

// Secuencias grabadas en el emulador (2026-09-28, RNGH en Android): la última
// actualización de un pellizco trae un solo dedo y el foco salta a ese dedo.
test("pellizco: al levantar un dedo el lienzo no salta", () => {
  const start = { x: 24, y: 353.8, z: 0.324 };
  let anchor = { view: start, focal: { x: 205.7, y: 418.6 }, scale: 1, pointers: 2 };
  let view = start;
  for (const s of [1.108, 1.275, 1.549]) {
    ({ view, anchor } = pinchStep(anchor, view, { x: 205.7, y: 418.6 }, s, 2));
  }
  const before = view;
  // Se levanta el dedo izquierdo: foco en el derecho, misma escala.
  ({ view, anchor } = pinchStep(anchor, view, { x: 331.4, y: 418.6 }, 1.549, 1));
  assert.ok(Math.abs(view.x - before.x) < 1e-9 && Math.abs(view.y - before.y) < 1e-9, `saltó a ${view.x},${view.y}`);
  assert.equal(view.z, before.z);
});

test("pellizco: el dedo que queda sigue moviendo el lienzo, sin saltos", () => {
  let anchor = { view: { x: 0, y: 0, z: 1 }, focal: { x: 200, y: 400 }, scale: 1, pointers: 2 };
  let view = anchor.view;
  ({ view, anchor } = pinchStep(anchor, view, { x: 200, y: 400 }, 1.5, 2));
  const afterPinch = view;
  ({ view, anchor } = pinchStep(anchor, view, { x: 320, y: 400 }, 1.5, 1)); // se levanta uno
  ({ view, anchor } = pinchStep(anchor, view, { x: 300, y: 430 }, 1.5, 1)); // el otro se mueve
  assert.ok(Math.abs(view.x - afterPinch.x + 20) < 1e-9 && Math.abs(view.y - afterPinch.y - 30) < 1e-9);
  assert.equal(view.z, afterPinch.z);
});

test("pellizco: si el segundo dedo vuelve, sigue desde donde está, sin saltos", () => {
  let anchor = { view: { x: 10, y: 20, z: 1 }, focal: { x: 100, y: 100 }, scale: 1, pointers: 2 };
  let view = anchor.view;
  ({ view, anchor } = pinchStep(anchor, view, { x: 100, y: 100 }, 1.2, 2));
  ({ view, anchor } = pinchStep(anchor, view, { x: 160, y: 100 }, 1.2, 1));
  const one = view;
  ({ view, anchor } = pinchStep(anchor, view, { x: 130, y: 110 }, 1.2, 2)); // vuelve el dedo
  assert.ok(Math.abs(view.x - one.x) < 1e-9 && Math.abs(view.y - one.y) < 1e-9 && view.z === one.z);
  ({ view, anchor } = pinchStep(anchor, view, { x: 130, y: 110 }, 1.5, 2)); // y sigue pellizcando: la escala cuenta desde ahí
  assert.ok(Math.abs(view.z - one.z * 1.25) < 1e-9, `z=${view.z}`);
});
