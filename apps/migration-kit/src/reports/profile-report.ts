/**
 * ClearShift Migration Kit — Dataset Profiling Report Exporter (KIT-16)
 *
 * Implements formula-safe CSV export for Step 2 Profiling reports per
 * SDS ClearShift Migration Kit v2.0 §§3-4 and Issue #83.
 *
 * Constraints & Invariants:
 * - Neutralizes formula injection prefixes (=, +, -, @, \t, \r) in column names and metric text.
 * - Always shows source, loaded, rejected, merged, skipped, and unaccounted counts.
 * - Never mutates canonical profile data or input records.
 *
 * @module migration-kit/reports/profile-report
 */

import type { ProfileReportData, ReportAccountingCounts } from '@clearshift/contracts';
import { sanitizeCsvCell, formatCsvRow } from './formula-csv.js';

export interface ProfileReportColumnInput {
  name?: string | undefined;
  columnName?: string | undefined;
  inferredType?: string | undefined;
  emptyCount?: number | undefined;
  duplicateCandidateCount?: number | undefined;
  formulaThreatCount?: number | undefined;
  totalRows?: number | undefined;
}

export interface ProfileReportExportOptions {
  batchId: string;
  module?: string | undefined;
  entity?: string | undefined;
  totalRows: number;
  duplicateCount?: number | undefined;
  columns: readonly ProfileReportColumnInput[] | ProfileReportColumnInput[];
  counts?: Partial<ReportAccountingCounts> | undefined;
  evaluatedAt?: Date | string | undefined;
}

/**
 * Serializes dataset profiling metrics into an RFC 4180 formula-safe CSV report.
 */
export function exportProfileReportCsv(options: ProfileReportExportOptions): string {
  const evaluatedAt =
    options.evaluatedAt instanceof Date
      ? options.evaluatedAt.toISOString()
      : typeof options.evaluatedAt === 'string'
        ? options.evaluatedAt
        : new Date().toISOString();

  const moduleName = options.module ?? 'generic';
  const entityName = options.entity ?? 'dataset';
  const totalRows = options.totalRows;
  const duplicateCount = options.duplicateCount ?? 0;

  // Derive accounting counts, ensuring all 6 metrics are always populated
  const source = options.counts?.sourceCount ?? totalRows;
  const loaded = options.counts?.loadedCount ?? 0;
  const rejected = options.counts?.rejectedCount ?? 0;
  const merged = options.counts?.mergedCount ?? duplicateCount;
  const skipped = options.counts?.skippedCount ?? 0;
  const unaccounted = options.counts?.unaccountedCount ?? Math.max(0, source - (loaded + rejected + merged + skipped));

  const metadataLines = [
    `# ClearShift Migration Kit V1 — Dataset Profiling Report`,
    `# Batch ID: ${sanitizeCsvCell(options.batchId)}`,
    `# Module: ${sanitizeCsvCell(moduleName)} | Entity: ${sanitizeCsvCell(entityName)}`,
    `# Evaluated At: ${evaluatedAt}`,
    `# Total Rows: ${totalRows} | Duplicate Candidates: ${duplicateCount}`,
    `# Accounting: source (${source}) = loaded (${loaded}) + rejected (${rejected}) + merged (${merged}) + skipped (${skipped}) | Unaccounted: ${unaccounted}`,
    `# Formula Safe: Neutralized OWASP spreadsheet formula prefixes (=, +, -, @, \\t, \\r)`,
    ``,
  ];

  const headers = [
    'column_name',
    'inferred_type',
    'empty_count',
    'duplicate_candidate_count',
    'formula_threat_count',
    'total_rows',
    'null_percentage',
  ];

  const headerLine = formatCsvRow(headers);

  const rowLines = options.columns.map((col) => {
    const colName = col.columnName ?? col.name ?? 'unknown_column';
    const inferredType = col.inferredType ?? 'string';
    const emptyCount = col.emptyCount ?? 0;
    const dupCount = col.duplicateCandidateCount ?? 0;
    const formulaThreats = col.formulaThreatCount ?? 0;
    const rows = col.totalRows ?? totalRows;
    const nullPct = rows > 0 ? ((emptyCount / rows) * 100).toFixed(2) + '%' : '0.00%';

    return formatCsvRow([
      colName,
      inferredType,
      emptyCount,
      dupCount,
      formulaThreats,
      rows,
      nullPct,
    ]);
  });

  return metadataLines.join('\r\n') + [headerLine, ...rowLines].join('\r\n');
}

/**
 * Convenience wrapper accepting canonical ProfileReportData schema
 */
export function exportProfileReportDataCsv(report: ProfileReportData): string {
  return exportProfileReportCsv({
    batchId: report.batchId,
    module: report.module,
    entity: report.entity,
    totalRows: report.totalRows,
    duplicateCount: report.duplicateCount,
    columns: report.columns,
    counts: report.counts,
    evaluatedAt: report.evaluatedAt,
  });
}
