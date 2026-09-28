import { NextRequest, NextResponse } from "next/server";
import { requireSession, readJsonLimited, invalid } from "@/lib/api";
import { getActorEmail } from "@/lib/audit";
import { SyncPushSchema } from "@/lib/validations";
import { SYNC_PUSH_MAX_BYTES } from "@/lib/sync-protocol";
import { pullNotes, pushNotes } from "@/lib/sync-server";

/**
 * The phone's offline notes: pull what changed, push what it changed.
 * The protocol is lib/sync-protocol.ts; the rules lib/sync.ts.
 *
 * Any caller the API accepts may use it — the phone's token, another token, a
 * browser session. It reads and writes nothing the issue routes do not; every
 * write goes through the same services and lands in the audit log as the
 * caller.
 */

/** One page of what changed since `?since=<cursor>` (none: everything). */
export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const page = await pullNotes(req.nextUrl.searchParams.get("since"));
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Applies up to 200 changes in order and answers each — or a prefix of them,
 * with `more`, when the answer grows past its budget (lib/sync-server.ts).
 * The body is read with a cap: a long note is tens of kilobytes, a push of
 * them a few megabytes at most.
 */
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = await readJsonLimited(req, SYNC_PUSH_MAX_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? NextResponse.json({ error: "Push too large" }, { status: 413 })
      : NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = SyncPushSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  const { results, more } = await pushNotes(parsed.data.mutations, await getActorEmail());
  return NextResponse.json(more ? { results, more } : { results });
}
