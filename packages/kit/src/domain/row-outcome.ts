export const RowOutcome = {
  PENDING: "pending",
  LOADED: "loaded",
  REJECTED: "rejected",
  MERGED: "merged",
  SKIPPED: "skipped"
} as const;

export type RowOutcomeType = typeof RowOutcome[keyof typeof RowOutcome];

export interface ReconciliationCounts {
  source: number;
  loaded: number;
  rejected: number;
  merged: number;
  skipped: number;
  pending: number;
}

export type ReconciliationResult = "OK" | "NOT_OK" | "PARTIAL";

export function evaluateReconciliation(counts: ReconciliationCounts): {
  unaccounted: number;
  result: ReconciliationResult;
} {
  const accounted = counts.loaded + counts.rejected + counts.merged + counts.skipped;
  const unaccounted = counts.source - accounted - counts.pending;

  if (counts.pending > 0) {
    return { unaccounted, result: "PARTIAL" };
  }

  if (unaccounted === 0 && counts.source === accounted) {
    return { unaccounted: 0, result: "OK" };
  }

  return { unaccounted, result: "NOT_OK" };
}
