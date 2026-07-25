import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireSession } from "@/lib/api";

const PatchSchema = z.object({
  paid_at: z.string().optional(),
  amount_cents: z.number().int().min(1).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.paid_at !== undefined) data.paid_at = new Date(parsed.data.paid_at);
  if (parsed.data.amount_cents !== undefined) data.amount_cents_snapshot = parsed.data.amount_cents;

  const updated = await prisma.subscriptionPayment.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  await prisma.subscriptionPayment.update({
    where: { id },
    data: { deleted_at: new Date() },
  });
  return NextResponse.json({ ok: true });
}
