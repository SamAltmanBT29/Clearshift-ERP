/**
 * ERP-2 Target Adapter (Decision C4 & KIT-08)
 *
 * Implements the TargetAdapter port from @cs/kit.
 * Executed in-process to guarantee atomic transaction commits between
 * the target business entity and the durable import receipt.
 *
 * @module erp2/migration/target-adapter
 */

import { type Result, ok, err } from '@cs/kernel';
import type {
  TargetAdapter,
  TargetAdapterResult,
  TargetAdapterError,
} from '@cs/kit';
import {
  Erp2Service,
  DomainError,
  ConflictError,
  ValidationError,
} from '../services/erp2.service.js';

export class Erp2TargetAdapter<TRow = unknown> implements TargetAdapter<TRow> {
  readonly module = 'erp2';
  readonly entity: string;
  readonly schemaVersion = 1;

  constructor(
    private readonly service: Erp2Service,
    entity: 'vendor' | 'purchase_order' = 'vendor'
  ) {
    this.entity = entity;
  }

  /**
   * Preflight validation during dry-run phase (zero database mutations).
   */
  async preflight(
    _batchId: string,
    rows: TRow[]
  ): Promise<Result<{ validCount: number; rejectCount: number }, TargetAdapterError>> {
    let validCount = 0;
    let rejectCount = 0;

    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        rejectCount++;
        continue;
      }
      const record = row as Record<string, unknown>;

      if (this.entity === 'vendor') {
        const hasName = typeof record['name'] === 'string' && record['name'].length > 0;
        const hasTax = typeof record['tax_number'] === 'string' && record['tax_number'].length > 0;
        const hasEmail = typeof record['email'] === 'string' && record['email'].includes('@');
        if (hasName && hasTax && hasEmail) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else if (this.entity === 'purchase_order') {
        const hasVendor = typeof record['vendor_id'] === 'string';
        const hasDate = typeof record['order_date'] === 'string';
        const hasLines = Array.isArray(record['lines']) && record['lines'].length > 0;
        if (hasVendor && hasDate && hasLines) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else {
        rejectCount++;
      }
    }

    return ok({ validCount, rejectCount });
  }

  /**
   * Commits target business record and durable import receipt atomically in one local PG transaction.
   */
  async importRow(
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    cleanData: TRow
  ): Promise<Result<TargetAdapterResult, TargetAdapterError>> {
    try {
      const result = await this.service.importRow({
        batch_id: batchId,
        source_row: sourceRow,
        idempotency_key: idempotencyKey,
        entity: this.entity,
        record: cleanData as Record<string, unknown>,
      });

      return ok({
        targetId: result.target_id,
        receipt: {
          batchId: result.receipt.batch_id,
          sourceRow: result.receipt.source_row,
          entity: result.receipt.entity,
          schemaVersion: result.receipt.schema_version,
          idempotencyKey: result.receipt.idempotency_key,
          targetId: result.receipt.target_id,
          kind: result.receipt.kind,
          createdAt: new Date(result.receipt.created_at),
        },
      });
    } catch (error) {
      // Business rejections: return stable reason
      if (
        error instanceof DomainError ||
        error instanceof ConflictError ||
        error instanceof ValidationError
      ) {
        const errPayload: TargetAdapterError = {
          reasonCode: error.code,
          message: error.message,
        };
        const field = error.details[0]?.field;
        if (field) {
          errPayload.field = field;
        }
        return err(errPayload);
      }

      // Unexpected / simulated infrastructure failure (e.g. 503) must NOT be misclassified as bad data
      throw error;
    }
  }
}
