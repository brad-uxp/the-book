import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SalaryIncreaseReminderSchema } from "@/lib/validations";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;
  const body = await req.json();
  const { reminderId, action, new_effective_date, new_suggested_base_cents } =
    body;

  if (!reminderId || !action) {
    return NextResponse.json(
      { error: "reminderId and action are required" },
      { status: 400 }
    );
  }

  const reminder = await prisma.salaryIncreaseReminder.findFirst({
    where: { id: reminderId, person_id: id },
  });
  if (!reminder) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  if (action === "apply") {
    await prisma.$transaction(async (tx) => {
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
    if (!new_effective_date || !new_suggested_base_cents) {
      return NextResponse.json(
        { error: "new_effective_date and new_suggested_base_cents required for reschedule" },
        { status: 400 }
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.salaryIncreaseReminder.update({
        where: { id: reminderId },
        data: { status: "ignored" },
      });
      await tx.salaryIncreaseReminder.create({
        data: {
          person_id: id,
          effective_date: new Date(new_effective_date),
          suggested_new_base_cents: new_suggested_base_cents,
        },
      });
    });
    return NextResponse.json({ ok: true, action: "rescheduled" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
