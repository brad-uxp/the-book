import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PersonSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function GET() {
  const people = await prisma.person.findMany({
    orderBy: { created_at: "desc" },
    include: {
      role: true,
      salary_base: true,
      salary_payments: { orderBy: { due_date: "desc" }, take: 12 },
      increase_reminders: {
        where: { status: "scheduled" },
        orderBy: { effective_date: "asc" },
        take: 1,
      },
    },
  });
  return NextResponse.json(people);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = PersonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { base_salary_cents, ...personData } = parsed.data;

  const person = await prisma.$transaction(async (tx) => {
    const p = await tx.person.create({
      data: {
        name: personData.name,
        payday_day: personData.payday_day,
        status: personData.status ?? "active",
        role_id: personData.role_id ?? null,
        notes: personData.notes ?? null,
      },
    });
    await tx.salaryBase.create({
      data: { person_id: p.id, base_salary_cents },
    });
    return tx.person.findUnique({
      where: { id: p.id },
      include: { role: true, salary_base: true },
    });
  });

  if (person) {
    auditLog({
      entity_type: "person",
      entity_id: person.id,
      entity_name: person.name,
      action: "create",
      after: {
        name: person.name,
        payday_day: person.payday_day,
        status: person.status,
        role_id: person.role_id,
        notes: person.notes,
        base_salary_cents: person.salary_base?.base_salary_cents,
      },
    });
  }

  return NextResponse.json(person, { status: 201 });
}
