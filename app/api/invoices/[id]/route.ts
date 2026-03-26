import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { InvoiceSchema } from "@/lib/validations";
import { lastDayOfMonth } from "@/lib/dates";
import { auditLog } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { client: true, referrer: true },
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

  if (parsed.data.invoice_number) {
    const duplicate = await prisma.invoice.findFirst({
      where: {
        invoice_number: { equals: parsed.data.invoice_number, mode: "insensitive" },
        NOT: { id },
      },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: `Invoice number "${parsed.data.invoice_number}" already exists` },
        { status: 409 }
      );
    }
  }

  const before = await prisma.invoice.findUnique({
    where: { id },
    include: { client: true, referrer: true },
  });

  // Use raw body keys — Zod .default() fills in values even with .partial()
  const sent = new Set(Object.keys(body));
  const data: Record<string, unknown> = {};
  if (sent.has("invoice_number"))
    data.invoice_number = parsed.data.invoice_number ?? null;
  if (sent.has("client_id")) data.client_id = parsed.data.client_id;
  if (sent.has("amount_cents")) data.amount_cents = parsed.data.amount_cents;
  if (sent.has("fee_cents")) data.fee_cents = parsed.data.fee_cents;
  if (sent.has("status")) data.status = parsed.data.status;
  if (sent.has("due_date")) data.due_date = lastDayOfMonth(parsed.data.due_date!);
  if (sent.has("reminder_date"))
    data.reminder_date = parsed.data.reminder_date
      ? new Date(parsed.data.reminder_date)
      : null;
  if (sent.has("notes")) data.notes = parsed.data.notes ?? null;
  if (sent.has("file_url")) data.file_url = parsed.data.file_url ?? null;
  if (sent.has("referrer_id")) data.referrer_id = parsed.data.referrer_id ?? null;

  const invoice = await prisma.invoice.update({
    where: { id },
    data,
    include: { client: true, referrer: true },
  });

  auditLog({
    entity_type: "invoice",
    entity_id: id,
    entity_name: `${invoice.invoice_number ? `#${invoice.invoice_number} · ` : ""}${invoice.client.name}`,
    action: "update",
    before: before ? {
      invoice_number: before.invoice_number,
      client_id: before.client_id,
      referrer_id: before.referrer_id,
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
      referrer_id: invoice.referrer_id,
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
    include: { client: true, referrer: true },
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
