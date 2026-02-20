import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PersonSchema } from "@/lib/validations";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
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

  const person = await prisma.$transaction(async (tx) => {
    await tx.person.update({
      where: { id },
      data: {
        ...(personData.name !== undefined && { name: personData.name }),
        ...(personData.payday_day !== undefined && { payday_day: personData.payday_day }),
        ...(personData.status !== undefined && { status: personData.status }),
        ...(personData.notes !== undefined && { notes: personData.notes ?? null }),
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
      include: { salary_base: true },
    });
  });

  return NextResponse.json(person);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.person.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
