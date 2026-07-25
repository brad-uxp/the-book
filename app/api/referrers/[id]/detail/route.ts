import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const [invoices, feePayments] = await Promise.all([
    prisma.invoice.findMany({
      where: { referrer_id: id },
      select: {
        id: true,
        invoice_number: true,
        amount_cents: true,
        fee_cents: true,
        status: true,
        due_date: true,
        client: { select: { name: true } },
      },
      orderBy: { invoice_number: "asc" },
    }),
    prisma.feePayment.findMany({
      where: { referrer_id: id },
      select: {
        id: true,
        paid_at: true,
        amount_cents: true,
      },
      orderBy: { paid_at: "desc" },
    }),
  ]);

  return NextResponse.json({ invoices, feePayments });
}
