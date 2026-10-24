/**
 * ClearShift Migration Kit — OWASP Formula-Safe CSV Generator (KIT-16 / PLT-12)
 *
 * Constraints & Invariants:
 * - Neutralizes formula prefixes (=, +, -, @, \t, \r) appearing after optional leading whitespace
 *   in exported CSV text by prepending a single quote (').
 * - Adheres to RFC 4180 CSV escaping for delimiters, newlines, and double quotes.
 * - Original stored records and in-memory payloads are NEVER mutated.
 * - Neutralized text opens safely as inert string content in spreadsheet viewers
 *   (Excel, LibreOffice Calc, Google Sheets), preventing DDE / formula execution.
 *
 * @module migration-kit/reports/formula-csv
 */

export const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Neutralizes dangerous spreadsheet formula trigger characters in a cell string.
 * Does not mutate the source value.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);
  if (str === '') {
    return '';
  }

  // Find index of first non-space character (spaces allowed before trigger, but \t and \r are triggers)
  const match = str.match(/[^ ]/);
  let safeStr = str;

  if (match && match.index !== undefined) {
    const firstNonSpace = str[match.index]!;
    if (FORMULA_TRIGGER_CHARS.has(firstNonSpace)) {
      // Neutralize by prepending a single quote before the formula character
      // e.g. "=1+1" -> "'=1+1"
      // e.g. "  @SUM(A1)" -> "  '@SUM(A1)"
      // e.g. "\tTab" -> "'\tTab"
      safeStr = str.slice(0, match.index) + "'" + str.slice(match.index);
    }
  }

  // RFC 4180 escaping: wrap in double quotes if string contains comma, quote, newline, tab, or whitespace padding
  if (
    safeStr.includes('"') ||
    safeStr.includes(',') ||
    safeStr.includes('\n') ||
    safeStr.includes('\r') ||
    safeStr.includes('\t') ||
    safeStr.startsWith(' ') ||
    safeStr.endsWith(' ')
  ) {
    return `"${safeStr.replace(/"/g, '""')}"`;
  }

  return safeStr;
}

/**
 * Checks whether a raw cell string begins with a dangerous formula prefix.
 */
export function hasFormulaPrefix(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const str = String(value);
  const match = str.match(/[^ ]/);
  if (!match || match.index === undefined) return false;
  return FORMULA_TRIGGER_CHARS.has(str[match.index]!);
}

/**
 * Formats a single row of cells into an RFC 4180 formula-safe CSV line.
 */
export function formatCsvRow(cells: unknown[]): string {
  return cells.map(sanitizeCsvCell).join(',');
}

/**
 * Formats an array of records into a complete RFC 4180 formula-safe CSV string.
 * Canonical records are untouched.
 */
export function formatCsvTable<T extends Record<string, unknown>>(
  records: T[],
  columns?: (keyof T & string)[]
): string {
  if (records.length === 0) {
    return '';
  }

  const headers = columns ?? (Object.keys(records[0]!) as (keyof T & string)[]);
  const headerLine = headers.map((h) => sanitizeCsvCell(h)).join(',');
  const rowLines = records.map((rec) =>
    headers.map((col) => sanitizeCsvCell(rec[col])).join(',')
  );

  return [headerLine, ...rowLines].join('\r\n');
}
