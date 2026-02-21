import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { z } from "zod";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = z.object({ recipient: z.string().email() }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return NextResponse.json(
      { error: "GMAIL_USER and GMAIL_APP_PASSWORD are not configured in .env" },
      { status: 500 }
    );
  }

  try {
    await sendEmail(
      parsed.data.recipient,
      "[AccountBook] Test de correo",
      `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #111;">
          <h2 style="margin: 0 0 12px;">¡El correo funciona! ✓</h2>
          <p style="color: #374151;">
            Las notificaciones de AccountBook están correctamente configuradas.
          </p>
        </div>
      `
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
