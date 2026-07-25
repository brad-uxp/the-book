import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession } from "@/lib/api";

const PatchSchema = z.object({
  paid_at: z.string().optional(),
  due_date: z.string().optional(),
  adjustment_cents: z.number().int().optional(),
  adjustment_note: z.string().nullable().optional(),
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

  const before = await prisma.salaryPayment.findUnique({
    where: { id },
    include: { person: true },
  });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.paid_at !== undefined) data.paid_at = new Date(parsed.data.paid_at);
  if (parsed.data.due_date !== undefined) data.due_date = new Date(parsed.data.due_date);
  if (parsed.data.adjustment_cents !== undefined) {
    data.adjustment_cents = parsed.data.adjustment_cents;
    data.total_cents = before.base_salary_cents_snapshot + parsed.data.adjustment_cents;
  }
  if (parsed.data.adjustment_note !== undefined) data.adjustment_note = parsed.data.adjustment_note;

  const updated = await prisma.salaryPayment.update({ where: { id }, data });

  const periodLabel = before.due_date.toISOString().slice(0, 7);
  auditLog({
    entity_type: "salary_payment",
    entity_id: id,
    entity_name: `${before.person.name} – ${periodLabel}`,
    action: "update",
    actor_email: await getActorEmail(),
    before: {
      person_id: before.person_id,
      due_date: before.due_date,
      paid_at: before.paid_at,
      base_salary_cents_snapshot: before.base_salary_cents_snapshot,
      adjustment_cents: before.adjustment_cents,
      adjustment_note: before.adjustment_note,
      total_cents: before.total_cents,
    },
    after: {
      person_id: updated.person_id,
      due_date: updated.due_date,
      paid_at: updated.paid_at,
      base_salary_cents_snapshot: updated.base_salary_cents_snapshot,
      adjustment_cents: updated.adjustment_cents,
      adjustment_note: updated.adjustment_note,
      total_cents: updated.total_cents,
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

  const before = await prisma.salaryPayment.findUnique({
    where: { id },
    include: { person: true },
  });

  await prisma.salaryPayment.delete({ where: { id } });

  if (before) {
    const periodLabel = before.due_date.toISOString().slice(0, 7);
    auditLog({
      entity_type: "salary_payment",
      entity_id: id,
      entity_name: `${before.person.name} – ${periodLabel}`,
      action: "delete",
      actor_email: await getActorEmail(),
      before: {
        person_id: before.person_id,
        due_date: before.due_date,
        paid_at: before.paid_at,
        base_salary_cents_snapshot: before.base_salary_cents_snapshot,
        adjustment_cents: before.adjustment_cents,
        adjustment_note: before.adjustment_note,
        total_cents: before.total_cents,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
