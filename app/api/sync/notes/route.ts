import { NextRequest, NextResponse } from "next/server";
import { requireSyncSession, readJsonLimited, invalid, resolveActor, type Actor } from "@/lib/api";
import { getActorEmail } from "@/lib/audit";
import { withKeyLock } from "@/lib/keyed-lock";
import { checkRateLimit, refundRateLimit } from "@/lib/rate-limit";
import { SyncPushSchema } from "@/lib/validations";
import { SYNC_PUSH_MAX_BYTES } from "@/lib/sync-protocol";
import { SYNC_MUTATIONS_PER_MINUTE } from "@/lib/sync";
import { pullNotes, pushNotes } from "@/lib/sync-server";

/** Who a push's budget and lock belong to: a token, or the browser's user. */
function syncKey(actor: Actor | null): string {
  return actor?.kind === "token" ? `sync:token:${actor.id}` : "sync:user";
}

/**
 * The phone's offline notes: pull what changed, push what it changed.
 * The protocol is lib/sync-protocol.ts; the rules lib/sync.ts.
 *
 * The phone's token or a browser session may use it — not a hand-made
 * automation token (requireSyncSession). It reads and writes nothing the
 * issue routes do not; every write goes through the same services and lands
 * in the audit log as the caller.
 */

/** One page of what changed since `?since=<cursor>` (none: everything). */
export async function GET(req: NextRequest) {
  const denied = await requireSyncSession();
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
  const denied = await requireSyncSession();
  if (denied) return denied;

  const body = await readJsonLimited(req, SYNC_PUSH_MAX_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? NextResponse.json({ error: "Push too large" }, { status: 413 })
      : NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = SyncPushSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  // Charged per change, not per request: the changes are the work.
  const key = syncKey(await resolveActor());
  const mutations = parsed.data.mutations;
  const budget = checkRateLimit(key, Date.now(), SYNC_MUTATIONS_PER_MINUTE, 60_000, mutations.length);
  if (!budget.allowed) {
    return NextResponse.json(
      { error: "Too many changes pushed; try again shortly" },
      { status: 429, headers: { "Retry-After": String(budget.retryAfterSeconds) } }
    );
  }

  // One push per caller at a time: each holds a database connection while it
  // runs, and a burst from one token must not take the pool from the web.
  const actorEmail = await getActorEmail();
  const { results, more } = await withKeyLock(key, () => pushNotes(mutations, actorEmail));
  // Changes left unanswered (the push stopped early) will be sent again:
  // they are charged then, not now.
  refundRateLimit(key, mutations.length - results.length);
  return NextResponse.json(more ? { results, more } : { results });
}
