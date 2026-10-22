/**
 * ERP-5 HR & Employees — Display Formatting Helpers
 *
 * Formatting that never loses precision: amounts stay strings and are
 * grouped with a regular expression, identifiers are shortened for display
 * only, and a missing value is rendered as an em dash rather than as
 * `undefined` or `null`.
 *
 * @module erp5/web/utils/format
 */

/** The placeholder for a value the record does not carry. */
export const EMPTY_VALUE = '—';

/**
 * Shortens an identifier for display.
 *
 * The full identifier always stays available — in the link target, in the
 * `title` and in the accessible name — so the shortening never hides which
 * record the row refers to.
 */
export function shortIdentifier(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Groups the whole part of a decimal string.
 *
 * The value is never converted to a number: payroll amounts must not lose a
 * digit to binary floating point.
 */
export function formatAmount(value: string): string {
  const [whole = '', fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (!fraction || /^0+$/.test(fraction)) {
    return grouped;
  }
  return `${grouped}.${fraction.replace(/0+$/, '')}`;
}

/** Renders a value that may be absent. */
export function formatOptional(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? EMPTY_VALUE : value;
}
