import { uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { platformSchema } from "./platform.js";

/**
 * Append-Only Audit Log Schema (PLT-10)
 * Authorized database users possess SELECT and INSERT permissions only.
 * UPDATE and DELETE statements are strictly rejected.
 */
export const auditLogs = platformSchema.table("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  actorRole: text("actor_role"),
  action: text("action").notNull(),
  targetEntity: text("target_entity").notNull(),
  targetId: text("target_id"),
  correlationId: text("correlation_id").notNull(),
  batchId: text("batch_id"),
  result: text("result").notNull(), // 'success' | 'failure'
  reason: text("reason"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});
