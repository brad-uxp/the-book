import { runDailyJob } from "@/lib/run-daily";

/**
 * In-process daily scheduler. Replaces the Vercel cron (`vercel.json`) that
 * stopped firing when the app moved off Vercel to Railway. Fires once per day
 * at TARGET_UTC_HOUR — the same 13:00 UTC the Vercel cron used.
 *
 * Self-correcting: each run schedules the next one, so clock drift never
 * accumulates. Idempotent against multiple instances/restarts — payment
 * creation is guarded by a partial unique index and notifications by upsert,
 * so an extra run in a day is harmless.
 */
const TARGET_UTC_HOUR = 13;

let scheduled = false;

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(TARGET_UTC_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function scheduleDailyCron(): void {
  if (scheduled) return; // guard against double registration in one process
  scheduled = true;

  const scheduleNext = () => {
    const ms = msUntilNextRun();
    const timer = setTimeout(tick, ms);
    // Don't keep the process alive just for this timer; the HTTP server already
    // keeps the event loop running, and this lets shutdown proceed cleanly.
    timer.unref?.();
    console.log(`[daily-scheduler] next run in ~${Math.round(ms / 60000)} min`);
  };

  const tick = async () => {
    try {
      const log = await runDailyJob();
      console.log("[daily-scheduler] job complete\n" + log.join("\n"));
    } catch (err) {
      console.error("[daily-scheduler] job failed:", err);
    } finally {
      scheduleNext();
    }
  };

  scheduleNext();
  console.log("[daily-scheduler] registered (target " + TARGET_UTC_HOUR + ":00 UTC)");
}
