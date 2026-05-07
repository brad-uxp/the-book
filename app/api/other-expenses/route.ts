import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { auditLog, getActorEmail } from "@/lib/audit";

const OtherExpenseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.enum(["work", "personal", "essential_service"]),
  paid_at: z.string().min(1, "Date is required"),
  amount_cents: z.number().int().min(1, "Amount must be positive"),
  notes: z.string().nullable().optional(),
});

export async function GET() {
  const expenses = await prisma.otherExpense.findMany({
    orderBy: { paid_at: "desc" },
  });
  return NextResponse.json(expenses);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = OtherExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const expense = await prisma.otherExpense.create({
    data: {
      name: parsed.data.name,
      category: parsed.data.category,
      paid_at: new Date(parsed.data.paid_at),
      amount_cents: parsed.data.amount_cents,
      notes: parsed.data.notes ?? null,
    },
  });

  auditLog({
    entity_type: "other_expense",
    entity_id: expense.id,
    entity_name: expense.name,
    action: "create",
    actor_email: await getActorEmail(),
    after: {
      name: expense.name,
      category: expense.category,
      paid_at: expense.paid_at,
      amount_cents: expense.amount_cents,
      notes: expense.notes,
    },
  });

  return NextResponse.json(expense, { status: 201 });
}
