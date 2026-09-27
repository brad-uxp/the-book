import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SettingsPatchSchema } from "@/lib/validations";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";

const DEFAULTS = {
  days_before_subscription: 2,
  days_before_salary: 4,
  days_before_invoice: 0,
  corporate_excluded_client_ids: [] as string[],
};

/** What the audit log keeps of the settings: every field a person can change. */
function snapshot(s: typeof DEFAULTS) {
  return {
    days_before_subscription: s.days_before_subscription,
    days_before_salary: s.days_before_salary,
    days_before_invoice: s.days_before_invoice,
    corporate_excluded_client_ids: s.corporate_excluded_client_ids,
  };
}

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  return NextResponse.json(settings ?? { id: "singleton", ...DEFAULTS });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const parsed = SettingsPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  // Every excluded id must be a client that exists. The UI only offers real
  // clients; this is for API callers, where a stale or mistyped id would
  // silently exclude nothing while the report says a client is left out.
  const ids = parsed.data.corporate_excluded_client_ids;
  if (ids && ids.length > 0) {
    const found = await prisma.client.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const known = new Set(found.map((c) => c.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unknown client ids: ${unknown.join(", ")}` },
        { status: 400 }
      );
    }
  }

  try {
    const before = await prisma.settings.findUnique({ where: { id: "singleton" } });
    const settings = await prisma.settings.upsert({
      where: { id: "singleton" },
      update: parsed.data,
      create: { id: "singleton", ...DEFAULTS, ...parsed.data },
    });

    // Settings steer money figures (which clients count as corporate income)
    // and when alerts fire, so a change is worth a line in the history.
    auditLog({
      entity_type: "settings",
      entity_id: "singleton",
      entity_name: "Settings",
      action: "update",
      actor_email: await getActorEmail(),
      before: snapshot(before ?? DEFAULTS),
      after: snapshot(settings),
    });

    return NextResponse.json(settings);
  } catch (err) {
    return toApiResponse(err);
  }
}
