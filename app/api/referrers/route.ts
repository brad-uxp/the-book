import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ReferrerSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function GET() {
  const referrers = await prisma.referrer.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(referrers);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = ReferrerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const duplicate = await prisma.referrer.findFirst({
    where: { name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: "A referrer with this name already exists" },
      { status: 409 }
    );
  }

  const referrer = await prisma.referrer.create({ data: parsed.data });

  auditLog({
    entity_type: "referrer",
    entity_id: referrer.id,
    entity_name: referrer.name,
    action: "create",
    after: { name: referrer.name, color_hex: referrer.color_hex },
  });

  return NextResponse.json(referrer, { status: 201 });
}
