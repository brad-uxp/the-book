/*
 * Kill switch for the retired PWA service worker. Not an app worker.
 *
 * TheBook was a PWA until 2026-09-27: a serwist worker at this same URL and
 * scope precached the app shell and every JS chunk. Deleting the file would
 * not remove it from browsers that installed it — a registered worker whose
 * script now 404s keeps running, and it would keep serving a previous build's
 * cached shell and chunks, which breaks the site after a deploy.
 *
 * Browsers re-check this URL on navigation. Finding a different script, they
 * install this one, which takes over at once and then:
 *   1. deletes every Cache Storage entry the old worker left (this origin has
 *      no other use for Cache Storage);
 *   2. unregisters itself, so nothing controls the site any more;
 *   3. reloads open tabs, so they are served fresh from the network.
 *
 * It must stay at /sw.js, reachable without a session (proxy.ts leaves it
 * out) and never cached (next.config.ts), or the update check cannot reach it.
 *
 * Safe to delete, together with components/service-worker-cleanup.tsx, once
 * every device that had the PWA has visited the site since — a few weeks
 * after 2026-09-27 is plenty for a single-user app.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(
        windows.map((client) => client.navigate(client.url).catch(() => {}))
      );
    })()
  );
});
