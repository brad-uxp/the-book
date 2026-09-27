/**
 * Tells a mouse wheel from two fingers on a trackpad.
 *
 * The canvas zooms with the mouse wheel and pans with two fingers, but the
 * browser reports both as the same `wheel` event — there is no field that
 * says which device sent it. What differs is how the numbers are made:
 *
 * - A notched wheel moves in whole notches. Chrome and Safari report them in
 *   the legacy `wheelDeltaY` as 120 per notch, while `deltaY` carries the
 *   system's accelerated distance (on a Mac, 4.000244140625 for a slow notch).
 *   Firefox, when asked for `deltaMode` first, reports it in lines.
 * - A trackpad is continuous. Chrome and Safari derive its legacy delta from
 *   the pixels, as exactly -3 × `deltaY` (give or take the rounding to an
 *   integer), and it often moves on both axes at once.
 *
 * A Magic Mouse is continuous too, so it pans — as it scrolls everywhere else.
 */

export type WheelDevice = "mouse" | "trackpad";

/** The fields of a WheelEvent the decision reads. */
export interface WheelSample {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  /** Non-standard (Chrome, Safari): 120 per wheel notch. */
  wheelDeltaY?: number;
}

/** Which device one wheel event most likely came from. */
export function wheelDevice(e: WheelSample): WheelDevice {
  // Read first: Firefox reports lines only to code that asks for the mode
  // before the deltas. Lines and pages come from notched wheels.
  if (e.deltaMode !== 0) return "mouse";

  // Two axes at once is fingers. (Shift + wheel scrolls sideways on some
  // systems; it lands here too, and panning sideways is the right answer.)
  if (e.deltaX !== 0) return "trackpad";

  const legacy = e.wheelDeltaY;
  if (legacy === undefined) {
    // No legacy delta to judge by: keep the wheel's behaviour, zooming.
    return "mouse";
  }

  // A continuous device: the legacy delta is derived from the pixels. It is
  // truncated to an integer, so allow for the rounding.
  if (Math.abs(legacy + 3 * e.deltaY) <= 1.5) return "trackpad";

  // Whole notches.
  if (legacy !== 0 && legacy % 120 === 0) return "mouse";

  // Anything else is a continuous device whose pixels were rescaled (the
  // page is zoomed), or a movement too small for a notch.
  return "trackpad";
}

export interface WheelViewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * The viewport after one mouse-wheel event zooms it around a point, given in
 * flow coordinates: that point stays under the cursor. The step is d3-zoom's
 * (what React Flow's own wheel zoom uses), so it feels the same as before.
 */
export function zoomAtPoint(
  viewport: WheelViewport,
  point: { x: number; y: number },
  e: Pick<WheelSample, "deltaMode" | "deltaY">,
  limits: { min: number; max: number }
): WheelViewport {
  const step = -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002);
  const zoom = Math.min(limits.max, Math.max(limits.min, viewport.zoom * 2 ** step));
  return {
    // The point sits at point × zoom + offset on screen; keep that fixed.
    x: viewport.x + point.x * (viewport.zoom - zoom),
    y: viewport.y + point.y * (viewport.zoom - zoom),
    zoom,
  };
}

/**
 * How long the wheel must rest before the next movement is judged afresh.
 * Longer than the gap between events of one gesture — including a trackpad's
 * momentum, which keeps sending after the fingers lift — and far shorter than
 * it takes to move a hand from the mouse to the trackpad.
 */
export const WHEEL_GESTURE_GAP_MS = 250;

/**
 * Judges each gesture by its first event and keeps that answer until the
 * wheel rests. Single events can be ambiguous — a fast notch on a Mac can
 * look exactly like a trackpad's pixels — but the first event of a gesture is
 * the slow one, and one gesture never switches device halfway through.
 */
export function createWheelDeviceTracker(gapMs: number = WHEEL_GESTURE_GAP_MS) {
  let current: WheelDevice | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;

  return (e: WheelSample, now: number): WheelDevice => {
    if (current === null || now - lastAt > gapMs) current = wheelDevice(e);
    lastAt = now;
    return current;
  };
}
