import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SalaryPaymentSchema } from "@/lib/validations";
import { clampDay } from "@/lib/dates";
import { auditLog } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const payments = await prisma.salaryPayment.findMany({
    where: { person_id: id },
    orderBy: { due_date: "desc" },
  });
  return NextResponse.json(payments);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = SalaryPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const person = await prisma.person.findUnique({
    where: { id },
    include: { salary_base: true },
  });
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const base = person.salary_base?.base_salary_cents ?? 0;
  const adjustment = parsed.data.adjustment_cents ?? 0;
  const total = base + adjustment;

  // Calculate due_date from paid_at
  const paidDate = new Date(parsed.data.paid_at);
  const year = paidDate.getUTCFullYear();
  const month = paidDate.getUTCMonth() + 1;
  const day = clampDay(year, month, person.payday_day);
  const dueDate = new Date(Date.UTC(year, month - 1, day));

  // Check for duplicate (same person + same due_date)
  const existing = await prisma.salaryPayment.findFirst({
    where: { person_id: id, due_date: dueDate },
  });
  if (existing) {
    const label = `${year}-${String(month).padStart(2, "0")}`;
    return NextResponse.json(
      { error: `Salary payment for ${label} already exists` },
      { status: 409 }
    );
  }

  const payment = await prisma.salaryPayment.create({
    data: {
      person_id: id,
      due_date: dueDate,
      paid_at: new Date(parsed.data.paid_at),
      base_salary_cents_snapshot: base,
      adjustment_cents: adjustment,
      adjustment_note: parsed.data.adjustment_note ?? null,
      total_cents: total,
    },
  });

  auditLog({
    entity_type: "salary_payment",
    entity_id: payment.id,
    entity_name: `${person.name} – ${dueDate.toISOString().slice(0, 7)}`,
    action: "create",
    after: {
      person_id: payment.person_id,
      due_date: payment.due_date,
      paid_at: payment.paid_at,
      base_salary_cents_snapshot: payment.base_salary_cents_snapshot,
      adjustment_cents: payment.adjustment_cents,
      adjustment_note: payment.adjustment_note,
      total_cents: payment.total_cents,
    },
  });

  return NextResponse.json(payment, { status: 201 });
}
