import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession } from "@/lib/api";

const RoleSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const roles = await prisma.role.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(roles);
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = await req.json();
  const parsed = RoleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const role = await prisma.role.create({ data: { name: parsed.data.name } });

  auditLog({
    entity_type: "role",
    entity_id: role.id,
    entity_name: role.name,
    action: "create",
    actor_email: await getActorEmail(),
    after: { name: role.name },
  });

  return NextResponse.json(role, { status: 201 });
}
