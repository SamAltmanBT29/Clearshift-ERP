/**
 * ERP-2 Sensitive Field Protection & Sanitization Policies
 *
 * Implements:
 *   - FR-ERP2-06: Bank details masked everywhere (screens, API JSON, logs, exports) as `XXXX-XXXX-7890`
 *   - Safe logging redaction for credentials, bearer tokens, salary, and internal SQL
 *
 * @module erp2/policies/field-masking
 */

const MASKED_BANK_REGEX = /^X{4}-X{4}-[A-Za-z0-9]{4}$/;
const DEFAULT_MASKED_BANK = 'XXXX-XXXX-7890';

/**
 * Normalizes and masks a bank account number to the required format: `XXXX-XXXX-####`.
 * Preserves the last 4 characters if available.
 */
export function maskBankDetails(raw?: string | null): string {
  if (!raw) {
    return DEFAULT_MASKED_BANK;
  }

  const trimmed = raw.trim();
  if (MASKED_BANK_REGEX.test(trimmed)) {
    return trimmed;
  }

  // Remove spaces, hyphens, and delimiters
  const clean = trimmed.replace(/[\s\-_.]/g, '');
  if (clean.length >= 4) {
    const last4 = clean.slice(-4).toUpperCase();
    return `XXXX-XXXX-${last4}`;
  }

  return DEFAULT_MASKED_BANK;
}

/**
 * Masks salary values in accordance with shared platform privacy standards.
 */
export function maskSalary(_val?: number | string | null): string {
  return 'XX,XXX';
}

/**
 * Recursively redacts sensitive fields from objects for safe logging, event emission, and error envelopes.
 */
export function sanitizeForLogging<T = unknown>(target: T): T {
  if (target === null || target === undefined) {
    return target;
  }

  if (typeof target === 'string') {
    // Redact SQL statements and token patterns
    if (/(SELECT\s|INSERT\s|UPDATE\s|DELETE\s|FROM\s|WHERE\s)/i.test(target)) {
      return '[REDACTED_SQL_QUERY]' as unknown as T;
    }
    if (/Bearer\s+[A-Za-z0-9\-._~+/]+=*/i.test(target)) {
      return target.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]') as unknown as T;
    }
    return target;
  }

  if (Array.isArray(target)) {
    return target.map((item) => sanitizeForLogging(item)) as unknown as T;
  }

  if (typeof target === 'object') {
    const sanitized: Record<string, unknown> = {};
    const sensitiveExactKeys = new Set([
      'authorization',
      'cookie',
      'set-cookie',
      'password',
      'token',
      'secret',
      'jwt',
      'access_token',
      'refresh_token',
      'argon2hash',
      'argon2_hash',
      'privateenc',
      'private_enc',
      'bearer',
    ]);

    for (const [key, val] of Object.entries(target as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      if (sensitiveExactKeys.has(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else if (lowerKey.includes('bank') && typeof val === 'string') {
        sanitized[key] = maskBankDetails(val);
      } else if (lowerKey.includes('salary')) {
        sanitized[key] = maskSalary(val as any);
      } else {
        sanitized[key] = sanitizeForLogging(val);
      }
    }

    return sanitized as T;
  }

  return target;
}
