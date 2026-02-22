import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { auditLog } from "@/lib/audit";

const PatchSchema = z.object({ name: z.string().min(1) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.role.findUnique({ where: { id } });
  const role = await prisma.role.update({ where: { id }, data: { name: parsed.data.name } });

  auditLog({
    entity_type: "role",
    entity_id: id,
    entity_name: role.name,
    action: "update",
    before: before ? { name: before.name } : null,
    after: { name: role.name },
  });

  return NextResponse.json(role);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const count = await prisma.person.count({ where: { role_id: id } });
  if (count > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${count} person${count > 1 ? "s" : ""} assigned to this role` },
      { status: 409 }
    );
  }

  const before = await prisma.role.findUnique({ where: { id } });
  await prisma.role.delete({ where: { id } });

  if (before) {
    auditLog({
      entity_type: "role",
      entity_id: id,
      entity_name: before.name,
      action: "delete",
      before: { name: before.name },
    });
  }

  return NextResponse.json({ ok: true });
}
