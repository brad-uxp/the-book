import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDownloadUrl } from "@/lib/r2";
import { requireSession } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { file_key: true, file_url: true },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (invoice.file_key) {
    const url = await getDownloadUrl(invoice.file_key, 600);
    return NextResponse.json({ url, kind: "r2" });
  }
  if (invoice.file_url) {
    return NextResponse.json({ url: invoice.file_url, kind: "external" });
  }
  return NextResponse.json({ error: "No file attached" }, { status: 404 });
}
