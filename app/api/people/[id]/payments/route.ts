import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SalaryPaymentSchema } from "@/lib/validations";
import { calcMonthlyDueDate, clampDay } from "@/lib/dates";

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

  // Calculate due_date from period_key
  const [year, month] = parsed.data.period_key.split("-").map(Number);
  const day = clampDay(year, month, person.payday_day);
  const dueDate = new Date(Date.UTC(year, month - 1, day));

  // Check for duplicate
  const existing = await prisma.salaryPayment.findFirst({
    where: { person_id: id, period_key: parsed.data.period_key },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Salary payment for period ${parsed.data.period_key} already exists` },
      { status: 409 }
    );
  }

  const payment = await prisma.salaryPayment.create({
    data: {
      person_id: id,
      period_key: parsed.data.period_key,
      due_date: dueDate,
      paid_at: new Date(parsed.data.paid_at),
      base_salary_cents_snapshot: base,
      adjustment_cents: adjustment,
      adjustment_note: parsed.data.adjustment_note ?? null,
      total_cents: total,
    },
  });

  return NextResponse.json(payment, { status: 201 });
}
