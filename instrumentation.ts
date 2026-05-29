/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * We use it to register the in-process daily scheduler that replaces the old
 * Vercel cron. Guarded to the Node.js runtime and production only so it never
 * runs during `next dev` or in the edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  // Opt-out hatch in case you ever move scheduling to an external trigger.
  if (process.env.DISABLE_INAPP_CRON === "1") return;

  const { scheduleDailyCron } = await import("@/lib/daily-scheduler");
  scheduleDailyCron();
}
