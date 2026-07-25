import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ClientSchema } from "@/lib/validations";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession } from "@/lib/api";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const clients = await prisma.client.findMany({
    select: { id: true, name: true, color_hex: true, default_referrer_id: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = await req.json();
  const parsed = ClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const duplicate = await prisma.client.findFirst({
    where: { name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (duplicate) {
    return NextResponse.json({ error: "A client with this name already exists" }, { status: 409 });
  }

  const client = await prisma.client.create({ data: parsed.data });

  auditLog({
    entity_type: "client",
    entity_id: client.id,
    entity_name: client.name,
    action: "create",
    actor_email: await getActorEmail(),
    after: { name: client.name, color_hex: client.color_hex },
  });

  return NextResponse.json(client, { status: 201 });
}
