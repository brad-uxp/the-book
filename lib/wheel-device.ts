/**
 * Tells a mouse wheel from two fingers on a trackpad.
 *
 * The canvas zooms with the mouse wheel and pans with two fingers, but the
 * browser reports both as the same `wheel` event — there is no field that
 * says which device sent it. So each gesture is judged by what its events
 * look like, from what real hardware sends:
 *
 * - A classic notched wheel in Chrome reports 120 per notch in the legacy
 *   `wheelDeltaY` (with an accelerated `deltaY`, 4.000244140625 for a slow
 *   notch on a Mac). Firefox, asked for `deltaMode` first, reports lines.
 *   Either is certainly a wheel.
 * - Many mice are continuous instead (the owner's, in Chrome 152 on macOS:
 *   one event per notch of 12–13 px, 44–130 ms apart, legacy exactly -3 ×
 *   deltaY — the same arithmetic as a trackpad, which is why the legacy delta
 *   alone cannot tell them apart). Safari derives every legacy delta that way.
 * - A trackpad reports at the display's rate, about every 10 ms; a gesture
 *   starts with a pixel or two, often on both axes.
 *
 * A Magic Mouse is a trackpad by all of these, so it pans — as it scrolls
 * everywhere else.
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
 * The least one wheel notch moves: 4 px for a slow notch on a Mac. A trackpad
 * gesture starts smaller, with the first pixel or two of the fingers' travel.
 */
export const MIN_NOTCH_PX = 4;

/**
 * Events closer together than this come from a trackpad, which reports at
 * the display's rate. Wheel notches arrive 40 ms apart or more even when the
 * wheel is spun fast.
 */
export const TRACKPAD_INTERVAL_MS = 20;

interface Verdict {
  device: WheelDevice;
  /** Decided by something only one device does; never revised. */
  certain: boolean;
}

/** What the first event of a gesture says about the device. */
function judgeFirstEvent(e: WheelSample): Verdict {
  // Read first: Firefox reports lines only to code that asks for the mode
  // before the deltas. Lines and pages come from notched wheels.
  if (e.deltaMode !== 0) return { device: "mouse", certain: true };

  // Two axes at once is fingers. (Shift + wheel scrolls sideways on some
  // systems; it lands here too, and panning sideways is the right answer.)
  if (e.deltaX !== 0) return { device: "trackpad", certain: true };

  // Whole notches of a classic wheel: a multiple of 120 that is not merely
  // three times the pixels, as every continuous device's is.
  const legacy = e.wheelDeltaY;
  if (
    legacy !== undefined &&
    legacy !== 0 &&
    legacy % 120 === 0 &&
    Math.abs(legacy + 3 * e.deltaY) > 1.5
  ) {
    return { device: "mouse", certain: true };
  }

  // Continuous: a notch's worth at once is a wheel, a pixel or two is fingers.
  return {
    device: Math.abs(e.deltaY) >= MIN_NOTCH_PX ? "mouse" : "trackpad",
    certain: false,
  };
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
 * wheel rests, so one gesture never flips between zoom and pan. The one
 * exception: a gesture taken for a wheel on size alone switches to the
 * trackpad as soon as its events come at the trackpad's rate — a fast swipe
 * can start with a notch-sized movement, but no wheel sends every 10 ms.
 */
export function createWheelDeviceTracker(gapMs: number = WHEEL_GESTURE_GAP_MS) {
  let current: Verdict | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;

  return (e: WheelSample, now: number): WheelDevice => {
    const interval = now - lastAt;
    lastAt = now;
    if (current === null || interval > gapMs) {
      current = judgeFirstEvent(e);
    } else if (
      !current.certain &&
      current.device === "mouse" &&
      interval < TRACKPAD_INTERVAL_MS
    ) {
      current = { device: "trackpad", certain: true };
    }
    return current.device;
  };
}
