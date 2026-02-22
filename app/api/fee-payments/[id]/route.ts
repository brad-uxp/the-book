import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { auditLog } from "@/lib/audit";

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
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

  const before = await prisma.feePayment.findUnique({ where: { id } });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.paid_at !== undefined) data.paid_at = new Date(parsed.data.paid_at);
  if (parsed.data.amount_cents !== undefined) data.amount_cents = parsed.data.amount_cents;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

  const updated = await prisma.feePayment.update({ where: { id }, data });

  auditLog({
    entity_type: "fee_payment",
    entity_id: id,
    entity_name: updated.name,
    action: "update",
    before: before ? {
      name: before.name,
      paid_at: before.paid_at,
      amount_cents: before.amount_cents,
      notes: before.notes,
    } : null,
    after: {
      name: updated.name,
      paid_at: updated.paid_at,
      amount_cents: updated.amount_cents,
      notes: updated.notes,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const before = await prisma.feePayment.findUnique({ where: { id } });
  await prisma.feePayment.delete({ where: { id } });

  if (before) {
    auditLog({
      entity_type: "fee_payment",
      entity_id: id,
      entity_name: before.name,
      action: "delete",
      before: {
        name: before.name,
        paid_at: before.paid_at,
        amount_cents: before.amount_cents,
        notes: before.notes,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
