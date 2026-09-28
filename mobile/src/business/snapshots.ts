import { write } from "@/db/database";

/**
 * Writes to the business snapshots (table business_cache) — apart from the
 * hooks in ./cache so the sync provider can clear them without importing
 * screen code.
 */

export function saveCached(key: string, payload: unknown): Promise<void> {
  return write(["business_cache"], async (db) => {
    await db.runAsync(
      `INSERT INTO business_cache (key, payload, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
      [key, JSON.stringify(payload), new Date().toISOString()]
    );
  });
}

/**
 * Forgets every business snapshot. Called whenever the session ends — a 401
 * (the token revoked from Settings, say, because the phone was lost) as much
 * as signing out: unlike unsent notes there is nothing here the person wrote,
 * so nothing is lost by dropping it.
 */
export function clearBusinessCache(): Promise<void> {
  return write(["business_cache"], async (db) => {
    await db.runAsync("DELETE FROM business_cache");
  });
}
