import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireSession, readJson, invalid } from "@/lib/api";

/** Push endpoints are fetched by the server, so restrict them to https URLs. */
const PushEndpoint = z
  .string()
  .refine(
    (v) => {
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "endpoint must be an https URL" }
  );

const SubscribeSchema = z.object({
  endpoint: PushEndpoint,
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const UnsubscribeSchema = z.object({ endpoint: PushEndpoint });

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = SubscribeSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);
  const { endpoint, keys } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { p256dh: keys.p256dh, auth: keys.auth, user_email: email },
    create: {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_email: email,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = UnsubscribeSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, user_email: email },
  });

  return NextResponse.json({ ok: true });
}
