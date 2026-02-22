import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { auditLog } from "@/lib/audit";

const CreateSchema = z.object({
  name: z.string().min(1),
  paid_at: z.string().min(1),
  amount_cents: z.number().int().min(1),
  notes: z.string().nullable().optional(),
});

export async function GET() {
  const fees = await prisma.feePayment.findMany({
    orderBy: { paid_at: "desc" },
  });
  return NextResponse.json(fees);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const fee = await prisma.feePayment.create({
    data: {
      name: parsed.data.name,
      paid_at: new Date(parsed.data.paid_at),
      amount_cents: parsed.data.amount_cents,
      notes: parsed.data.notes ?? null,
    },
  });

  auditLog({
    entity_type: "fee_payment",
    entity_id: fee.id,
    entity_name: fee.name,
    action: "create",
    after: {
      name: fee.name,
      paid_at: fee.paid_at,
      amount_cents: fee.amount_cents,
      notes: fee.notes,
    },
  });

  return NextResponse.json(fee, { status: 201 });
}
