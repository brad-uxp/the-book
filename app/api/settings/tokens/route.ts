import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireUserSession, readJson, invalid, toApiResponse } from "@/lib/api";
import { generateToken, DEFAULT_EXPIRY_DAYS } from "@/lib/api-tokens";

export const runtime = "nodejs";

const CreateTokenSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  expires_in_days: z.number().int().min(1).max(365).default(DEFAULT_EXPIRY_DAYS),
});

/** Never selects token_hash — the secret must not be readable after creation. */
const PUBLIC_FIELDS = {
  id: true,
  name: true,
  token_prefix: true,
  created_at: true,
  last_used_at: true,
  expires_at: true,
  revoked_at: true,
} as const;

export async function GET() {
  const denied = await requireUserSession();
  if (denied) return denied;

  const tokens = await prisma.apiToken.findMany({
    select: PUBLIC_FIELDS,
    orderBy: { created_at: "desc" },
  });
  return NextResponse.json(tokens);
}

export async function POST(req: NextRequest) {
  const denied = await requireUserSession();
  if (denied) return denied;

  const parsed = CreateTokenSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  const { token, prefix, hash } = generateToken();
  const expiresAt = new Date(
    Date.now() + parsed.data.expires_in_days * 24 * 60 * 60 * 1000
  );

  try {
    const created = await prisma.apiToken.create({
      data: {
        name: parsed.data.name,
        token_prefix: prefix,
        token_hash: hash,
        expires_at: expiresAt,
      },
      select: PUBLIC_FIELDS,
    });

    auditLog({
      entity_type: "api_token",
      entity_id: created.id,
      entity_name: created.name,
      action: "create",
      actor_email: await getActorEmail(),
      after: {
        name: created.name,
        token_prefix: created.token_prefix,
        expires_at: created.expires_at,
      },
    });

    // The only time the secret is ever returned.
    return NextResponse.json({ ...created, token }, { status: 201 });
  } catch (err) {
    return toApiResponse(err);
  }
}
