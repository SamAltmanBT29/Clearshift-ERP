/**
 * ClearShift Migration Kit — Dry-Run Token Manager (KIT-09)
 *
 * Implements token issuance and lifecycle tracking for Step 5 preflight / dry-run.
 *
 * Invariant (KIT-09 / SDS §11.1):
 * - Successful dry-run issues a valid DryRunToken.
 * - Any skip confirmed after dry-run invalidates the dry-run token and requires a new dry-run.
 * - Real load requires a valid, non-invalidated dry-run token.
 *
 * @module migration-kit/reconcile/dry-run-token
 */

import { randomBytes } from 'node:crypto';
import {
  type DryRunTokenRecord,
  DryRunTokenInvalidatedError,
} from '@clearshift/contracts';

export interface IDryRunTokenManager {
  /**
   * Issues a new dry-run token for a batch upon successful dry-run.
   */
  issueToken(batchId: string): Promise<DryRunTokenRecord>;

  /**
   * Gets current active token for a batch.
   */
  getToken(batchId: string): Promise<DryRunTokenRecord | null>;

  /**
   * Validates if a token is valid (matches and not invalidated).
   */
  isValidToken(batchId: string, token: string): Promise<boolean>;

  /**
   * Invalidates any existing dry-run token for the batch.
   */
  invalidateToken(batchId: string, reason: string): Promise<DryRunTokenRecord | null>;

  /**
   * Asserts token validity; throws DryRunTokenInvalidatedError if invalid or missing.
   */
  assertValidToken(batchId: string, token: string): Promise<void>;

  /**
   * Clears tokens (for testing).
   */
  clear(): void;
}

export class InMemoryDryRunTokenManager implements IDryRunTokenManager {
  private tokensByBatch: Map<string, DryRunTokenRecord> = new Map();

  public async issueToken(batchId: string): Promise<DryRunTokenRecord> {
    const token = `drt_${randomBytes(20).toString('hex')}`;
    const record: DryRunTokenRecord = {
      batchId,
      token,
      issuedAt: new Date(),
      invalidated: false,
    };
    this.tokensByBatch.set(batchId, record);
    return record;
  }

  public async getToken(batchId: string): Promise<DryRunTokenRecord | null> {
    return this.tokensByBatch.get(batchId) ?? null;
  }

  public async isValidToken(batchId: string, token: string): Promise<boolean> {
    const record = this.tokensByBatch.get(batchId);
    if (!record) return false;
    if (record.invalidated) return false;
    return record.token === token;
  }

  public async invalidateToken(
    batchId: string,
    reason: string
  ): Promise<DryRunTokenRecord | null> {
    const record = this.tokensByBatch.get(batchId);
    if (!record) return null;

    record.invalidated = true;
    record.invalidatedAt = new Date();
    record.invalidatedReason = reason;
    return record;
  }

  public async assertValidToken(batchId: string, token: string): Promise<void> {
    const record = this.tokensByBatch.get(batchId);
    if (!record) {
      throw new DryRunTokenInvalidatedError(
        batchId,
        `No dry-run token found for batch '${batchId}'. A dry-run must be completed before real load.`
      );
    }
    if (record.invalidated) {
      throw new DryRunTokenInvalidatedError(
        batchId,
        `Dry-run token for batch '${batchId}' was invalidated: ${record.invalidatedReason ?? 'unknown reason'}. A new dry-run is required before real load.`
      );
    }
    if (record.token !== token) {
      throw new DryRunTokenInvalidatedError(
        batchId,
        `Supplied dry-run token does not match active token for batch '${batchId}'.`
      );
    }
  }

  public clear(): void {
    this.tokensByBatch.clear();
  }
}
