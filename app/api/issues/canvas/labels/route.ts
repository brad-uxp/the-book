import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CanvasLabelSchema } from "@/lib/validations";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";

/**
 * Text chips on the canvas.
 *
 * Not audited, and deliberately so: a chip is a heading someone wrote over a
 * cluster of cards, not a record of work. Auditing every retitled label would
 * bury the history that matters, the same reasoning that keeps card positions
 * out of the log.
 */

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const labels = await prisma.canvasLabel.findMany({
    orderBy: { created_at: "asc" },
  });
  return NextResponse.json(labels);
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const parsed = CanvasLabelSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  try {
    const label = await prisma.canvasLabel.create({
      data: {
        text: parsed.data.text,
        color: parsed.data.color,
        canvas_x: parsed.data.x,
        canvas_y: parsed.data.y,
      },
    });
    return NextResponse.json(label, { status: 201 });
  } catch (err) {
    return toApiResponse(err);
  }
}
