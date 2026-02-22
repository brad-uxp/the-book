import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ClientSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function GET() {
  const clients = await prisma.client.findMany({
    select: { id: true, name: true, color_hex: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = ClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const client = await prisma.client.create({ data: parsed.data });

  auditLog({
    entity_type: "client",
    entity_id: client.id,
    entity_name: client.name,
    action: "create",
    after: { name: client.name, color_hex: client.color_hex },
  });

  return NextResponse.json(client, { status: 201 });
}
