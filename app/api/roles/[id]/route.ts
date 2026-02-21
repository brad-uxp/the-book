import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

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
  const role = await prisma.role.update({ where: { id }, data: { name: parsed.data.name } });
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
  await prisma.role.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
