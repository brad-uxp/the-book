import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";
import { DateString } from "@/lib/validations";

const PatchSchema = z.object({
  paid_at: DateString.optional(),
  amount_cents: z.number().int().min(1).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const parsed = PatchSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  // A soft-deleted payment is not part of the books any more; editing one would
  // silently resurrect an amount into history on the next undo.
  const before = await prisma.subscriptionPayment.findFirst({
    where: { id, deleted_at: null },
    include: { subscription: true },
  });
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.paid_at !== undefined) data.paid_at = new Date(parsed.data.paid_at);
  if (parsed.data.amount_cents !== undefined) data.amount_cents_snapshot = parsed.data.amount_cents;

  try {
    const updated = await prisma.subscriptionPayment.update({ where: { id }, data });

    const periodLabel = before.due_date.toISOString().slice(0, 7);
    auditLog({
      entity_type: "subscription_payment",
      entity_id: id,
      entity_name: `${before.subscription.name} – ${periodLabel}`,
      action: "update",
      actor_email: await getActorEmail(),
      before: {
        paid_at: before.paid_at,
        amount_cents_snapshot: before.amount_cents_snapshot,
      },
      after: {
        paid_at: updated.paid_at,
        amount_cents_snapshot: updated.amount_cents_snapshot,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    return toApiResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const before = await prisma.subscriptionPayment.findFirst({
    where: { id, deleted_at: null },
    include: { subscription: true },
  });
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await prisma.subscriptionPayment.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    const periodLabel = before.due_date.toISOString().slice(0, 7);
    auditLog({
      entity_type: "subscription_payment",
      entity_id: id,
      entity_name: `${before.subscription.name} – ${periodLabel}`,
      action: "delete",
      actor_email: await getActorEmail(),
      before: {
        subscription_id: before.subscription_id,
        due_date: before.due_date,
        paid_at: before.paid_at,
        amount_cents_snapshot: before.amount_cents_snapshot,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiResponse(err);
  }
}
