import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PersonWithSalarySchema } from "@/lib/validations";
import { auditLog, getActorEmail } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pageParam = searchParams.get("page");
  const limitParam = searchParams.get("limit");

  const include = {
    role: true,
    salary_base: true,
    salary_payments: { orderBy: { due_date: "desc" } as const, take: 12 },
    increase_reminders: {
      where: { status: "scheduled" as const },
      orderBy: { effective_date: "asc" } as const,
      take: 1,
    },
  };
  const orderBy = { created_at: "desc" } as const;

  // Backward-compatible: no params = return all
  if (!pageParam && !limitParam) {
    const people = await prisma.person.findMany({ orderBy, include });
    return NextResponse.json(people);
  }

  const page = Math.max(1, parseInt(pageParam ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitParam ?? "50") || 50));

  const [data, total] = await Promise.all([
    prisma.person.findMany({
      orderBy,
      include,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.person.count(),
  ]);

  return NextResponse.json({ data, total, page, limit });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = PersonWithSalarySchema.safeParse(body);
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
      actor_email: await getActorEmail(),
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
