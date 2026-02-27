import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ClientSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = ClientSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Use raw body keys — Zod .default() fills in values even with .partial()
  const sent = new Set(Object.keys(body));
  const data: Record<string, unknown> = {};
  if (sent.has("name")) data.name = parsed.data.name;
  if (sent.has("color_hex")) data.color_hex = parsed.data.color_hex;
  if (sent.has("default_referrer_id")) data.default_referrer_id = parsed.data.default_referrer_id ?? null;

  const before = await prisma.client.findUnique({ where: { id } });
  const client = await prisma.client.update({ where: { id }, data });

  auditLog({
    entity_type: "client",
    entity_id: id,
    entity_name: client.name,
    action: "update",
    before: before ? { name: before.name, color_hex: before.color_hex, default_referrer_id: before.default_referrer_id } : null,
    after: { name: client.name, color_hex: client.color_hex, default_referrer_id: client.default_referrer_id },
  });

  return NextResponse.json(client);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const count = await prisma.invoice.count({ where: { client_id: id } });
  if (count > 0) {
    return NextResponse.json(
      { error: "Cannot delete client with existing invoices" },
      { status: 409 }
    );
  }

  const before = await prisma.client.findUnique({ where: { id } });
  await prisma.client.delete({ where: { id } });

  if (before) {
    auditLog({
      entity_type: "client",
      entity_id: id,
      entity_name: before.name,
      action: "delete",
      before: { name: before.name, color_hex: before.color_hex },
    });
  }

  return NextResponse.json({ ok: true });
}
