import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession } from "@/lib/api";

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
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.otherExpense.findUnique({ where: { id } });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.category !== undefined) data.category = parsed.data.category;
  if (parsed.data.paid_at !== undefined) data.paid_at = new Date(parsed.data.paid_at);
  if (parsed.data.amount_cents !== undefined) data.amount_cents = parsed.data.amount_cents;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

  const updated = await prisma.otherExpense.update({ where: { id }, data });

  auditLog({
    entity_type: "other_expense",
    entity_id: id,
    entity_name: updated.name,
    action: "update",
    actor_email: await getActorEmail(),
    before: before ? {
      name: before.name,
      category: before.category,
      paid_at: before.paid_at,
      amount_cents: before.amount_cents,
      notes: before.notes,
    } : null,
    after: {
      name: updated.name,
      category: updated.category,
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
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const before = await prisma.otherExpense.findUnique({ where: { id } });
  await prisma.otherExpense.delete({ where: { id } });

  if (before) {
    auditLog({
      entity_type: "other_expense",
      entity_id: id,
      entity_name: before.name,
      action: "delete",
      actor_email: await getActorEmail(),
      before: {
        name: before.name,
        category: before.category,
        paid_at: before.paid_at,
        amount_cents: before.amount_cents,
        notes: before.notes,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
