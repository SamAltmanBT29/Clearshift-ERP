/**
 * ERP-4 Finance & Accounting — Field-Level Sensitive Data Masking Policy (PLT-06 / ERP4-09)
 *
 * Enforces server-side field-level protection before serialization and CSV export.
 *
 * Non-negotiable masking invariants:
 *   1. Credentials, tokens, secrets: NEVER visible to ANY role (including Admin) -> `[REDACTED]`
 *   2. Bank details (account numbers, IBANs): Masked for ALL roles -> `XXXX-XXXX-7890`
 *   3. Salaries & compensation: Visible to Admin ONLY; masked for Viewer, Editor, Analyst, Migration Runner -> `XX,XXX` or `salary hidden`
 *   4. Government identifiers (SSN, Tax ID): Masked for ALL roles -> `***-**-6789`
 *   5. Raw rows, credentials, and secrets NEVER logged to application logs or error envelopes
 *
 * @module erp4/policies/masking
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { Roles, type RoleType } from '@cs/identity';

export const SENSITIVE_FINANCE_FIELDS = {
  CREDENTIALS: [
    'password',
    'password_hash',
    'secret',
    'token',
    'access_token',
    'refresh_token',
    'jwt',
    'signing_key',
    'private_key',
  ],
  BANK_DETAILS: [
    'bank_account',
    'bank_account_number',
    'account_number',
    'bank_account_num',
    'iban',
    'routing_number',
    'swift_code',
  ],
  SALARY: [
    'salary',
    'base_pay',
    'hourly_rate',
    'compensation',
    'annual_salary',
    'wage',
  ],
  GOVERNMENT_IDS: [
    'ssn',
    'tax_id',
    'national_id',
    'aadhaar',
    'pan',
  ],
} as const;

/**
 * Masks a bank account or financial identifier to show only the last 4 digits:
 * Format: `XXXX-XXXX-7890`
 */
export function maskBankAccountNumber(value: string | number): string {
  const str = String(value).trim();
  if (str.length <= 4) {
    return 'XXXX-XXXX-XXXX';
  }
  const lastFour = str.slice(-4);
  return `XXXX-XXXX-${lastFour}`;
}

/**
 * Masks salary for non-admin viewers:
 * Format: `XX,XXX` (or 0 for numeric fields)
 */
export function maskSalary(value: unknown): string | number {
  if (typeof value === 'number') {
    return 0;
  }
  return 'XX,XXX';
}

/**
 * Masks government identifier:
 * Format: `***-**-6789`
 */
export function maskGovernmentId(value: string): string {
  const str = String(value).trim();
  if (str.length <= 4) {
    return '***-**-****';
  }
  const lastFour = str.slice(-4);
  return `***-**-${lastFour}`;
}

/**
 * Applies field-level masking recursively to any record before serialization.
 */
export function maskSensitiveFields<T>(
  data: T,
  roles: readonly (RoleType | string)[] = [],
  visited: WeakSet<object> = new WeakSet()
): T {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle primitives
  if (typeof data !== 'object') {
    return data;
  }

  if (data instanceof Date) {
    return data;
  }

  if (visited.has(data as object)) {
    return data;
  }
  visited.add(data as object);

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) => maskSensitiveFields(item, roles, visited)) as unknown as T;
  }

  const isAdmin = roles.includes(Roles.ADMIN) || roles.includes('finance_admin');
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, '');

    // 1. Credentials / Passwords / Secrets / Tokens: Never visible to any role
    if (
      SENSITIVE_FINANCE_FIELDS.CREDENTIALS.some((c) => lowerKey === c.replace(/[-_]/g, '') || lowerKey.endsWith(c.replace(/[-_]/g, '')))
    ) {
      result[key] = '[REDACTED]';
      continue;
    }

    // 2. Bank Account Details: Masked for ALL roles (including Admin)
    if (
      SENSITIVE_FINANCE_FIELDS.BANK_DETAILS.some((b) => lowerKey === b.replace(/[-_]/g, '') || lowerKey.endsWith(b.replace(/[-_]/g, '')))
    ) {
      result[key] = typeof value === 'string' || typeof value === 'number'
        ? maskBankAccountNumber(value)
        : 'XXXX-XXXX-XXXX';
      continue;
    }

    // 3. Government IDs: Masked for ALL roles
    if (
      SENSITIVE_FINANCE_FIELDS.GOVERNMENT_IDS.some((g) => lowerKey === g.replace(/[-_]/g, '') || lowerKey.endsWith(g.replace(/[-_]/g, '')))
    ) {
      result[key] = typeof value === 'string' ? maskGovernmentId(value) : '***-**-****';
      continue;
    }

    // 4. Salary / Compensation: Visible to Admin only
    if (
      SENSITIVE_FINANCE_FIELDS.SALARY.some((s) => lowerKey === s.replace(/[-_]/g, '') || lowerKey.endsWith(s.replace(/[-_]/g, '')))
    ) {
      if (!isAdmin) {
        result[key] = maskSalary(value);
      } else {
        result[key] = value;
      }
      continue;
    }

    // Recursively process nested structures
    if (value && typeof value === 'object') {
      result[key] = maskSensitiveFields(value, roles, visited);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Masks tabular records prior to CSV export.
 */
export function maskCsvExportRecords(
  records: Record<string, any>[],
  roles: readonly (RoleType | string)[] = []
): Record<string, any>[] {
  return records.map((rec) => maskSensitiveFields(rec, roles));
}

/**
 * Fastify plugin registering onSend hook to ensure all JSON responses
 * have sensitive fields sanitized before transmission.
 */
export const fieldMaskingPluginAsync: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onSend', async (request, _reply, payload) => {
    if (typeof payload === 'string' && (payload.startsWith('{') || payload.startsWith('['))) {
      try {
        const parsed = JSON.parse(payload);
        const roles = request.user?.roles ?? [];
        const masked = maskSensitiveFields(parsed, roles);
        return JSON.stringify(masked);
      } catch {
        return payload;
      }
    }
    return payload;
  });
};

export const erp4FieldMaskingPlugin = fp(fieldMaskingPluginAsync, {
  name: 'erp4-field-masking-plugin',
  fastify: '5.x',
});
