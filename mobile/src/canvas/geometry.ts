/**
 * The canvas's geometry on the phone: the viewport, what is under a finger,
 * and the path of a connection.
 *
 * Where a connection meets a card is the web's rule, from the shared
 * lib/canvas-geometry (`connectionAnchors`); the curve is React Flow's
 * bezier, re-derived here so both platforms draw the same line.
 *
 * The hit tests run as worklets — on the UI thread, inside the gesture, so a
 * touch knows at once whether it pans, moves a card or starts a connection.
 * A worklet can only call other worklets, so they are self-contained (the
 * dot positions repeat lib's `sideAnchor`; a test keeps them equal).
 *
 * Pure (no React Native), so `node --test` runs it; the "worklet" directives
 * are plain strings there.
 */
import { connectionAnchors, type EdgeAnchor, type Rect, type Side } from "../../../lib/canvas-geometry.ts";

export type { Rect, Side };

/** How far out and in the canvas zooms — the web's limits. */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;

/** Screen point = world point × z + (x, y). */
export interface View {
  x: number;
  y: number;
  z: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A card as the hit tests see it, in world coordinates. */
export interface CardBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clampZoom(z: number): number {
  "worklet";
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function toWorld(view: View, sx: number, sy: number): Point {
  "worklet";
  return { x: (sx - view.x) / view.z, y: (sy - view.y) / view.z };
}

export function toScreen(view: View, wx: number, wy: number): Point {
  "worklet";
  return { x: wx * view.z + view.x, y: wy * view.z + view.y };
}

/**
 * The view during a pinch: the world point that was under the fingers when it
 * started stays under them — so moving both fingers pans while they zoom.
 */
export function pinchView(start: View, focal0: Point, focal: Point, scale: number): View {
  "worklet";
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, start.z * scale));
  const wx = (focal0.x - start.x) / start.z;
  const wy = (focal0.y - start.y) / start.z;
  return { x: focal.x - wx * z, y: focal.y - wy * z, z };
}

/**
 * Where a pinch measures from: the view, focal point and cumulative scale at
 * the moment the fingers last changed, and how many fingers there were.
 */
export interface PinchAnchor {
  view: View;
  focal: Point;
  scale: number;
  pointers: number;
}

/**
 * One pinch update. When a finger lifts (or lands again) the focal point jumps
 * to the new centroid — on Android the last update of a pinch has one finger
 * and the focal point is that finger, half the fingers' distance away — so a
 * change in the number of fingers re-anchors at the current view instead of
 * moving it. The remaining finger then pans on from where the view is, and
 * the scale counts only from the re-anchor on.
 */
export function pinchStep(
  anchor: PinchAnchor,
  current: View,
  focal: Point,
  scale: number,
  pointers: number
): { view: View; anchor: PinchAnchor } {
  "worklet";
  const a =
    pointers === anchor.pointers ? anchor : { view: current, focal, scale, pointers };
  const view = pinchView(a.view, a.focal, focal, a.scale > 0 ? scale / a.scale : 1);
  return { view, anchor: a };
}

/** The topmost card under a world point (the last one drawn wins), or -1. */
export function cardAt(boxes: CardBox[], wx: number, wy: number): number {
  "worklet";
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return i;
  }
  return -1;
}

/** Where a card's four connection dots are: the middle of each side. */
export function dotPoints(box: CardBox): { side: Side; x: number; y: number }[] {
  "worklet";
  return [
    { side: "top", x: box.x + box.w / 2, y: box.y },
    { side: "right", x: box.x + box.w, y: box.y + box.h / 2 },
    { side: "bottom", x: box.x + box.w / 2, y: box.y + box.h },
    { side: "left", x: box.x, y: box.y + box.h / 2 },
  ];
}

/**
 * The dot of a card under a screen point — within `radius` screen pixels, so
 * a fingertip finds it at any zoom — or null. The nearest when two qualify.
 */
