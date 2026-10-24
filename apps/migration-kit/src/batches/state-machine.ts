import {
  KitBatch,
  KitBatchStatus,
  KitBatchStepName,
  assertValidKitBatchTransition,
  canKitBatchTransition,
  isKitBatchTerminalStatus,
  isKitBatchResumableStatus,
  getValidResumeTarget,
  STATUS_TO_STEP_NAME,
  STATUS_TO_CHECKPOINT,
  IllegalBatchStateTransitionError,
} from '@clearshift/contracts';

/**
 * Validates a batch state transition against the business matrix, terminal constraints,
 * and checkpoint invariants.
 */
export function validateBatchTransition(
  batch: KitBatch,
  targetStatus: KitBatchStatus
): void {
  assertValidKitBatchTransition(
    batch.status,
    targetStatus,
    batch.id,
    batch.checkpoint,
    batch.attempt
  );
}

/**
 * Computes the durable checkpoint associated with moving to a target status.
 * Checkpoints represent committed progress:
 * - Successful forward steps advance the checkpoint.
 * - Failure side states preserve the last committed checkpoint for resumption.
 * - `load_failed_partial` sets checkpoint to 'load_checkpoint'.
 */
export function computeNextCheckpoint(
  targetStatus: KitBatchStatus,
  previousCheckpoint: string
): string {
  if (targetStatus === 'load_failed_partial') {
    return 'load_checkpoint';
  }

  if (targetStatus === 'failed' || targetStatus === 'rollback_pending' || targetStatus === 'rollback_blocked') {
    // Preserve the last successful committed checkpoint
    return previousCheckpoint;
  }

  return STATUS_TO_CHECKPOINT[targetStatus] || previousCheckpoint;
}

/**
 * Resolves the step name for a target state
 */
export function resolveStepName(
  targetStatus: KitBatchStatus,
  overrideName?: KitBatchStepName
): KitBatchStepName {
  if (overrideName) {
    return overrideName;
  }
  const inferred = STATUS_TO_STEP_NAME[targetStatus];
  if (inferred) {
    return inferred;
  }
  return 'extract';
}

export {
  assertValidKitBatchTransition,
  canKitBatchTransition,
  isKitBatchTerminalStatus,
  isKitBatchResumableStatus,
  getValidResumeTarget,
  IllegalBatchStateTransitionError,
};
