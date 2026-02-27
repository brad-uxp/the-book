import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const referrers = await prisma.referrer.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { invoices: true, fee_payments: true, default_clients: true } },
      invoices: { select: { fee_cents: true } },
      fee_payments: { select: { amount_cents: true } },
    },
  });

  const data = referrers.map((r) => ({
    id: r.id,
    name: r.name,
    color_hex: r.color_hex,
    invoice_count: r._count.invoices,
    fee_payment_count: r._count.fee_payments,
    total_fee_cents: r.invoices.reduce((sum, inv) => sum + Math.abs(inv.fee_cents), 0),
    total_paid_cents: r.fee_payments.reduce((sum, fp) => sum + fp.amount_cents, 0),
    default_client_count: r._count.default_clients,
  }));

  return NextResponse.json(data);
}