export function dotAt(box: CardBox, view: View, sx: number, sy: number, radius: number): Side | null {
  "worklet";
  const pts = [
    { side: "top" as Side, x: box.x + box.w / 2, y: box.y },
    { side: "right" as Side, x: box.x + box.w, y: box.y + box.h / 2 },
    { side: "bottom" as Side, x: box.x + box.w / 2, y: box.y + box.h },
    { side: "left" as Side, x: box.x, y: box.y + box.h / 2 },
  ];
  let best: Side | null = null;
  let bestD = radius;
  for (const p of pts) {
    const dx = p.x * view.z + view.x - sx;
    const dy = p.y * view.z + view.y - sy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= bestD) {
      bestD = d;
      best = p.side;
    }
  }
  return best;
}

/**
 * How far from a dot a touch still grabs it, in screen pixels. Outside the
 * card, the full `radius` — a fingertip is wide. Inside it, never more than a
 * quarter of the card's smaller side on screen: zoomed out, a card can be a
 * few fingertips tall, and its middle must still pick up the card, not a dot.
 */
export function grabRadius(box: CardBox, view: View, wx: number, wy: number, radius: number): number {
  "worklet";
  const inside = wx >= box.x && wx <= box.x + box.w && wy >= box.y && wy <= box.y + box.h;
  if (!inside) return radius;
  return Math.min(radius, 0.25 * Math.min(box.w, box.h) * view.z);
}

// ── Connections ──────────────────────────────────────────────────────────────

export interface EdgePath {
  /** SVG path, world coordinates. */
  d: string;
  start: EdgeAnchor;
  end: EdgeAnchor;
  c1: Point;
  c2: Point;
  /** Middle of the curve — where a selected connection's buttons go. */
  mid: Point;
  /** The arrowhead at `end`, as a closed SVG path. */
  arrow: string;
  /** The curve and arrowhead as plain numbers, for `edgeScreenPaths`. */
  points: EdgePoints;
}

/**
 * A connection in world units, flattened so a worklet can carry it to the UI
 * thread: `[start, c1, c2, end, arrow corner, arrow corner]`, x then y each.
 * The arrowhead's tip is `end`.
 */
export type EdgePoints = readonly number[];

/** React Flow's `calculateControlOffset`, curvature 0.25. */
function controlOffset(distance: number): number {
  return distance >= 0 ? 0.5 * distance : 0.25 * 25 * Math.sqrt(-distance);
}

function control(a: EdgeAnchor, other: Point): Point {
  switch (a.side) {
    case "left":
      return { x: a.x - controlOffset(a.x - other.x), y: a.y };
    case "right":
      return { x: a.x + controlOffset(other.x - a.x), y: a.y };
    case "top":
      return { x: a.x, y: a.y - controlOffset(a.y - other.y) };
    case "bottom":
      return { x: a.x, y: a.y + controlOffset(other.y - a.y) };
  }
}

const ARROW_LENGTH = 10;
const ARROW_HALF_WIDTH = 5;

/** The two base corners of an arrowhead with its tip at `tip`, pointing away from `from`. */
function arrowCorners(tip: Point, from: Point): [Point, Point] {
  let dx = tip.x - from.x;
  let dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const bx = tip.x - dx * ARROW_LENGTH;
  const by = tip.y - dy * ARROW_LENGTH;
  const px = -dy * ARROW_HALF_WIDTH;
  const py = dx * ARROW_HALF_WIDTH;
  return [
    { x: bx + px, y: by + py },
    { x: bx - px, y: by - py },
  ];
}

