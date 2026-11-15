import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ReminderActionSchema, SalaryIncreaseReminderSchema } from "@/lib/validations";
import { requireSession, readJson, invalid } from "@/lib/api";
import { auditLog, getActorEmail } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const reminders = await prisma.salaryIncreaseReminder.findMany({
    where: { person_id: id },
    orderBy: { effective_date: "asc" },
  });
  return NextResponse.json(reminders);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const body = await req.json();
  const parsed = SalaryIncreaseReminderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const reminder = await prisma.salaryIncreaseReminder.create({
    data: {
      person_id: id,
      effective_date: new Date(parsed.data.effective_date),
      suggested_new_base_cents: parsed.data.suggested_new_base_cents,
    },
  });

  return NextResponse.json(reminder, { status: 201 });
}

/**
 * PATCH /api/people/[id]/reminders?reminderId=xxx
 * Actions: apply | reschedule | ignore
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const parsed = ReminderActionSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);
  const { reminderId, action, new_effective_date, new_suggested_base_cents } =
    parsed.data;

  const reminder = await prisma.salaryIncreaseReminder.findFirst({
    where: { id: reminderId, person_id: id },
  });
  if (!reminder) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  if (action === "apply") {
    const { personName, baseBefore } = await prisma.$transaction(async (tx) => {
      const current = await tx.salaryBase.findUnique({
        where: { person_id: id },
        select: { base_salary_cents: true },
      });
      await tx.salaryBase.upsert({
        where: { person_id: id },
        update: { base_salary_cents: reminder.suggested_new_base_cents },
        create: {
          person_id: id,
          base_salary_cents: reminder.suggested_new_base_cents,
        },
      });
      await tx.salaryIncreaseReminder.update({
        where: { id: reminderId },
        data: { status: "done" },
      });
      const person = await tx.person.findUnique({ where: { id }, select: { name: true } });
      return { personName: person?.name ?? id, baseBefore: current?.base_salary_cents ?? null };
    });
    // Applying changes the person's base salary, as PATCH /api/people/{id}
    // does, so it is audited the same way: a person update with the base
    // before and after, under the caller's label. The reminder rows themselves
    // stay out of the log, as everywhere else.
    auditLog({
      entity_type: "person",
      entity_id: id,
      entity_name: personName,
      action: "update",
      actor_email: await getActorEmail(),
      before: { base_salary_cents: baseBefore },
      after: { base_salary_cents: reminder.suggested_new_base_cents, applied_reminder_id: reminderId },
    });
    return NextResponse.json({ ok: true, action: "applied" });
  }

  if (action === "ignore") {
    await prisma.salaryIncreaseReminder.update({
      where: { id: reminderId },
      data: { status: "ignored" },
    });
    return NextResponse.json({ ok: true, action: "ignored" });
  }

  if (action === "reschedule") {
    await prisma.$transaction(async (tx) => {
      await tx.salaryIncreaseReminder.update({
        where: { id: reminderId },
        data: { status: "ignored" },
      });
      await tx.salaryIncreaseReminder.create({
        data: {
          person_id: id,
          effective_date: new Date(new_effective_date!),
          suggested_new_base_cents: new_suggested_base_cents!,
        },
      });
    });
    return NextResponse.json({ ok: true, action: "rescheduled" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const reminderId = searchParams.get("reminderId");

  if (!reminderId) {
    return NextResponse.json(
      { error: "reminderId query param is required" },
      { status: 400 }
    );
  }

  const reminder = await prisma.salaryIncreaseReminder.findFirst({
    where: { id: reminderId, person_id: id },
  });
  if (!reminder) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  await prisma.salaryIncreaseReminder.delete({
    where: { id: reminderId },
  });

  return NextResponse.json({ ok: true, action: "deleted" });
}
