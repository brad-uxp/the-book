import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendWebPushToAll } from "@/lib/web-push";

export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await sendWebPushToAll({
      title: "TheBook — Test",
      body: "Las notificaciones push están funcionando correctamente.",
      data: { url: "/settings" },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[test-push]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send push" },
      { status: 500 }
    );
  }
}
