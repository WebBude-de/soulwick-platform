import type { AuditAction } from "@soulwick/contracts";
import type { Prisma } from "@soulwick/db";
import type { DbOrTx } from "./db-types.ts";

/** Every admin write calls this inside the same transaction as the change itself. */
export async function writeAudit(
  db: DbOrTx,
  entry: {
    adminId: string;
    action: AuditAction;
    targetType: "player" | "guild" | "run" | "admin_user" | "relay_room";
    targetId: string | null;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  await db.auditLog.create({
    data: {
      adminId: entry.adminId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: (entry.details ?? {}) as Prisma.InputJsonObject,
    },
  });
}
