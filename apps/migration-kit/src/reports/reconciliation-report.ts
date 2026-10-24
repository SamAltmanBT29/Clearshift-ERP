/**
 * ClearShift Migration Kit — Reconciliation Report Exporter (KIT-16)
 *
 * Implements formula-safe CSV export for Step 7 Reconciliation reports per
 * SDS ClearShift Migration Kit v2.0 §§3-4, §11.1 and Issue #83.
 *
 * Constraints & Invariants:
 * - Always shows: source, loaded, rejected, merged, skipped, and unaccounted counts.
 * - Mathematical row conservation: source = loaded + rejected + merged + skipped; unaccounted = 0.
 * - Status is OK only when the conservation formula holds and unaccounted = 0.
 * - Neutralizes formula prefixes (=, +, -, @, \t, \r) so cells open as inert text.
 * - Canonical outcome ledger and batch records are never modified.
 *
 * @module migration-kit/reports/reconciliation-report
 */

import type {
  KitReconciliationSummary,
  KitRowOutcomeRecord,
  ReconciliationReportData,
} from '@clearshift/contracts';
import { sanitizeCsvCell, formatCsvRow } from './formula-csv.js';

export interface ReconciliationReportExportOptions {
  batchId: string;
  module?: string | undefined;
  entity?: string | undefined;
  sourceCount: number;
  loadedCount: number;
  rejectedCount: number;
  mergedCount: number;
  skippedCount: number;
  unaccountedCount?: number | undefined;
  formulaHolds?: boolean | undefined;
  result?: 'OK' | 'reconciliation_failed' | undefined;
  signoffAllowed?: boolean | undefined;
  failureReasons?: string[] | undefined;
  evaluatedAt?: Date | string | undefined;
  outcomes?: KitRowOutcomeRecord[] | undefined;
}

/**
 * Serializes reconciliation summary and ledger outcomes into an RFC 4180 formula-safe CSV report.
 */
