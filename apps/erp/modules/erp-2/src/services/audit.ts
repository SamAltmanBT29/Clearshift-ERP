/**
 * ERP-2 Audit Trail Service
 *
 * Implements:
 *   - Append-only audit records for state mutations, exports, merge decisions, and privileged actions
 *   - Automatic sanitization of sensitive fields (bank details, credentials, tokens, salary) in diffs
 *   - Correlation ID tracking and actor attribution
 *
 * @module erp2/services/audit
 */

import { randomUUID } from 'node:crypto';
import { sanitizeForLogging } from '../policies/field-masking.js';
import { getDatabase } from '@cs/db';
import { audit as platformAuditTable } from '@cs/db';

export interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  diffRedacted: Record<string, unknown>;
  correlationId?: string | undefined;
  createdAt: string;
}

export interface AuditParams {
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  diff?: Record<string, unknown> | undefined;
  correlationId?: string | undefined;
}

export class AuditService {
  private inMemoryAuditRecords: AuditRecord[] = [];
  private useDatabase: boolean;

  constructor(options: { useDatabase?: boolean } = {}) {
    this.useDatabase = options.useDatabase ?? false;
  }

  /**
   * Records a business audit entry with redacted sensitive values.
   */
  async log(params: AuditParams): Promise<AuditRecord> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    // Sanitize diff to ensure no bank account or secret is written raw
    const sanitizedDiff = sanitizeForLogging(params.diff || {}) as Record<string, unknown>;

    const record: AuditRecord = {
      id,
      actor: params.actor,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      diffRedacted: sanitizedDiff,
      correlationId: params.correlationId,
      createdAt,
    };

    // Store in-memory for immediate query/verification
    this.inMemoryAuditRecords.push(record);

    // If database persistence is enabled and available, write to platform.audit
    if (this.useDatabase) {
      try {
        const db = getDatabase();
        await db.insert(platformAuditTable).values({
          id,
          actor: params.actor,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId,
          diffRedacted: sanitizedDiff,
          createdAt: new Date(createdAt),
        });
      } catch (err) {
        // Safe logging of audit write failure: never bubble or crash business transaction
        console.error(
          `[ERP2_AUDIT_ERROR] Failed to persist audit row to platform.audit: ${(err as Error).message}`
        );
      }
    }

    return record;
  }

  /**
   * Returns all in-memory audit records (primarily for testing and verification).
   */
  getRecords(): AuditRecord[] {
    return [...this.inMemoryAuditRecords];
  }

  /**
   * Finds records matching a given entity ID.
   */
  getRecordsForEntity(entityId: string): AuditRecord[] {
    return this.inMemoryAuditRecords.filter((r) => r.entityId === entityId);
  }

  /**
   * Clears in-memory audit records (for test isolation).
   */
  clear(): void {
    this.inMemoryAuditRecords = [];
  }
}

export const defaultAuditService = new AuditService();
