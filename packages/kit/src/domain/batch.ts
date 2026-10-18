export const BatchStatus = {
  CREATED: "created",
  EXTRACTED: "extracted",
  PROFILED: "profiled",
  CLEANED: "cleaned",
  MAPPED: "mapped",
  DRY_RUN_OK: "dry_run_ok",
  LOADING: "loading",
  LOAD_HALTED: "load_halted",
  RESUMED: "resumed",
  LOADED: "loaded",
  VALIDATED: "validated",
  RECONCILED: "reconciled",
  FAILED: "failed"
} as const;

export type BatchStatusType = typeof BatchStatus[keyof typeof BatchStatus];

export interface BatchThresholdConfig {
  maxFailureRate: number; // default 0.10 (10%)
  minAttemptedRows: number; // default 50
}

export const DEFAULT_THRESHOLD_CONFIG: BatchThresholdConfig = {
  maxFailureRate: 0.10,
  minAttemptedRows: 50
};

export function shouldHaltBatch(
  failedCount: number,
  attemptedCount: number,
  config: BatchThresholdConfig = DEFAULT_THRESHOLD_CONFIG
): boolean {
  if (attemptedCount < config.minAttemptedRows) {
    return false;
  }
  const failureRate = failedCount / attemptedCount;
  return failureRate > config.maxFailureRate;
}
