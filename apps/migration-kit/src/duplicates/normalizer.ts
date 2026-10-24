/**
 * ClearShift Migration Kit — Exact Duplicate Normalizers (KIT-10)
 *
 * Implements deterministic normalization for V1 exact duplicate candidate matching rules:
 * 1. RULE_DUP_EMAIL_EXACT: Same normalized email (trimmed, lowercase).
 * 2. RULE_DUP_PHONE_NAME_EXACT: Same normalized phone + name.
 * 3. RULE_DUP_TAX_ID_EXACT: Same tax number within entity/jurisdiction scope.
 *
 * Invariant (SDS §11.1 & Core Rules):
 * - No fuzzy auto-merge is permitted.
 * - A different company with a shared name stays separate.
 *
 * @module migration-kit/duplicates/normalizer
 */

import { ExactDuplicateRuleId, type ExactDuplicateRuleIdType } from '@clearshift/contracts';

/**
 * Normalizes email: trim whitespace, convert to lowercase.
 */
export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') return '';
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes('@')) return '';
  return trimmed;
}

/**
 * Normalizes phone number: strips non-digit characters (preserving leading +).
 */
export function normalizePhone(phone: unknown): string {
  if (typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  const digitsOnly = trimmed.replace(/[^\d+]/g, '');
  return digitsOnly;
}

/**
 * Normalizes name: trim, collapse spaces, convert to lowercase.
 */
export function normalizeName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Normalizes phone + name composite key.
 * If either component is blank, returns empty string (prevents false positive grouping).
 */
export function normalizePhoneAndName(
  phone: unknown,
  name: unknown
): { normalizedPhone: string; normalizedName: string; compositeKey: string } {
  const normPhone = normalizePhone(phone);
  const normName = normalizeName(name);

  if (!normPhone || !normName) {
    return { normalizedPhone: normPhone, normalizedName: normName, compositeKey: '' };
  }

  return {
    normalizedPhone: normPhone,
    normalizedName: normName,
    compositeKey: `${normPhone}::${normName}`,
  };
}

/**
 * Normalizes tax number within entity/jurisdiction scope.
 * Format: `<entityScope>::<jurisdiction>::<taxNumber>`
 */
export function normalizeTaxId(
  taxId: unknown,
  entityScope: string,
  jurisdiction?: string
): { normalizedTaxId: string; compositeKey: string } {
  if (typeof taxId !== 'string') {
    return { normalizedTaxId: '', compositeKey: '' };
  }
  const cleanedTaxId = taxId.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!cleanedTaxId) {
    return { normalizedTaxId: '', compositeKey: '' };
  }

  const scope = entityScope.trim().toLowerCase();
  const juris = (jurisdiction ?? 'default').trim().toLowerCase();
  const compositeKey = `${scope}::${juris}::${cleanedTaxId}`;

  return {
    normalizedTaxId: cleanedTaxId,
    compositeKey,
  };
}

/**
 * Extracts exact matching keys from a record for a specific matching rule.
 */
export function extractMatchKey(
  row: Record<string, unknown>,
  ruleId: ExactDuplicateRuleIdType,
  options?: { entityScope?: string; jurisdiction?: string }
): { matchKey: string; evidence: Record<string, unknown> } {
  switch (ruleId) {
    case ExactDuplicateRuleId.EMAIL_EXACT: {
      const emailVal = row['email'] ?? row['contact_email'] ?? row['mail'];
      const key = normalizeEmail(emailVal);
      return {
        matchKey: key,
        evidence: {
          rawEmail: emailVal,
          normalizedEmail: key,
          rule: ruleId,
        },
      };
    }

    case ExactDuplicateRuleId.PHONE_NAME_EXACT: {
      const phoneVal = row['phone'] ?? row['mobile'] ?? row['telephone'];
      const nameVal =
        row['name'] ??
        (row['first_name'] && row['last_name']
          ? `${row['first_name']} ${row['last_name']}`
          : row['contact_name']);
      const norm = normalizePhoneAndName(phoneVal, nameVal);
      return {
        matchKey: norm.compositeKey,
        evidence: {
          rawPhone: phoneVal,
          rawName: nameVal,
          normalizedPhone: norm.normalizedPhone,
          normalizedName: norm.normalizedName,
          rule: ruleId,
        },
      };
    }

    case ExactDuplicateRuleId.TAX_ID_EXACT: {
      const taxVal = row['tax_id'] ?? row['tax_number'] ?? row['vat_number'] ?? row['ein'];
      const entityScope = options?.entityScope ?? (row['entity'] as string) ?? 'vendor';
      const jurisdiction = options?.jurisdiction ?? (row['jurisdiction'] as string) ?? (row['country'] as string);
      const norm = normalizeTaxId(taxVal, entityScope, jurisdiction);
      return {
        matchKey: norm.compositeKey,
        evidence: {
          rawTaxId: taxVal,
          normalizedTaxId: norm.normalizedTaxId,
          entityScope,
          jurisdiction: jurisdiction ?? 'default',
          rule: ruleId,
        },
      };
    }

    default:
      return { matchKey: '', evidence: {} };
  }
}
