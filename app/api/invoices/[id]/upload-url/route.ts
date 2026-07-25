import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildInvoiceKey, getUploadUrl } from "@/lib/r2";
import { requireSession } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const key = buildInvoiceKey(id);
  const uploadUrl = await getUploadUrl(key, "application/pdf", 300);
  return NextResponse.json({ uploadUrl, key });
}
