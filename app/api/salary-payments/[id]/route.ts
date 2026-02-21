import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const PatchSchema = z.object({
  paid_at: z.string().optional(),
  adjustment_cents: z.number().int().optional(),
  adjustment_note: z.string().nullable().optional(),
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

  const payment = await prisma.salaryPayment.findUnique({ where: { id } });
  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.paid_at !== undefined) data.paid_at = new Date(parsed.data.paid_at);
  if (parsed.data.adjustment_cents !== undefined) {
    data.adjustment_cents = parsed.data.adjustment_cents;
    data.total_cents = payment.base_salary_cents_snapshot + parsed.data.adjustment_cents;
  }
  if (parsed.data.adjustment_note !== undefined) data.adjustment_note = parsed.data.adjustment_note;

  const updated = await prisma.salaryPayment.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.salaryPayment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
