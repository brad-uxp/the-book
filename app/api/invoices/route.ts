import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { InvoiceSchema } from "@/lib/validations";
import { lastDayOfMonth } from "@/lib/dates";
import { auditLog, getActorEmail } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pageParam = searchParams.get("page");
  const limitParam = searchParams.get("limit");

  const include = { client: true, referrer: true } as const;
  const orderBy = { created_at: "desc" } as const;

  // Backward-compatible: no params = return all (existing client components expect an array)
  if (!pageParam && !limitParam) {
    const invoices = await prisma.invoice.findMany({ orderBy, include });
    return NextResponse.json(invoices);
  }

  const page = Math.max(1, parseInt(pageParam ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitParam ?? "50") || 50));

  const [data, total] = await Promise.all([
    prisma.invoice.findMany({
      orderBy,
      include,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.invoice.count(),
  ]);

  return NextResponse.json({ data, total, page, limit });
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

  if (parsed.data.invoice_number) {
    const duplicate = await prisma.invoice.findFirst({
      where: { invoice_number: { equals: parsed.data.invoice_number, mode: "insensitive" } },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: `Invoice number "${parsed.data.invoice_number}" already exists` },
        { status: 409 }
      );
    }
  }

  const invoice = await prisma.invoice.create({
    data: {
      invoice_number: parsed.data.invoice_number ?? null,
      client_id: parsed.data.client_id,
      referrer_id: parsed.data.referrer_id ?? null,
      amount_cents: parsed.data.amount_cents,
      fee_cents: parsed.data.fee_cents ?? 0,
      status: parsed.data.status ?? "pending",
      due_date: lastDayOfMonth(parsed.data.due_date),
      reminder_date: parsed.data.reminder_date
        ? new Date(parsed.data.reminder_date)
        : null,
      notes: parsed.data.notes ?? null,
      file_url: parsed.data.file_url ?? null,
    },
    include: { client: true, referrer: true },
  });

  auditLog({
    entity_type: "invoice",
    entity_id: invoice.id,
    entity_name: `${invoice.invoice_number ? `#${invoice.invoice_number} · ` : ""}${invoice.client.name}`,
    action: "create",
    actor_email: await getActorEmail(),
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

  return NextResponse.json(invoice, { status: 201 });
}
