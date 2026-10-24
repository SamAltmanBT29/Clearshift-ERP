/**
 * ClearShift Migration Kit — Sensitive Data Protection & Redaction (KIT-16 / PLT-12)
 *
 * Constraints & Invariants:
 * - Sensitive raw values are omitted/redacted by default in all exports.
 * - No secrets, raw passwords, authentication tokens, government IDs (SSN),
 *   bank account numbers, IBANs, or compensation/salary data may be exported.
 * - Canonical in-memory or database records are never modified.
 *
 * @module migration-kit/reports/redactor
 */

import type { RejectReportRow } from '@clearshift/contracts';

export const REDACTED_PLACEHOLDER = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /^(password|passwd|secret|token|api_?key|auth_?token|access_?token|refresh_?token|ssn|social_?security|bank_?account|account_?no|account_?number|iban|routing_?number|swift|credit_?card|card_?number|cvv|pin|salary|wage|compensation|national_?id|tax_?id)$/i;

const SENSITIVE_VALUE_PATTERNS = [
  // SSN: 000-00-0000
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // 16-digit credit card pattern
  /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
  // IBAN pattern: 2 letters + 2 digits + alphanumeric up to 30 chars
  /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
];

/**
 * Checks whether a given field/property name is sensitive.
 */
export function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  const normalized = key.trim().toLowerCase().replace(/[-_.]/g, '');
  if (
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('bankaccount') ||
    normalized.includes('accountnumber') ||
    normalized.includes('iban') ||
    normalized.includes('routingnumber') ||
    normalized.includes('creditcard') ||
    normalized.includes('cardnumber') ||
    normalized.includes('ssn') ||
    normalized.includes('salary') ||
    normalized.includes('wage') ||
    normalized.includes('taxid') ||
    normalized.includes('nationalid')
  ) {
    return true;
  }
  return SENSITIVE_KEY_PATTERN.test(key.trim());
}

/**
 * Sanitizes any sensitive string content (e.g. error strings containing leaked tokens or SSNs).
 */
export function createSafeMessage(message: unknown): string {
  if (message === null || message === undefined) return '';
  let str = String(message);

  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    str = str.replace(pattern, REDACTED_PLACEHOLDER);
  }

  return str;
}

/**
 * Redacts sensitive fields from a data record without mutating the input object.
 */
export function redactRecord(
  record: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!record || typeof record !== 'object') {
    return {};
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED_PLACEHOLDER;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactRecord(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === 'object'
          ? redactRecord(item as Record<string, unknown>)
          : isSensitiveKey(key)
            ? REDACTED_PLACEHOLDER
            : item
      );
    } else if (typeof value === 'string') {
      result[key] = createSafeMessage(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Sanitizes and formats an input reject record into a compliant RejectReportRow.
 * Ensures sensitive raw values are omitted/redacted and messages are safe.
 */
export function sanitizeRejectRow(input: {
  sourceRow: number;
  entity: string;
  reasonCode: string;
  safeMessage?: string | undefined;
  message?: string | undefined;
  reasonText?: string | undefined;
  ruleId?: string | undefined;
  module?: string | undefined;
  rawPayload?: Record<string, unknown> | undefined;
}): RejectReportRow {
  const rawMsg =
    input.safeMessage ?? input.message ?? input.reasonText ?? 'Validation or pipeline rejection';
  const safeMessage = createSafeMessage(rawMsg);

  let rawSnippet: string | undefined = undefined;
  if (input.rawPayload) {
    const redactedPayload = redactRecord(input.rawPayload);
    rawSnippet = JSON.stringify(redactedPayload);
  }

  return {
    sourceRow: input.sourceRow,
    entity: input.entity,
    reasonCode: input.reasonCode,
    safeMessage,
    ruleId: input.ruleId,
    module: input.module,
    rawSnippet,
  };
}
