/**
 * Per-Key Normalizers (Decision H4)
 * Applied deterministically across CRM & ERP modules to ensure exact-duplicate detection.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  // Strip spaces, dashes, parentheses; preserve leading '+'
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

export function normalizeName(name: string): string {
  // Unicode NFKC normalization + casefold (lowercase)
  return name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeSku(sku: string): string {
  // Uppercase + trim, preserving hyphens
  return sku.trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeTaxNumber(taxNumber: string): string {
  // Strip whitespace and common punctuation delimiters
  return taxNumber.trim().toUpperCase().replace(/[\s.-]/g, "");
}
