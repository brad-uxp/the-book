import { prisma } from "@/lib/db";
import { Prisma } from "@/app/generated/prisma/client";
import { auth } from "@/auth";

/**
 * Resolves the actor email from the current request session.
 * Returns null when there is no session (e.g. unauthenticated context or
 * when the caller is unsure). Crons should pass the literal "system"
 * directly instead of calling this helper.
 */
export async function getActorEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

/**
 * Fire-and-forget audit log writer.
 * Never awaited so a DB failure here never breaks the calling mutation.
 */
export function auditLog(params: {
  entity_type: string;
  entity_id: string;
  entity_name: string;
  action: "create" | "update" | "delete";
  /**
   * Email of the user that performed the action. Use the string "system" for
   * automated jobs (crons), null for events with no identifiable actor.
   */
  actor_email: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}): void {
  prisma.auditLog
    .create({
      data: {
        entity_type: params.entity_type,
        entity_id: params.entity_id,
        entity_name: params.entity_name,
        action: params.action,
        actor_email: params.actor_email,
        before: params.before ?? undefined,
        after: params.after ?? undefined,
      },
    })
    .catch((err) => console.error("[audit]", err));
}
