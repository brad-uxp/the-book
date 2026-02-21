import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const RoleSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export async function GET() {
  const roles = await prisma.role.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(roles);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = RoleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const role = await prisma.role.create({ data: { name: parsed.data.name } });
  return NextResponse.json(role, { status: 201 });
}
