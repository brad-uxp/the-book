import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { loadRefs } from "@/lib/sync-server";

/**
 * Clients, people and invoices in their smallest form: what the phone needs to
 * label a note's client and offer @person and #invoice mentions without a
 * connection. Replaced whole on each fetch — a few hundred rows at most.
 */
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  return NextResponse.json(await loadRefs(), { headers: { "Cache-Control": "no-store" } });
}
