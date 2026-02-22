import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { InvoiceSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { client: true },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const parsed = InvoiceSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const before = await prisma.invoice.findUnique({
    where: { id },
    include: { client: true },
  });

  const data: Record<string, unknown> = {};
  if (parsed.data.invoice_number !== undefined)
    data.invoice_number = parsed.data.invoice_number ?? null;
  if (parsed.data.client_id !== undefined)
    data.client_id = parsed.data.client_id;
  if (parsed.data.amount_cents !== undefined)
    data.amount_cents = parsed.data.amount_cents;
  if (parsed.data.fee_cents !== undefined)
    data.fee_cents = parsed.data.fee_cents;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.due_date !== undefined)
    data.due_date = new Date(parsed.data.due_date);
  if (parsed.data.reminder_date !== undefined)
    data.reminder_date = parsed.data.reminder_date
      ? new Date(parsed.data.reminder_date)
      : null;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes ?? null;
  if (parsed.data.file_url !== undefined) data.file_url = parsed.data.file_url ?? null;

  const invoice = await prisma.invoice.update({
    where: { id },
    data,
    include: { client: true },
  });

  auditLog({
    entity_type: "invoice",
    entity_id: id,
    entity_name: `${invoice.invoice_number ? `#${invoice.invoice_number} · ` : ""}${invoice.client.name}`,
    action: "update",
    before: before ? {
      invoice_number: before.invoice_number,
      client_id: before.client_id,
      amount_cents: before.amount_cents,
      fee_cents: before.fee_cents,
      status: before.status,
      due_date: before.due_date,
      reminder_date: before.reminder_date,
      notes: before.notes,
      file_url: before.file_url,
    } : null,
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

  return NextResponse.json(invoice);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const before = await prisma.invoice.findUnique({
    where: { id },
    include: { client: true },
  });

  await prisma.invoice.delete({ where: { id } });

  if (before) {
    auditLog({
      entity_type: "invoice",
      entity_id: id,
      entity_name: `${before.invoice_number ? `#${before.invoice_number} · ` : ""}${before.client.name}`,
      action: "delete",
      before: {
        invoice_number: before.invoice_number,
        client_id: before.client_id,
        amount_cents: before.amount_cents,
        fee_cents: before.fee_cents,
        status: before.status,
        due_date: before.due_date,
        reminder_date: before.reminder_date,
        notes: before.notes,
        file_url: before.file_url,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
