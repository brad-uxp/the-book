"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs `load` on mount, then on an interval, and exposes a manual refresh.
 *
 * Four components were hand-rolling this and all of them shared the same two
 * defects: nothing aborted the in-flight request on unmount (so a late
 * response called setState on a dead component), and failures were swallowed
 * so a broken endpoint looked like "no notifications".
 *
 * `load` is read through a ref, so callers do not have to memoise it and a
 * changing closure never restarts the interval.
 *
 * @param intervalMs  polling period; null to fetch once on mount.
 * @param resetKey    changing this aborts the current request and reloads —
 *                    needed when `load` targets a different resource, since
 *                    the ref above deliberately hides closure changes.
 * @returns a function that triggers an immediate reload.
 */
export function usePolling(
  load: (signal: AbortSignal) => Promise<void>,
  intervalMs: number | null = 60_000,
  resetKey?: unknown
): () => void {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    const run = () => {
      loadRef.current(controller.signal).catch((err) => {
        if (controller.signal.aborted) return;
        console.error("[polling] request failed:", err);
      });
    };

    run();
    const id =
      intervalMs === null ? null : setInterval(run, intervalMs);

    return () => {
      controller.abort();
      if (id !== null) clearInterval(id);
    };
  }, [nonce, intervalMs, resetKey]);

  return refresh;
}
