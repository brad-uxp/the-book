/**
 * Tells a mouse wheel from two fingers on a trackpad.
 *
 * The canvas zooms with the mouse wheel and pans with two fingers, but the
 * browser reports both as the same `wheel` event — there is no field that
 * says which device sent it. So each gesture is judged by what its events
 * look like, from what real hardware sends (recorded with the canvas wheel
 * probe on the owner's Mac, Chrome 152):
 *
 * - A classic notched wheel in Chrome reports 120 per notch in the legacy
 *   `wheelDeltaY` (with an accelerated `deltaY`, 4.000244140625 for a slow
 *   notch on a Mac). Firefox, asked for `deltaMode` first, reports lines.
 *   Either is certainly a wheel.
 * - Many mice are continuous instead. The owner's sends 11–309 px per event,
 *   straight down or up (deltaX always 0), with legacy exactly -3 × deltaY —
 *   the same arithmetic as a trackpad. Spun at a normal pace its events come
 *   every ~10 ms, the trackpad's rate, so timing cannot tell them apart.
 *   Safari derives every legacy delta that way too.
 * - A trackpad gesture starts with a pixel or two and moves sideways too, a
 *   little, on almost every event; its momentum ends in single pixels.
 *
 * A pinch arrives with ctrlKey set and is not judged here: it always zooms.
 * A Magic Mouse behaves like a trackpad by all of these, so it pans — as it
 * scrolls everywhere else.
 */

export type WheelDevice = "mouse" | "trackpad";

/** The fields of a WheelEvent the decision reads. */
export interface WheelSample {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  /** Non-standard (Chrome, Safari): 120 per notch for a classic wheel. */
  wheelDeltaY?: number;
}

/**
 * The least one wheel event moves: 4 px for a slow notch on a Mac (11 px on
 * the owner's continuous mouse). Anything between 0 and this is fingers.
 */
export const MIN_NOTCH_PX = 4;

interface Verdict {
  device: WheelDevice;
  /** Decided by something only one device does; never revised. */
  certain: boolean;
}

/** What no wheel ever sends: a sideways movement, or less than a notch. */
function looksLikeFingers(e: WheelSample): boolean {
  return e.deltaX !== 0 || (e.deltaY !== 0 && Math.abs(e.deltaY) < MIN_NOTCH_PX);
}

/** What the first event of a gesture says about the device. */
function judgeFirstEvent(e: WheelSample): Verdict {
  // Read first: Firefox reports lines only to code that asks for the mode
  // before the deltas. Lines and pages come from notched wheels.
  if (e.deltaMode !== 0) return { device: "mouse", certain: true };

  // Whole notches of a classic wheel: a multiple of 120 that is not merely
  // three times the pixels, as every continuous device's is.
  const legacy = e.wheelDeltaY;
  if (
    e.deltaX === 0 &&
    legacy !== undefined &&
    legacy !== 0 &&
    legacy % 120 === 0 &&
    Math.abs(legacy + 3 * e.deltaY) > 1.5
  ) {
    return { device: "mouse", certain: true };
  }

  // Sideways, or a pixel or two: fingers. (Shift + wheel scrolls sideways on
  // some systems; it lands here too, and panning sideways is right for it.)
  if (looksLikeFingers(e)) return { device: "trackpad", certain: true };

  // A notch's worth, straight up or down: a wheel, unless the gesture later
  // shows it was fingers after all.
  return { device: e.deltaY !== 0 ? "mouse" : "trackpad", certain: false };
}

/** Which device one wheel event, taken as the first of a gesture, came from. */
export function wheelDevice(e: WheelSample): WheelDevice {
  return judgeFirstEvent(e).device;
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
 * wheel rests, so one gesture does not flip between zoom and pan. The one
 * exception: a gesture taken for a wheel on size alone becomes a trackpad
 * gesture as soon as it does something no wheel does (moves sideways, or by
 * less than a notch) — a swipe that starts with a big vertical movement.
 * Never on timing: a wheel spun at a normal pace sends as often as fingers.
 */
export function createWheelDeviceTracker(gapMs: number = WHEEL_GESTURE_GAP_MS) {
  let current: Verdict | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;

  return (e: WheelSample, now: number): WheelDevice => {
    const fresh = current === null || now - lastAt > gapMs;
    lastAt = now;
    if (fresh || current === null) {
      current = judgeFirstEvent(e);
    } else if (!current.certain && looksLikeFingers(e)) {
      current = { device: "trackpad", certain: true };
    }
    return current.device;
  };
}
