import type {
  KitBatch,
  KitBatchStep,
  KitBatchStatus,
  CreateKitBatchInput,
  TransitionKitBatchInput,
  ResumeKitBatchInput,
} from '@clearshift/contracts';

/**
 * Filter options when listing batches from registry
 */
export interface BatchListFilter {
  module?: string;
  status?: KitBatchStatus;
  correlationId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Batch Registry Repository Interface
 */
export interface IBatchRegistryRepository {
  create(batch: KitBatch): Promise<KitBatch>;
  findById(id: string): Promise<KitBatch | null>;
  findByNumber(batchNumber: string): Promise<KitBatch | null>;
  update(id: string, updates: Partial<KitBatch>): Promise<KitBatch>;
  list(filter?: BatchListFilter): Promise<KitBatch[]>;
}

/**
 * Immutable Step Ledger Repository Interface
 * Strict Append-Only: No update or delete operations allowed.
 */
export interface IStepLedgerRepository {
  append(step: KitBatchStep): Promise<KitBatchStep>;
  findByBatchId(batchId: string): Promise<KitBatchStep[]>;
  findLatestByBatchId(batchId: string): Promise<KitBatchStep | null>;
  countByBatchId(batchId: string): Promise<number>;
}
