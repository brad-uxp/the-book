import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { InvoiceSchema } from "@/lib/validations";

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

  // Allow partial update for status-only updates
  const parsed = InvoiceSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

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
  return NextResponse.json(invoice);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.invoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
