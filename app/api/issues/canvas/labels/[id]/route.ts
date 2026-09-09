import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CanvasLabelPatchSchema } from "@/lib/validations";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = await readJson(req);
  const parsed = CanvasLabelPatchSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  // Write only the keys that were actually sent. Recolouring a chip must not
  // blank its text just because `text` was absent from the payload — the same
  // rule PATCH /api/issues/[id] follows.
  const sent = new Set(
    body && typeof body === "object" ? Object.keys(body) : []
  );
  const data: Record<string, unknown> = {};
  if (sent.has("text")) data.text = parsed.data.text;
  if (sent.has("color")) data.color = parsed.data.color;
  if (sent.has("x")) data.canvas_x = parsed.data.x;
  if (sent.has("y")) data.canvas_y = parsed.data.y;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const label = await prisma.canvasLabel.update({ where: { id }, data });
    return NextResponse.json(label);
  } catch (err) {
    return toApiResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  try {
    await prisma.canvasLabel.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // P2025 becomes a 404, which is the right answer for "already gone".
    return toApiResponse(err);
  }
}