export function exportReconciliationReportCsv(
  options: ReconciliationReportExportOptions
): string {
  const evaluatedAt =
    options.evaluatedAt instanceof Date
      ? options.evaluatedAt.toISOString()
      : typeof options.evaluatedAt === 'string'
        ? options.evaluatedAt
        : new Date().toISOString();

  const moduleName = options.module ?? 'generic';
  const entityName = options.entity ?? 'record';

  const source = options.sourceCount;
  const loaded = options.loadedCount;
  const rejected = options.rejectedCount;
  const merged = options.mergedCount;
  const skipped = options.skippedCount;

  const accounted = loaded + rejected + merged + skipped;
  const unaccounted = options.unaccountedCount ?? source - accounted;
  const formulaHolds = options.formulaHolds ?? (source === accounted && unaccounted === 0);
  const isOk = formulaHolds && unaccounted === 0;
  const result = options.result ?? (isOk ? 'OK' : 'reconciliation_failed');
  const signoffAllowed = options.signoffAllowed ?? isOk;

  const metadataLines = [
    `# ClearShift Migration Kit V1 — Reconciliation Report`,
    `# Batch ID: ${sanitizeCsvCell(options.batchId)}`,
    `# Module: ${sanitizeCsvCell(moduleName)} | Entity: ${sanitizeCsvCell(entityName)}`,
    `# Evaluated At: ${evaluatedAt}`,
    `# Result: ${result}`,
    `# Signoff Allowed: ${signoffAllowed}`,
    `# Conservation Formula: source (${source}) = loaded (${loaded}) + rejected (${rejected}) + merged (${merged}) + skipped (${skipped})`,
    `# Unaccounted Rows: ${unaccounted}`,
    `# Formula Holds: ${formulaHolds}`,
    `# Formula Safe: Neutralized OWASP spreadsheet formula prefixes (=, +, -, @, \\t, \\r)`,
  ];

  if (options.failureReasons && options.failureReasons.length > 0) {
    for (const reason of options.failureReasons) {
      metadataLines.push(`# Failure Reason: ${sanitizeCsvCell(reason)}`);
    }
  }

  metadataLines.push('');

  // Summary Metrics Table
  const summaryHeaders = ['metric', 'count', 'notes'];
  const summaryRows = [
    formatCsvRow(summaryHeaders),
    formatCsvRow(['source_count', source, 'Total parsed source rows']),
    formatCsvRow(['loaded_count', loaded, 'Successfully imported business records']),
    formatCsvRow(['rejected_count', rejected, 'Validation or domain rule rejections']),
    formatCsvRow(['merged_count', merged, 'Exact duplicate candidates merged to golden']),
    formatCsvRow(['skipped_count', skipped, 'Operator-approved skips with policy code']),
    formatCsvRow(['unaccounted_count', unaccounted, 'Unaccounted rows (must equal 0)']),
    formatCsvRow(['formula_holds', formulaHolds, 'source == loaded + rejected + merged + skipped']),
    formatCsvRow(['reconciliation_result', result, 'Reconciliation status']),
    formatCsvRow(['signoff_allowed', signoffAllowed, 'Production signoff permission']),
  ];

  let output = metadataLines.join('\r\n') + summaryRows.join('\r\n');

  // If detailed ledger outcomes are provided, append ledger table
  if (options.outcomes && options.outcomes.length > 0) {
    const outcomeHeaders = [
      'source_row',
      'outcome',
      'target_id',
      'reason_code',
      'reason_text',
      'operator',
      'operator_role',
      'policy_code',
      'idempotency_key',
      'created_at',
    ];

    const outcomeHeaderLine = formatCsvRow(outcomeHeaders);
    const outcomeLines = options.outcomes.map((o) =>
      formatCsvRow([
        o.sourceRow,
        o.outcome,
        o.targetId ?? '',
        o.reasonCode ?? '',
        o.reasonText ?? '',
        o.operator ?? '',
        o.operatorRole ?? '',
        o.policyCode ?? '',
        o.idempotencyKey ?? '',
        o.createdAt instanceof Date ? o.createdAt.toISOString() : (o.createdAt ?? ''),
      ])
    );

    output += '\r\n\r\n# Detailed Row Outcome Ledger\r\n' + [outcomeHeaderLine, ...outcomeLines].join('\r\n');
  }

  return output;
}

/**
 * Convenience wrapper accepting KitReconciliationSummary and outcomes
 */
export function exportKitReconciliationSummaryCsv(
  summary: KitReconciliationSummary,
  outcomes?: KitRowOutcomeRecord[]
): string {
  return exportReconciliationReportCsv({
    batchId: summary.batchId,
    sourceCount: summary.sourceCount,
    loadedCount: summary.loadedCount,
    rejectedCount: summary.rejectedCount,
    mergedCount: summary.mergedCount,
    skippedCount: summary.skippedCount,
    unaccountedCount: summary.unaccountedCount,
    formulaHolds: summary.formulaHolds,
    result: summary.result,
    signoffAllowed: summary.signoffAllowed,
    failureReasons: summary.failureReasons,
    evaluatedAt: summary.evaluatedAt,
    outcomes,
  });
}

/**
 * Convenience wrapper accepting ReconciliationReportData schema
 */
export function exportReconciliationReportDataCsv(
  data: ReconciliationReportData,
  outcomes?: KitRowOutcomeRecord[]
): string {
  return exportReconciliationReportCsv({
    batchId: data.batchId,
    module: data.module,
    entity: data.entity,
    sourceCount: data.sourceCount,
    loadedCount: data.loadedCount,
    rejectedCount: data.rejectedCount,
    mergedCount: data.mergedCount,
    skippedCount: data.skippedCount,
    unaccountedCount: data.unaccountedCount,
    formulaHolds: data.formulaHolds,
    result: data.result,
    signoffAllowed: data.signoffAllowed,
    failureReasons: data.failureReasons,
    evaluatedAt: data.evaluatedAt,
    outcomes,
  });
}
