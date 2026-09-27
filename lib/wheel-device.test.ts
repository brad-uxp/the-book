import { describe, it, expect } from "vitest";
import {
  WHEEL_GESTURE_GAP_MS,
  createWheelDeviceTracker,
  wheelDevice,
  zoomAtPoint,
  type WheelSample,
} from "./wheel-device";

// Grabaciones reales, tomadas con la sonda de rueda del canvas (2026-09-27,
// Chrome 152 en macOS): [ms desde el inicio del gesto, deltaX, deltaY,
// wheelDeltaY]. El mouse del dueño es continuo: legacy = -3 × deltaY, igual
// que el trackpad.
type Rec = [t: number, dx: number, dy: number, wdy: number][];
const OWNER_MOUSE_SLOW: Rec = [[0, 0, 12, -36], [58, 0, 13, -39], [153, 0, 13, -39]];
const OWNER_MOUSE_FAST: Rec = [
  [0, 0, 13, -39], [130, 0, 13, -39], [216, 0, 13, -39], [263, 0, 13, -39],
  [330, 0, 28, -84], [386, 0, 56, -168], [516, 0, 13, -39],
];
const OWNER_MOUSE_UP: Rec = [
  [0, 0, -12, 36], [72, 0, -13, 39], [131, 0, -13, 39],
  [175, 0, -45, 135], [250, 0, -62, 186], [311, 0, -88, 264],
];
const OWNER_TRACKPAD: Rec = [
  [0, 1, 0, 0], [17, 2, 1, -3], [20, 2, 1, -3], [29, 2, 1, -3], [39, 2, 1, -3],
  [50, 2, 1, -3], [60, 2, 1, -3], [70, 2, 1, -3], [80, 2, 1, -3], [90, 2, 1, -3],
  [100, 2, 1, -3], [110, 1, 1, -3], [120, 1, 1, -3], [130, 1, 1, -3],
];

/** Pasa una grabación por un tracker y devuelve lo que decidió en cada evento. */
function replay(rec: Rec, start = 0, track = createWheelDeviceTracker()) {
  return rec.map(([t, dx, dy, wdy]) =>
    track({ deltaMode: 0, deltaX: dx, deltaY: dy, wheelDeltaY: wdy }, start + t)
  );
}
const all = (device: string, n: number) => Array(n).fill(device);

const notch = (notches: number, deltaY: number): WheelSample => ({
  deltaMode: 0,
  deltaX: 0,
  deltaY,
  wheelDeltaY: -120 * notches,
});

describe("con el hardware del dueño", () => {
  it.each([
    ["muescas lentas", OWNER_MOUSE_SLOW],
    ["giro rápido", OWNER_MOUSE_FAST],
    ["hacia arriba, acelerando", OWNER_MOUSE_UP],
  ])("el mouse, %s → zoom en todo el gesto", (_label, rec) => {
    expect(replay(rec)).toEqual(all("mouse", rec.length));
  });

  it("el trackpad con dos dedos → pan en todo el gesto", () => {
    expect(replay(OWNER_TRACKPAD)).toEqual(all("trackpad", OWNER_TRACKPAD.length));
  });

  it("alternando: trackpad, pausa, mouse, pausa, trackpad", () => {
    const track = createWheelDeviceTracker();
    expect(replay(OWNER_TRACKPAD, 0, track)).toEqual(all("trackpad", OWNER_TRACKPAD.length));
    expect(replay(OWNER_MOUSE_SLOW, 1000, track)).toEqual(all("mouse", OWNER_MOUSE_SLOW.length));
    expect(replay(OWNER_TRACKPAD, 2000, track)).toEqual(all("trackpad", OWNER_TRACKPAD.length));
  });
});

describe("wheelDevice (primer evento de un gesto)", () => {
  it.each([
    ["Chrome, rueda clásica, muesca lenta", notch(1, 4.000244140625)],
    ["Chrome, rueda clásica, hacia arriba", notch(-1, -4.000244140625)],
    ["Chrome, rueda clásica, muescas aceleradas", notch(3, 36.00219726)],
    ["Windows, una muesca", notch(1, 100)],
    ["Firefox, en líneas", { deltaMode: 1, deltaX: 0, deltaY: 3 }],
    ["Firefox, en páginas", { deltaMode: 2, deltaX: 0, deltaY: 1 }],
    ["mouse continuo (legacy = -3 × píxeles)", { deltaMode: 0, deltaX: 0, deltaY: 12, wheelDeltaY: -36 }],
    ["Safari, una muesca (legacy siempre -3 ×)", { deltaMode: 0, deltaX: 0, deltaY: 4.000244140625, wheelDeltaY: -12 }],
    ["sin delta legacy, una muesca", { deltaMode: 0, deltaX: 0, deltaY: 40 }],
  ])("%s → mouse", (_label, e) => {
    expect(wheelDevice(e)).toBe("mouse");
  });

  it.each([
    ["trackpad, arranca en horizontal", { deltaMode: 0, deltaX: 1, deltaY: 0, wheelDeltaY: 0 }],
    ["trackpad, en diagonal", { deltaMode: 0, deltaX: 2, deltaY: 1, wheelDeltaY: -3 }],
    ["trackpad, vertical puro y lento", { deltaMode: 0, deltaX: 0, deltaY: 1, wheelDeltaY: -3 }],
    ["trackpad, fracción de píxel", { deltaMode: 0, deltaX: 0, deltaY: 0.25, wheelDeltaY: 0 }],
    ["trackpad, solo horizontal", { deltaMode: 0, deltaX: -8, deltaY: 0, wheelDeltaY: 0 }],
  ])("%s → trackpad", (_label, e) => {
    expect(wheelDevice(e)).toBe("trackpad");
  });
});

