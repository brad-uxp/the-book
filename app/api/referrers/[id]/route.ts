import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ReferrerSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = ReferrerSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const sent = new Set(Object.keys(body));
  const data: Record<string, unknown> = {};
  if (sent.has("name")) data.name = parsed.data.name;
  if (sent.has("color_hex")) data.color_hex = parsed.data.color_hex;

  const before = await prisma.referrer.findUnique({ where: { id } });
  const referrer = await prisma.referrer.update({ where: { id }, data });

  auditLog({
    entity_type: "referrer",
    entity_id: id,
    entity_name: referrer.name,
    action: "update",
    before: before
      ? { name: before.name, color_hex: before.color_hex }
      : null,
    after: { name: referrer.name, color_hex: referrer.color_hex },
  });

  return NextResponse.json(referrer);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const before = await prisma.referrer.findUnique({ where: { id } });
  if (!before) {
    return NextResponse.json({ error: "Referrer not found" }, { status: 404 });
  }

  const [invoiceCount, feePaymentCount] = await Promise.all([
    prisma.invoice.count({ where: { referrer_id: id } }),
    prisma.feePayment.count({ where: { referrer_id: id } }),
  ]);
  if (invoiceCount > 0 || feePaymentCount > 0) {
    const parts: string[] = [];
    if (invoiceCount > 0) parts.push(`${invoiceCount} invoice${invoiceCount > 1 ? "s" : ""}`);
    if (feePaymentCount > 0) parts.push(`${feePaymentCount} fee payment${feePaymentCount > 1 ? "s" : ""}`);
    return NextResponse.json(
      { error: `Cannot delete: this referrer has ${parts.join(" and ")}` },
      { status: 409 }
    );
  }

  await prisma.referrer.delete({ where: { id } });

  auditLog({
    entity_type: "referrer",
    entity_id: id,
    entity_name: before.name,
    action: "delete",
    before: { name: before.name, color_hex: before.color_hex },
  });

  return NextResponse.json({ ok: true });
}
