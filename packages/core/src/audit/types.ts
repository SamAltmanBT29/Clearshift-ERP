/**
 * Audit Service Types (PLT-10)
 */

export type PrivilegedAuditAction =
  | "export.generated"
  | "merge.decided"
  | "role.changed"
  | "load.requested"
  | "rollback.requested"
  | "journal.posted"
  | "journal.reversed"
  | "auth.succeeded"
  | "auth.failed";

export const MANDATORY_AUDITED_ACTIONS: readonly PrivilegedAuditAction[] = [
  "export.generated",
  "merge.decided",
  "role.changed",
  "load.requested",
  "rollback.requested",
  "journal.posted",
  "journal.reversed",
  "auth.succeeded",
  "auth.failed",
] as const;

export interface AuditEntryInput {
  actor: string;
  actorRole?: string | undefined;
  action: PrivilegedAuditAction | string;
  targetEntity: string;
  targetId?: string | undefined;
  correlationId: string;
  batchId?: string | undefined;
  result: "success" | "failure";
  reason?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface AuditRecord {
  id: string;
  occurredAt: Date;
  actor: string;
  actorRole?: string | undefined;
  action: string;
  targetEntity: string;
  targetId?: string | undefined;
  correlationId: string;
  batchId?: string | undefined;
  result: "success" | "failure";
  reason?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface AuditQueryFilter {
  actor?: string | undefined;
  action?: string | undefined;
  targetEntity?: string | undefined;
  targetId?: string | undefined;
  correlationId?: string | undefined;
  batchId?: string | undefined;
  result?: "success" | "failure" | undefined;
  since?: Date | undefined;
  until?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}
