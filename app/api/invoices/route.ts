import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { InvoiceSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function GET() {
  const invoices = await prisma.invoice.findMany({
    orderBy: { created_at: "desc" },
    include: { client: true },
  });
  return NextResponse.json(invoices);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = InvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const invoice = await prisma.invoice.create({
    data: {
      invoice_number: parsed.data.invoice_number ?? null,
      client_id: parsed.data.client_id,
      amount_cents: parsed.data.amount_cents,
      fee_cents: parsed.data.fee_cents ?? 0,
      status: parsed.data.status ?? "pending",
      due_date: new Date(parsed.data.due_date),
      reminder_date: parsed.data.reminder_date
        ? new Date(parsed.data.reminder_date)
        : null,
      notes: parsed.data.notes ?? null,
      file_url: parsed.data.file_url ?? null,
    },
    include: { client: true },
  });

  auditLog({
    entity_type: "invoice",
    entity_id: invoice.id,
    entity_name: `${invoice.invoice_number ? `#${invoice.invoice_number} · ` : ""}${invoice.client.name}`,
    action: "create",
    after: {
      invoice_number: invoice.invoice_number,
      client_id: invoice.client_id,
      amount_cents: invoice.amount_cents,
      fee_cents: invoice.fee_cents,
      status: invoice.status,
      due_date: invoice.due_date,
      reminder_date: invoice.reminder_date,
      notes: invoice.notes,
      file_url: invoice.file_url,
    },
  });

  return NextResponse.json(invoice, { status: 201 });
}
