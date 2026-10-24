import {
  INGESTION_LIMITS,
  IngestionLimitError,
  IngestionLimitType,
} from '@clearshift/contracts';

export { INGESTION_LIMITS, IngestionLimitError, IngestionLimitType };

/**
 * Validates that a numeric metric does not exceed the declared limit.
 */
export function assertWithinLimit(
  limitName: IngestionLimitType,
  actualValue: number,
  customLimit?: number
): void {
  const limit = customLimit ?? INGESTION_LIMITS[`${limitName}_BYTES` as keyof typeof INGESTION_LIMITS] ?? INGESTION_LIMITS[limitName as keyof typeof INGESTION_LIMITS];
  if (limit !== undefined && actualValue > limit) {
    throw new IngestionLimitError(limitName, limit, actualValue);
  }
}
