import { describe, it, expect } from "vitest";
import {
  WHEEL_GESTURE_GAP_MS,
  createWheelDeviceTracker,
  wheelDevice,
  zoomAtPoint,
  type WheelSample,
} from "./wheel-device";

// Grabaciones reales, tomadas con la sonda de rueda del canvas (2026-09-27,
// Chrome 152 en macOS, el hardware del dueño): [ms desde el inicio del gesto,
// deltaX, deltaY, wheelDeltaY]. El mouse es continuo (legacy = -3 × deltaY,
// igual que el trackpad) y, girado a ritmo normal, manda cada ~10 ms: ni el
// legacy ni el ritmo lo distinguen del trackpad.
type Rec = [t: number, dx: number, dy: number, wdy: number][];
const OWNER_MOUSE: Record<string, Rec> = {
  "lento, muesca a muesca": [[0, 0, 12, -36], [102.1, 0, 13, -39], [194.2, 0, 13, -39], [312.7, 0, 13, -39], [418.5, 0, 13, -39], [479.7, 0, 13, -39], [539.2, 0, 13, -39], [620.4, 0, 23, -69], [802.6, 0, 13, -39]],
  "lento, acelerando hacia arriba": [[0, 0, -12, 36], [52.9, 0, -13, 39], [83, 0, -36, 108], [122.9, 0, -75, 225], [183, 0, -99, 297], [273.6, 0, -103, 309], [336.2, 0, -103, 309], [386.3, 0, -103, 309], [446.6, 0, -102, 306], [491.5, 0, -103, 309], [596.8, 0, -13, 39]],
  "normal (antes: 2 zoom, 8 pan)": [[0, 0, -12, 36], [39.1, 0, -13, 39], [49, 0, -96, 288], [69.1, 0, -103, 309], [88.9, 0, -103, 309], [109.1, 0, -103, 309], [129.1, 0, -102, 306], [158.8, 0, -103, 309], [190.9, 0, -103, 309], [334.3, 0, -13, 39]],
  "normal (antes: 6 zoom, 4 pan)": [[0, 0, 12, -36], [90.4, 0, 13, -39], [119.5, 0, 25, -75], [140.9, 0, 86, -258], [170.3, 0, 103, -309], [200.3, 0, 102, -306], [214.9, 0, 103, -309], [255.4, 0, 103, -309], [284.1, 0, 103, -309], [330.5, 0, 103, -309]],
  "normal (antes: 3 zoom, 7 pan)": [[0, 0, -12, 36], [25.3, 0, -71, 213], [55.3, 0, -103, 309], [65.3, 0, -103, 309], [75.4, 0, -103, 309], [85.2, 0, -102, 306], [95.1, 0, -103, 309], [114.3, 0, -103, 309], [135.2, 0, -103, 309], [224.3, 0, -103, 309]],
  "normal, con un evento doble (antes: 2 zoom, 8 pan)": [[0, 0, -12, 36], [39.7, 0, -13, 39], [49.7, 0, -103, 309], [69.6, 0, -103, 309], [79, 0, -103, 309], [99.8, 0, -205, 615], [108.8, 0, -103, 309], [119.7, 0, -103, 309], [148.9, 0, -103, 309], [202.2, 0, -102, 306]],
  "normal (antes: 3 zoom, 8 pan)": [[0, 0, 12, -36], [39.8, 0, 13, -39], [69.3, 0, 67, -201], [89.2, 0, 103, -309], [100.1, 0, 103, -309], [110, 0, 103, -309], [130, 0, 102, -306], [148.6, 0, 103, -309], [164.8, 0, 103, -309], [189.9, 0, 103, -309], [242.2, 0, 103, -309]],
  "rápido, evento triple": [[0, 0, -13, 39], [20, 0, -34, 102], [29.9, 0, -309, 927], [39.9, 0, -205, 615], [49.8, 0, -103, 309], [59.9, 0, -103, 309], [69.8, 0, -103, 309]],
  "rápido, cada 10 ms": [[0, 0, -13, 39], [11.1, 0, -102, 306], [19.9, 0, -206, 618], [29.9, 0, -103, 309], [39.9, 0, -103, 309], [49, 0, -102, 306], [69.9, 0, -103, 309]],
  "rápido, ida y vuelta sin pausa": [[0, 0, -11, 33], [19.7, 0, -73, 219], [30.4, 0, -103, 309], [39.5, 0, -102, 306], [50.4, 0, -103, 309], [60.4, 0, -103, 309], [70.4, 0, -103, 309], [80.3, 0, -103, 309], [90.3, 0, -205, 615], [130.3, 0, -103, 309], [207.6, 0, 102, -306], [229.8, 0, 103, -309], [236, 0, 102, -306], [252.2, 0, 103, -309], [260.1, 0, 103, -309], [270.4, 0, 103, -309], [280.3, 0, 103, -309], [289.7, 0, 205, -615], [300.3, 0, 103, -309], [310.3, 0, 103, -309], [320.3, 0, 103, -309], [447.6, 0, -12, 36], [462.7, 0, -71, 213], [471.2, 0, -103, 309]],
};
// Dos dedos, de la primera grabación: casi todos los eventos llevan algo de
// horizontal y arrancan con uno o dos píxeles.
const OWNER_TRACKPAD: Rec = [
  [0, 1, 0, 0], [17, 2, 1, -3], [20, 2, 1, -3], [29, 2, 1, -3], [39, 2, 1, -3],
  [50, 2, 1, -3], [60, 2, 1, -3], [70, 2, 1, -3], [80, 2, 1, -3], [90, 2, 1, -3],
  [100, 2, 1, -3], [110, 1, 1, -3], [120, 1, 1, -3], [130, 1, 1, -3],
];