describe("createWheelDeviceTracker", () => {
  it("un deslizamiento rápido que arranca grande pasa a pan en cuanto llega al ritmo del trackpad", () => {
    const flick: Rec = [[0, 0, 15, -45], [10, 0, 22, -66], [20, 0, 30, -90], [30, 0, 26, -78]];
    expect(replay(flick)).toEqual(["mouse", "trackpad", "trackpad", "trackpad"]);
  });

  it("una rueda clásica girada rápido sigue siendo mouse (es seguro, no se revisa)", () => {
    const spin: Rec = [[0, 0, 4.000244140625, -120], [12, 0, 8.00048828125, -240], [24, 0, 12.000732421875, -360]];
    expect(replay(spin)).toEqual(["mouse", "mouse", "mouse"]);
  });

  it("un gesto de trackpad no se vuelve mouse aunque un evento del medio sea grande", () => {
    const swipe: Rec = [[0, 1, 1, -3], [10, 0, 40, -120], [20, 0, 60, -180]];
    expect(replay(swipe)).toEqual(["trackpad", "trackpad", "trackpad"]);
  });

  it("después de una pausa, el siguiente gesto se juzga de nuevo", () => {
    const track = createWheelDeviceTracker();
    expect(track({ deltaMode: 0, deltaX: 1, deltaY: 0 }, 0)).toBe("trackpad");
    expect(track(notch(1, 4.000244140625), WHEEL_GESTURE_GAP_MS + 1)).toBe("mouse");
  });

  it("dentro de la pausa, no cambia de dispositivo", () => {
    const track = createWheelDeviceTracker();
    expect(track({ deltaMode: 0, deltaX: 1, deltaY: 0 }, 0)).toBe("trackpad");
    expect(track(notch(1, 4.000244140625), WHEEL_GESTURE_GAP_MS)).toBe("trackpad");
  });
});

describe("zoomAtPoint", () => {
  const limits = { min: 0.2, max: 2 };
  const onScreen = (v: { x: number; y: number; zoom: number }, p: { x: number; y: number }) => ({
    x: p.x * v.zoom + v.x,
    y: p.y * v.zoom + v.y,
  });

  it("acerca con la rueda hacia arriba y aleja hacia abajo", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    expect(zoomAtPoint(v, { x: 0, y: 0 }, { deltaMode: 0, deltaY: -100 }, limits).zoom).toBeCloseTo(2 ** 0.2);
    expect(zoomAtPoint(v, { x: 0, y: 0 }, { deltaMode: 0, deltaY: 100 }, limits).zoom).toBeCloseTo(2 ** -0.2);
  });

  it("el punto bajo el cursor no se mueve", () => {
    const v = { x: 120, y: -40, zoom: 0.8 };
    const p = { x: 350, y: 210 };
    const next = zoomAtPoint(v, p, { deltaMode: 0, deltaY: -4.000244140625 }, limits);
    const before = onScreen(v, p), after = onScreen(next, p);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("respeta los límites de zoom", () => {
    expect(zoomAtPoint({ x: 0, y: 0, zoom: 1.9 }, { x: 10, y: 10 }, { deltaMode: 0, deltaY: -1000 }, limits).zoom).toBe(2);
    expect(zoomAtPoint({ x: 0, y: 0, zoom: 0.3 }, { x: 10, y: 10 }, { deltaMode: 0, deltaY: 1000 }, limits).zoom).toBe(0.2);
  });

  it("en el límite no desplaza el lienzo", () => {
    const v = { x: 5, y: 7, zoom: 2 };
    expect(zoomAtPoint(v, { x: 300, y: 300 }, { deltaMode: 0, deltaY: -50 }, limits)).toEqual(v);
  });

  it("Firefox en líneas usa el paso de d3 (0.05 por línea)", () => {
    expect(zoomAtPoint({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, { deltaMode: 1, deltaY: -3 }, limits).zoom).toBeCloseTo(2 ** 0.15);
  });
});
