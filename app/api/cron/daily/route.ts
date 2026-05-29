import { NextRequest, NextResponse } from "next/server";
import { runDailyJob } from "@/lib/run-daily";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/daily
 * Protected by CRON_SECRET. Kept for external/manual triggering; the in-process
 * scheduler in `instrumentation.ts` runs the same job daily without HTTP.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const log = await runDailyJob();
    console.log(log.join("\n"));
    return NextResponse.json({ ok: true, log });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/daily] ERROR: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
