/**
 * ClearShift Migration Kit — Rejection Report Exporter (KIT-16)
 *
 * Implements formula-safe, sensitive-data-scrubbed CSV export for rejected rows per
 * SDS ClearShift Migration Kit v2.0 §§3-4, §11.1 and Issue #83.
 *
 * Constraints & Invariants:
 * - Rejects include: source row, entity, reason code, and safe message.
 * - Sensitive raw values (passwords, bank accounts, IBANs, SSNs, compensation) are
 *   omitted or redacted by default.
 * - Neutralizes spreadsheet formula prefixes (=, +, -, @, \t, \r) so cells open as inert text.
 * - Always shows source, loaded, rejected, merged, skipped, and unaccounted counts.
 * - Original stored records and in-memory payloads are never mutated.
 *
 * @module migration-kit/reports/reject-report
 */

import type { RejectReportRow, ReportAccountingCounts } from '@clearshift/contracts';
import { sanitizeCsvCell, formatCsvRow } from './formula-csv.js';
import { sanitizeRejectRow } from './redactor.js';

export interface RawRejectInput {
  sourceRow: number;
  entity?: string | undefined;
  reasonCode?: string | undefined;
  safeMessage?: string | undefined;
  message?: string | undefined;
  reasonText?: string | undefined;
  reason?: string | undefined;
  ruleId?: string | undefined;
  module?: string | undefined;
  rawPayload?: Record<string, unknown> | undefined;
}

export interface RejectReportExportOptions {
  batchId: string;
  module?: string | undefined;
  entity?: string | undefined;
  rows: readonly (RejectReportRow | RawRejectInput)[] | Array<RejectReportRow | RawRejectInput>;
  counts?: Partial<ReportAccountingCounts> | undefined;
  evaluatedAt?: Date | string | undefined;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  } | undefined;
}

/**
 * Serializes rejected rows into an RFC 4180 formula-safe and sensitive-data-redacted CSV report.
 */
export function exportRejectReportCsv(options: RejectReportExportOptions): string {
  const evaluatedAt =
    options.evaluatedAt instanceof Date
      ? options.evaluatedAt.toISOString()
      : typeof options.evaluatedAt === 'string'
        ? options.evaluatedAt
        : new Date().toISOString();

  const moduleName = options.module ?? 'generic';
  const entityName = options.entity ?? 'record';
  const rowCount = options.rows.length;
  const totalCount = options.pagination?.total ?? rowCount;

  // Derive accounting counts, ensuring all 6 metrics are always populated
  const source = options.counts?.sourceCount ?? totalCount;
  const rejected = options.counts?.rejectedCount ?? totalCount;
  const loaded = options.counts?.loadedCount ?? 0;
  const merged = options.counts?.mergedCount ?? 0;
  const skipped = options.counts?.skippedCount ?? 0;
  const unaccounted = options.counts?.unaccountedCount ?? Math.max(0, source - (loaded + rejected + merged + skipped));

  const metadataLines = [
    `# ClearShift Migration Kit V1 — Rejection Report`,
    `# Batch ID: ${sanitizeCsvCell(options.batchId)}`,
    `# Module: ${sanitizeCsvCell(moduleName)} | Entity: ${sanitizeCsvCell(entityName)}`,
    `# Evaluated At: ${evaluatedAt}`,
    `# Exported Rows: ${rowCount} (Total Rejects: ${totalCount})${options.pagination ? ` | Page: ${options.pagination.page} / PageSize: ${options.pagination.pageSize}` : ''}`,
    `# Accounting: source (${source}) = loaded (${loaded}) + rejected (${rejected}) + merged (${merged}) + skipped (${skipped}) | Unaccounted: ${unaccounted}`,
    `# Redaction Notice: Sensitive fields (passwords, bank accounts, SSNs, compensation) omitted or redacted`,
    `# Formula Safe: Neutralized OWASP spreadsheet formula prefixes (=, +, -, @, \\t, \\r)`,
    ``,
  ];

  const headers = [
    'source_row',
    'entity',
    'reason_code',
    'safe_message',
    'rule_id',
    'module',
  ];

  const headerLine = formatCsvRow(headers);

  const rowLines = options.rows.map((r) => {
    const rawInput = r as RawRejectInput;
    const sanitized: RejectReportRow = sanitizeRejectRow({
      sourceRow: rawInput.sourceRow,
      entity: rawInput.entity ?? entityName,
      reasonCode: rawInput.reasonCode ?? 'REJECTED',
      safeMessage: rawInput.safeMessage ?? rawInput.message ?? rawInput.reasonText ?? rawInput.reason,
      ruleId: rawInput.ruleId,
      module: rawInput.module ?? moduleName,
      rawPayload: rawInput.rawPayload,
    });

    return formatCsvRow([
      sanitized.sourceRow,
      sanitized.entity,
      sanitized.reasonCode,
      sanitized.safeMessage,
      sanitized.ruleId ?? '',
      sanitized.module ?? '',
    ]);
  });

  return metadataLines.join('\r\n') + [headerLine, ...rowLines].join('\r\n');
}
