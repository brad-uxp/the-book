import { prisma } from "@/lib/db";
import { Prisma } from "@/app/generated/prisma/client";

/**
 * Fire-and-forget audit log writer.
 * Never awaited so a DB failure here never breaks the calling mutation.
 */
export function auditLog(params: {
  entity_type: string;
  entity_id: string;
  entity_name: string;
  action: "create" | "update" | "delete";
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
        before: params.before ?? undefined,
        after: params.after ?? undefined,
      },
    })
    .catch((err) => console.error("[audit]", err));
}
