import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.enum(["work", "personal", "essential_service"]).optional(),
  paid_at: z.string().optional(),
  amount_cents: z.number().int().min(1).optional(),
  notes: z.string().nullable().optional(),
});

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

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.category !== undefined) data.category = parsed.data.category;
  if (parsed.data.paid_at !== undefined) data.paid_at = new Date(parsed.data.paid_at);
  if (parsed.data.amount_cents !== undefined) data.amount_cents = parsed.data.amount_cents;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

  const updated = await prisma.otherExpense.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.otherExpense.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
