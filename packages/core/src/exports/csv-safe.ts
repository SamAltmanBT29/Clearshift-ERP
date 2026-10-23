/**
 * Safe CSV Export, Output Encoding, and SQL Protection Utilities (PLT-12)
 *
 * Constraints (Non-Negotiable):
 * - CSV values beginning after leading whitespace with =, +, - or @ are neutralized
 *   in exported representation; canonical stored data remains unchanged.
 * - All HTML/text content escaped; parameterized SQL only; dynamic identifiers from allow-list.
 */

const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Sanitizes a single cell value for CSV export according to OWASP CSV Injection guidelines.
 * Does NOT mutate the input value or original database records.
 * Neutralizes values beginning after leading whitespace with =, +, -, @, \t, or \r.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = String(value);
  if (str === "") {
    return "";
  }

  // Find index of first non-whitespace character
  const match = str.match(/\S/);
  let safeStr = str;

  if (match && match.index !== undefined) {
    const firstNonWs = str[match.index]!;
    if (FORMULA_TRIGGER_CHARS.has(firstNonWs)) {
      // Neutralize by prefixing the formula character with a single quote '
      // e.g. "=1+1" -> "'=1+1"
      // e.g. "   @SUM(A1)" -> "   '@SUM(A1)"
      safeStr = str.slice(0, match.index) + "'" + str.slice(match.index);
    }
  }

  // Wrap in quotes and escape internal quotes if special delimiters are present
  if (
    safeStr.includes('"') ||
    safeStr.includes(",") ||
    safeStr.includes("\n") ||
    safeStr.includes("\r") ||
    safeStr.includes("\t") ||
    safeStr.startsWith(" ") ||
    safeStr.endsWith(" ")
  ) {
    return `"${safeStr.replace(/"/g, '""')}"`;
  }

  return safeStr;
}

/**
 * Formats an array of cells into a single CSV row line
 */
export function formatSafeCsvRow(cells: unknown[]): string {
  return cells.map(sanitizeCsvCell).join(",");
}

/**
 * Formats a collection of records into a secure CSV string
 */
export function formatSafeCsv(
  records: Record<string, unknown>[],
  columns?: string[]
): string {
  if (records.length === 0) {
    return "";
  }

  const headers = columns ?? Object.keys(records[0]!);
  const headerLine = headers.map(sanitizeCsvCell).join(",");
  const rows = records.map((rec) =>
    headers.map((col) => sanitizeCsvCell(rec[col])).join(",")
  );

  return [headerLine, ...rows].join("\r\n");
}

/**
 * Strictly escapes HTML/text content to prevent Cross-Site Scripting (XSS)
 */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  const str = String(input);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Strictly validates dynamic SQL identifiers against an explicit allow-list.
 * Prevents SQL injection via dynamic table, column, or sort identifiers.
 */
export function assertAllowedSqlIdentifier(
  identifier: string,
  allowlist: readonly string[] | string[]
): string {
  if (!allowlist.includes(identifier)) {
    throw new Error(
      `Unauthorized SQL identifier: '${identifier}'. Must be one of: [${allowlist.join(", ")}]`
    );
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Malformed SQL identifier format: '${identifier}'`);
  }
  return identifier;
}
