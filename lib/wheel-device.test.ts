import { describe, it, expect } from "vitest";
import {
  WHEEL_GESTURE_GAP_MS,
  createWheelDeviceTracker,
  wheelDevice,
  zoomAtPoint,
  type WheelSample,
} from "./wheel-device";

// Firmas de eventos reales: lo que Chrome y Safari reportan para cada
// dispositivo (ver la cabecera del módulo).
const trackpad = (deltaY: number, deltaX = 0): WheelSample => ({
  deltaMode: 0,
  deltaX,
  deltaY,
  wheelDeltaY: Math.trunc(-3 * deltaY),
});
const macNotch = (notches: number, deltaY: number): WheelSample => ({
  deltaMode: 0,
  deltaX: 0,
  deltaY,
  wheelDeltaY: -120 * notches,
});

describe("wheelDevice", () => {
  it.each([
    ["trackpad, vertical", trackpad(6)],
    ["trackpad, hacia arriba", trackpad(-14)],
    ["trackpad, fracción de píxel", trackpad(2.5)],
    ["trackpad, movimiento mínimo (legacy truncado a 0)", trackpad(0.25)],
    ["trackpad, en diagonal", trackpad(3, 4)],
    ["trackpad, solo horizontal", trackpad(0, -8)],
    ["trackpad con la página ampliada (píxeles reescalados)", { deltaMode: 0, deltaX: 0, deltaY: 5.45, wheelDeltaY: -18 }],
  ])("%s → trackpad", (_label, e) => {
    expect(wheelDevice(e)).toBe("trackpad");
  });

  it.each([
    ["Mac, una muesca lenta", macNotch(1, 4.000244140625)],
    ["Mac, muesca hacia arriba", macNotch(-1, -4.000244140625)],
    ["Mac, varias muescas aceleradas", macNotch(3, 36.00219726)],
    ["Windows, una muesca", macNotch(1, 100)],
    ["Firefox, en líneas", { deltaMode: 1, deltaX: 0, deltaY: 3 }],
    ["Firefox, en páginas", { deltaMode: 2, deltaX: 0, deltaY: 1 }],
    ["sin delta legacy: conserva el zoom", { deltaMode: 0, deltaX: 0, deltaY: 40 }],
  ])("%s → mouse", (_label, e) => {
    expect(wheelDevice(e)).toBe("mouse");
  });

  it("una muesca acelerada suelta puede parecer trackpad (por eso se juzga por gesto)", () => {
    expect(wheelDevice(macNotch(1, 40))).toBe("trackpad");
  });
});

describe("createWheelDeviceTracker", () => {
  it("un gesto de mouse sigue siendo mouse aunque un evento del medio parezca trackpad", () => {
    const track = createWheelDeviceTracker();
    expect(track(macNotch(1, 4.000244140625), 0)).toBe("mouse");
    expect(track(macNotch(1, 40), 30)).toBe("mouse");
    expect(track(macNotch(2, 80), 60)).toBe("mouse");
  });

  it("un gesto de trackpad, con su inercia, sigue siendo trackpad", () => {
    const track = createWheelDeviceTracker();
    expect(track(trackpad(2), 0)).toBe("trackpad");
    // Un evento cuyo legacy cae en múltiplo de 120 (40 px exactos).
    expect(track({ deltaMode: 0, deltaX: 0, deltaY: 50, wheelDeltaY: -120 }, 16)).toBe("trackpad");
    // La inercia sigue llegando después de levantar los dedos.
    for (let t = 32; t < 1500; t += 16) {
      expect(track(trackpad(1), t)).toBe("trackpad");
    }
  });

  it("después de una pausa, el siguiente gesto se juzga de nuevo", () => {
    const track = createWheelDeviceTracker();
    expect(track(trackpad(6), 0)).toBe("trackpad");
    expect(track(macNotch(1, 4.000244140625), WHEEL_GESTURE_GAP_MS + 1)).toBe("mouse");
    expect(track(trackpad(6), 2 * WHEEL_GESTURE_GAP_MS + 2)).toBe("trackpad");
  });

  it("dentro de la pausa, no cambia de dispositivo", () => {
    const track = createWheelDeviceTracker();
    expect(track(trackpad(6), 0)).toBe("trackpad");
    expect(track(macNotch(1, 4.000244140625), WHEEL_GESTURE_GAP_MS)).toBe("trackpad");
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
