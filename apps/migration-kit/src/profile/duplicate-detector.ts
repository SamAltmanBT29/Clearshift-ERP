import { DuplicateCandidateReport } from '@clearshift/contracts';

export interface DuplicateDetectionOptions {
  keyFields?: string[];
}

export interface DuplicateDetectionResult {
  report: DuplicateCandidateReport;
  duplicateRowIndices: number[];
  keyOccurrences: Map<string, number[]>;
}

/**
 * Normalizes a key value for deterministic exact matching
 */
export function normalizeKeyValue(value: string | undefined): string {
  if (value === undefined || value === null) return '';
  const trimmed = value.trim();
  // Lowercase if email
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

/**
 * Detects exact duplicate candidates across declared key columns
 */
export function detectExactDuplicates(
  rows: Array<{ sourceRow?: number; payload: Record<string, string> }>,
  options: DuplicateDetectionOptions = {}
): DuplicateDetectionResult {
  const keyFields = options.keyFields && options.keyFields.length > 0
    ? options.keyFields
    : ['email']; // default to email if not specified

  const keyMap = new Map<string, number[]>();

  rows.forEach((row, idx) => {
    const rowNumber = row.sourceRow ?? (idx + 1);
    const keyParts: string[] = [];

    for (const f of keyFields) {
      const val = normalizeKeyValue(row.payload[f]);
      keyParts.push(val);
    }

    // If key parts are completely empty, ignore from duplicate key clustering
    const isAllBlank = keyParts.every((p) => p === '');
    if (isAllBlank) return;

    const compositeKey = keyParts.join('::');
    const existing = keyMap.get(compositeKey) || [];
    existing.push(rowNumber);
    keyMap.set(compositeKey, existing);
  });

  const duplicateRowIndices: number[] = [];
  const duplicateKeys: string[] = [];

  for (const [key, indices] of keyMap.entries()) {
    if (indices.length > 1) {
      duplicateKeys.push(key);
      for (const idx of indices) {
        duplicateRowIndices.push(idx);
      }
    }
  }

  duplicateRowIndices.sort((a, b) => a - b);

  return {
    report: {
      keyFields,
      totalDuplicates: duplicateRowIndices.length,
      uniqueDuplicateKeys: duplicateKeys.length,
      sampleDuplicateKeys: duplicateKeys.slice(0, 10),
    },
    duplicateRowIndices,
    keyOccurrences: keyMap,
  };
}
