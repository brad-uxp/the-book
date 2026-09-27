"use client";

import { useEffect } from "react";

/**
 * Second half of the PWA removal, alongside the kill-switch worker at
 * public/sw.js: any service worker still registered on this origin is
 * unregistered, and whatever it cached is deleted.
 *
 * The kill switch only runs once the browser re-checks /sw.js; this covers a
 * tab that loads before that happens. Both are no-ops once a browser is clean.
 *
 * Delete together with public/sw.js a few weeks after 2026-09-27.
 */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        if (registrations.length === 0) return;
        await Promise.all(registrations.map((r) => r.unregister()));
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      })
      .catch(() => {
        // Nothing to do: the kill-switch worker covers the same ground.
      });
  }, []);

  return null;
}
