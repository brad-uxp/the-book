import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callerHasOwnerReach, requireSession } from "@/lib/api";
import { READONLY_AUDIT_ENTITY_TYPES } from "@/lib/readonly-token";

export async function GET(req: NextRequest) {
  const denied = await requireSession({ readonly: req });
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50") || 50));
  const entity_type = searchParams.get("entity_type") || undefined;
  const action = searchParams.get("action") || undefined;
  const search = searchParams.get("search") || undefined;

  // The log holds more than the books — issue titles, deleted canvas ideas,
  // tokens, OAuth consents — so a caller without the owner's reach (a
  // read-only token) gets only the books' entries, whatever it filters by.
  const booksOnly = !(await callerHasOwnerReach());

  const where = {
    ...(entity_type ? { entity_type } : {}),
    ...(action ? { action } : {}),
    ...(search ? { entity_name: { contains: search, mode: "insensitive" as const } } : {}),
    ...(booksOnly ? { AND: [{ entity_type: { in: [...READONLY_AUDIT_ENTITY_TYPES] } }] } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total });
}
