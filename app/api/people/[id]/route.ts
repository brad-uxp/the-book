import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PersonSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      role: true,
      salary_base: true,
      salary_payments: { orderBy: { due_date: "desc" } },
      increase_reminders: { orderBy: { effective_date: "asc" } },
    },
  });
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(person);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = PersonSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { base_salary_cents, ...personData } = parsed.data;

  // Use raw body keys — Zod .default() fills in values even with .partial()
  const sent = new Set(Object.keys(body));

  const before = await prisma.person.findUnique({
    where: { id },
    include: { salary_base: true },
  });

  const person = await prisma.$transaction(async (tx) => {
    await tx.person.update({
      where: { id },
      data: {
        ...(sent.has("name") && { name: personData.name }),
        ...(sent.has("payday_day") && { payday_day: personData.payday_day }),
        ...(sent.has("status") && { status: personData.status }),
        ...(sent.has("role_id") && { role_id: personData.role_id ?? null }),
        ...(sent.has("notes") && { notes: personData.notes ?? null }),
      },
    });

    if (base_salary_cents !== undefined) {
      await tx.salaryBase.upsert({
        where: { person_id: id },
        update: { base_salary_cents },
        create: { person_id: id, base_salary_cents },
      });
    }

    return tx.person.findUnique({
      where: { id },
      include: { role: true, salary_base: true },
    });
  });

  if (person) {
    auditLog({
      entity_type: "person",
      entity_id: id,
      entity_name: person.name,
      action: "update",
      before: before ? {
        name: before.name,
        payday_day: before.payday_day,
        status: before.status,
        role_id: before.role_id,
        notes: before.notes,
        base_salary_cents: before.salary_base?.base_salary_cents,
      } : null,
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

  return NextResponse.json(person);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const before = await prisma.person.findUnique({
    where: { id },
    include: { salary_base: true },
  });

  await prisma.person.delete({ where: { id } });

  if (before) {
    auditLog({
      entity_type: "person",
      entity_id: id,
      entity_name: before.name,
      action: "delete",
      before: {
        name: before.name,
        payday_day: before.payday_day,
        status: before.status,
        role_id: before.role_id,
        notes: before.notes,
        base_salary_cents: before.salary_base?.base_salary_cents,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
