import { NextResponse } from "next/server";
import { requireUserSession } from "@/lib/api";
import { listConnections } from "@/lib/oauth-service";

export const runtime = "nodejs";

/** The apps connected to theBook's MCP through OAuth. The owner's, in the browser only. */
export async function GET() {
  const denied = await requireUserSession();
  if (denied) return denied;
  return NextResponse.json(await listConnections());
}
