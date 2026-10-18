import { Result } from "@cs/kernel";

export interface ImportReceipt {
  batchId: string;
  sourceRow: number;
  entity: string;
  schemaVersion: number;
  idempotencyKey: string;
  targetId: string;
  kind: "created" | "linked";
  createdAt: Date;
}

export interface TargetAdapterResult {
  targetId: string;
  receipt: ImportReceipt;
}

export interface TargetAdapterError {
  reasonCode: string;
  message: string;
  field?: string;
}

/**
 * TargetAdapter Port (Decision C4 & KIT-08)
 * Executed in-process to guarantee atomic transaction commits between target entity and import receipt.
 */
export interface TargetAdapter<TRow = unknown> {
  readonly module: string;
  readonly entity: string;
  readonly schemaVersion: number;

  /**
   * Preflight validation during dry-run phase (zero database mutations).
   */
  preflight(batchId: string, rows: TRow[]): Promise<Result<{ validCount: number; rejectCount: number }, TargetAdapterError>>;

  /**
   * Commits target business record and durable import receipt atomically in one local PG transaction.
   */
  importRow(
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    cleanData: TRow
  ): Promise<Result<TargetAdapterResult, TargetAdapterError>>;
}