// Más gestos de dos dedos, de la sonda v4 (lento, normal y rápido).
const OWNER_TRACKPAD_MORE: Record<string, Rec> = {
  "lento, vertical casi puro": [[0, 0, 1, -3], [11, 0, 1, -3], [30.2, 1, 1, -3], [41, 1, 1, -3], [51.1, 1, 1, -3], [60.9, 1, 1, -3], [70.2, 0, 1, -3], [80.4, 1, 1, -3], [91.1, 0, 1, -3], [101, 0, 1, -3], [111, 0, 1, -3], [120.3, 1, 1, -3], [131.1, 1, 1, -3], [141.1, 0, 1, -3], [151.1, 0, 1, -3]],
  "normal, en círculo": [[0, 0, 1, -3], [13.2, 0, 2, -6], [21.5, -1, 3, -9], [29.5, -1, 5, -15], [39.7, -1, 6, -18], [49.7, -1, 7, -21], [59.8, -1, 6, -18], [69.7, -1, 6, -18], [78.8, -1, 6, -18], [89, 0, 5, -15], [99.2, 0, 5, -15], [108.7, 0, 6, -18], [119.7, 1, 4, -12], [129.2, 1, 6, -18]],
  // Arranca con 1 px y después la inercia es vertical pura, 80–88 px por
  // evento sin nada de horizontal: lo que una regla por tamaño tomaría por
  // una rueda si juzgara a mitad de gesto.
  "rápido, con inercia vertical larga": [[0, 0, 1, -3], [13.3, 0, 4, -12], [22.9, -1, 6, -18], [33.2, -1, 8, -24], [43.2, -1, 12, -36], [53.2, -1, 26, -78], [63.3, -1, 48, -144], [73.4, -1, 56, -168], [83.4, -1, 64, -192], [93.4, -2, 75, -225], [103.2, -3, 73, -219], [119.1, -4, 54, -162], [129.1, -4, 44, -132], [138.9, -5, 36, -108], [148.9, 0, 80, -240], [159.1, 0, 85, -255], [169.1, 0, 88, -264], [179.6, 0, 85, -255], [189.8, 0, 82, -246], [200, 0, 81, -243], [209.9, 0, 75, -225], [219.9, 0, 72, -216], [235.6, 0, 71, -213], [343.1, 0, 55, -165], [353.1, 0, 103, -308], [364.3, 0, 49, -147]],
  "rápido, de costado": [[0, 1, 0, 0], [11.3, 2, 0, 0], [20.3, 4, -1, 3], [29.6, 4, -1, 3], [40.6, 5, -1, 3], [49.7, 10, -1, 3], [59.3, 13, -1, 3], [70.3, 15, 0, 0], [80.9, 17, 0, 0], [90.3, 19, 1, -3], [100.3, 21, 1, -3], [110.4, 26, 2, -6], [120.2, 30, 2, -6]],
};

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
  it.each(Object.entries(OWNER_MOUSE))("el mouse, %s → zoom en todo el gesto", (_label, rec) => {
    expect(replay(rec)).toEqual(all("mouse", rec.length));
  });

  it("el trackpad con dos dedos → pan en todo el gesto", () => {
    expect(replay(OWNER_TRACKPAD)).toEqual(all("trackpad", OWNER_TRACKPAD.length));
  });

  it.each(Object.entries(OWNER_TRACKPAD_MORE))("el trackpad, %s → pan en todo el gesto", (_label, rec) => {
    expect(replay(rec)).toEqual(all("trackpad", rec.length));
  });

  it("alternando: trackpad, pausa, mouse rápido, pausa, trackpad", () => {
    const track = createWheelDeviceTracker();
    const fast = OWNER_MOUSE["rápido, cada 10 ms"];
    expect(replay(OWNER_TRACKPAD, 0, track)).toEqual(all("trackpad", OWNER_TRACKPAD.length));
    expect(replay(fast, 1000, track)).toEqual(all("mouse", fast.length));
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
  it("un deslizamiento que arranca grande y vertical pasa a pan en cuanto se mueve de costado", () => {
    const swipe: Rec = [[0, 0, 15, -45], [10, 0, 22, -66], [20, 1, 30, -90], [30, 0, 26, -78]];
    expect(replay(swipe)).toEqual(["mouse", "mouse", "trackpad", "trackpad"]);
  });

  it("…o en cuanto mueve menos que una muesca (la cola de la inercia)", () => {
    const swipe: Rec = [[0, 0, 15, -45], [10, 0, 9, -27], [20, 0, 3, -9], [30, 0, 1, -3]];
    expect(replay(swipe)).toEqual(["mouse", "mouse", "trackpad", "trackpad"]);
  });

  it("el ritmo no cuenta: un mouse que manda cada 10 ms sigue siendo mouse", () => {
    const spin: Rec = [[0, 0, 13, -39], [10, 0, 103, -309], [20, 0, 102, -306], [30, 0, 206, -618], [40, 0, 103, -309]];
    expect(replay(spin)).toEqual(all("mouse", spin.length));
  });

  it("una rueda clásica es segura: no se revisa", () => {
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
