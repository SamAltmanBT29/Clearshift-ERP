/**
 * ERP-1 Products & Inventory — Sensitive Field Masking Policy
 *
 * Implements:
 *   - Automatic field-level masking before serialization/export (PLT-12 / SDS §9.4).
 *   - Bank account masking as XXXX-XXXX-7890 (or XXXX-XXXX-XXXX).
 *   - Salary and compensation masking as XX,XXX unless caller has Admin role.
 *   - Secret and credential redaction as [REDACTED].
 *
 * @module erp1/policies/field-masking
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { Roles, type RoleType } from '@clearshift/contracts';

const BANK_FIELD = /(^|_)(bank_account_number|bank_account|account_number|iban|routing_number|supplier_bank_account)$/i;
const SALARY_FIELD = /(^|_)(salary|base_pay|hourly_rate|compensation|annual_salary|supplier_tax_id)$/i;
const SECRET_FIELD = /(password|token|secret|credential|private_key)/i;

export function maskErp1SensitiveFields<T>(value: T, roles: RoleType[] = []): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskErp1SensitiveFields(item, roles)) as T;
  }
  if (!value || typeof value !== 'object' || value instanceof Date) return value;

  const result: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) {
      result[key] = '[REDACTED]';
    } else if (BANK_FIELD.test(key)) {
      const digits = typeof fieldValue === 'string' ? fieldValue.replace(/\D/g, '') : '';
      result[key] = digits.length >= 4 ? `XXXX-XXXX-${digits.slice(-4)}` : 'XXXX-XXXX-XXXX';
    } else if (SALARY_FIELD.test(key) && !roles.includes(Roles.ADMIN)) {
      result[key] = 'XX,XXX';
    } else {
      result[key] = maskErp1SensitiveFields(fieldValue, roles);
    }
  }
  return result as T;
}

export const fieldMaskingPluginAsync: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onSend', async (request, reply, payload) => {
    const contentType = reply.getHeader('content-type');
    if (
      typeof payload !== 'string' ||
      typeof contentType !== 'string' ||
      !contentType.includes('application/json')
    ) {
      return payload;
    }

    try {
      const parsed: unknown = JSON.parse(payload);
      return JSON.stringify(maskErp1SensitiveFields(parsed, request.user?.roles ?? []));
    } catch {
      return payload;
    }
  });
};

export const erp1FieldMaskingPlugin = fp(fieldMaskingPluginAsync, {
  name: 'erp1-field-masking-plugin',
  fastify: '5.x',
});
