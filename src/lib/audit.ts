import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema";

export async function logChange(opts: {
  userId: string; // stake address of the actor
  entityType: string;
  entityId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}) {
  const stringify = (v: unknown) =>
    v == null ? null : typeof v === "string" ? v : JSON.stringify(v);
  await getDb()
    .insert(auditLog)
    .values({
      userId: opts.userId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      field: opts.field,
      oldValue: stringify(opts.oldValue),
      newValue: stringify(opts.newValue),
    });
}
