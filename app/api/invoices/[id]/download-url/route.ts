import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDownloadUrl, isInvoiceKeyFor } from "@/lib/r2";
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

  // Defence in depth: rows written before file_key was validated could still
  // hold a key belonging to another invoice. Never presign one of those.
  if (invoice.file_key) {
    if (!isInvoiceKeyFor(invoice.file_key, id)) {
      console.error(`[download-url] invoice ${id} holds a foreign file_key`);
      return NextResponse.json({ error: "No file attached" }, { status: 404 });
    }
    const url = await getDownloadUrl(invoice.file_key, 600);
    return NextResponse.json({ url, kind: "r2" });
  }
  if (invoice.file_url) {
    return NextResponse.json({ url: invoice.file_url, kind: "external" });
  }
  return NextResponse.json({ error: "No file attached" }, { status: 404 });
}