/** A closed arrowhead with its tip at `tip`, pointing away from `from`. */
export function arrowHead(tip: Point, from: Point): string {
  const [a, b] = arrowCorners(tip, from);
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(tip.x)},${f(tip.y)} L${f(a.x)},${f(a.y)} L${f(b.x)},${f(b.y)} Z`;
}

/** The inward normal of a side: which way a line pinned there points into the card. */
function inward(side: Side): Point {
  switch (side) {
    case "top":
      return { x: 0, y: 1 };
    case "bottom":
      return { x: 0, y: -1 };
    case "left":
      return { x: 1, y: 0 };
    case "right":
      return { x: -1, y: 0 };
  }
}

/** The line between two cards, pinned to their sides where the connection says so. */
export function edgePath(from: Rect, to: Rect, sourceSide: Side | null = null, targetSide: Side | null = null): EdgePath {
  const { start, end } = connectionAnchors(from, to, sourceSide, targetSide);
  const c1 = control(start, end);
  const c2 = control(end, start);
  const f = (n: number) => Math.round(n * 100) / 100;
  const d = `M${f(start.x)},${f(start.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(end.x)},${f(end.y)}`;
  const mid = {
    x: start.x * 0.125 + c1.x * 0.375 + c2.x * 0.375 + end.x * 0.125,
    y: start.y * 0.125 + c1.y * 0.375 + c2.y * 0.375 + end.y * 0.125,
  };
  // The arrow follows the curve's last stretch; when the last control point
  // sits on the end itself, it points straight into the card.
  const n = inward(end.side);
  const tail = Math.hypot(c2.x - end.x, c2.y - end.y) > 0.5 ? c2 : { x: end.x - n.x, y: end.y - n.y };
  const [a1, a2] = arrowCorners(end, tail);
  const points = [start.x, start.y, c1.x, c1.y, c2.x, c2.y, end.x, end.y, a1.x, a1.y, a2.x, a2.y];
  return { d, start, end, c1, c2, mid, arrow: arrowHead(end, tail), points };
}

/**
 * A connection's curve and arrowhead as the screen draws them, through the
 * current view.
 *
 * Connections are drawn in screen space, in one screen-sized <Svg>, not in
 * the zoomed world: react-native-svg paints an Svg into a bitmap of its
 * layout size, and an Svg the size of every card spread out asked Android for
 * 243 MB on the owner's phone (Canvas: trying to draw too large bitmap — the
 * limit is ~100 MB) and crashed the app. Screen-sized, it is a few MB at any
 * canvas size, and lines stay sharp zoomed in. The line and arrow scale with
 * the zoom as they did in the world.
 *
 * A worklet: the view changes every frame of a pan or pinch.
 */
export function edgeScreenPaths(p: EdgePoints, view: View): { d: string; arrow: string } {
  "worklet";
  const r = (n: number) => Math.round(n * 100) / 100;
  const sx = (i: number) => r(p[i] * view.z + view.x);
  const sy = (i: number) => r(p[i] * view.z + view.y);
  return {
    d: `M${sx(0)},${sy(1)} C${sx(2)},${sy(3)} ${sx(4)},${sy(5)} ${sx(6)},${sy(7)}`,
    arrow: `M${sx(6)},${sy(7)} L${sx(8)},${sy(9)} L${sx(10)},${sy(11)} Z`,
  };
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How far a world point is from a connection's curve — for tapping a line. */
export function distanceToEdge(p: Point, e: EdgePath, samples = 32): number {
  let best = Infinity;
  let prev = e.start as Point;
  for (let i = 1; i <= samples; i++) {
    const q = cubicAt(e.start, e.c1, e.c2, e.end, i / samples);
    best = Math.min(best, segmentDistance(p, prev, q));
    prev = q;
  }
  return best;
}

// ── Framing ──────────────────────────────────────────────────────────────────

export function bounds(boxes: CardBox[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The view that shows every card, centred, with `pad` screen pixels around —
 * never zoomed in past 1 (a single small card should not fill the phone).
 */
export function fitView(boxes: CardBox[], width: number, height: number, pad = 24): View {
  const b = bounds(boxes);
  if (!b || width <= 0 || height <= 0) return { x: width / 2, y: height / 3, z: 1 };
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const z = Math.min(1, clampZoom(Math.min((width - pad * 2) / bw, (height - pad * 2) / bh)));
  return {
    z,
    x: (width - bw * z) / 2 - b.minX * z,
    y: (height - bh * z) / 2 - b.minY * z,
  };
}
