/**
 * ClearShift Migration Kit — Reconciliation Export & Formula Defense (KIT-09 / KIT-16)
 *
 * Implements deterministic formula-safe reconciliation report generation
 * complying with RFC 4180 and CSV formula injection defense.
 *
 * @module migration-kit/reconcile/export
 */

import type { KitReconciliationSummary, KitRowOutcomeRecord } from '@clearshift/contracts';

/**
 * Escapes a cell value for CSV, sanitizing leading dangerous spreadsheet formula characters
 * (=, +, -, @, \t, \r) by prepending a single quote.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);

  // CSV Formula Injection Defense (OWASP / ClearShift CSV Safety Rule)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // RFC 4180 escaping: if contains comma, quote, or newline, wrap in quotes and escape quotes
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Generates formula-safe CSV lines from an array of record objects
 */
export function generateCsv<T extends Record<string, unknown>>(
  records: T[],
  headers: (keyof T & string)[]
): string {
  const headerLine = headers.map((h) => sanitizeCsvCell(h)).join(',');
  const rowLines = records.map((record) =>
    headers.map((h) => sanitizeCsvCell(record[h])).join(',')
  );
  return [headerLine, ...rowLines].join('\r\n');
}

/**
 * Exports reconciliation summary and row outcomes as formula-safe CSV text
 */
export function exportReconciliationReportCsv(
  summary: KitReconciliationSummary,
  outcomes: KitRowOutcomeRecord[]
): string {
  const metaLines = [
    `# ClearShift Migration Kit V1 — Reconciliation Report`,
    `# Batch ID: ${summary.batchId}`,
    `# Evaluated At: ${summary.evaluatedAt.toISOString()}`,
    `# Result: ${summary.result}`,
    `# Signoff Allowed: ${summary.signoffAllowed}`,
    `# Formula: source (${summary.sourceCount}) = loaded (${summary.loadedCount}) + rejected (${summary.rejectedCount}) + merged (${summary.mergedCount}) + skipped (${summary.skippedCount})`,
    `# Unaccounted Rows: ${summary.unaccountedCount}`,
    ``,
  ];

  const headers: (keyof KitRowOutcomeRecord & string)[] = [
    'sourceRow',
    'outcome',
    'targetId',
    'reasonCode',
    'reasonText',
    'operator',
    'operatorRole',
    'policyCode',
    'idempotencyKey',
    'createdAt',
  ];

  const formattedOutcomes = outcomes.map((o) => ({
    ...o,
    createdAt: o.createdAt ? o.createdAt.toISOString() : '',
  }));

  const outcomeCsv = generateCsv(formattedOutcomes as unknown as Record<string, unknown>[], headers);

  return metaLines.join('\r\n') + outcomeCsv;
}
