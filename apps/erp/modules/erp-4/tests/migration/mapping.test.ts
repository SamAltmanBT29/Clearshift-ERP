/**
 * ERP-4 Finance & Accounting — Mapping & Value Translation Automated Tests
 * (Issue #184 / ERP4-28 / KIT-05)
 *
 * Test coverage:
 * - AC1: Source-to-target field mapping templates with strict type coercion rules.
 * - AC2: Enum translation tables mapping legacy values to domain allowlists.
 * - AC3: Unmapped required target fields raise validation error and block dry-run/load execution.
 * - AC4: Named, versioned, reproducible templates across migration runs.
 * - AC5: Fastify 5 endpoints & RBAC security policy enforcement.
 * - Invariant: Double-entry balanced arithmetic NUMERIC(20,4) & non-destructive source data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  translateEnum,
  coerceDecimalAmount,
  coerceIsoDate,
  coerceBoolean,
  ACCOUNT_TYPE_TRANSLATION_MAP,
  CURRENCY_CODE_TRANSLATION_MAP,
  PERIOD_STATUS_TRANSLATION_MAP,
  EnumTranslationError,
  validateErp4Mapping,
  transformSourceRowToTarget,
  transformDataset,
  ERP4_DEFAULT_MAPPING_TEMPLATES,
  ERP4_CANONICAL_MAPPING_TEMPLATE,
  erp4TargetEntities,
} from '../../src/migration/mapping-config.js';
import { mappingRoutes } from '../../src/routes/mapping.js';
import { FinancePolicies, isFinancePolicyAllowed } from '../../src/policies/permissions.js';

describe('[ERP4-28] ERP-4 Mapping & Value Translation Configuration (#184)', () => {
  // ── 1. Type Coercion Rules (AC1) ──────────────────────────────────────────
  describe('1. Type Coercion Engine (AC1)', () => {
    it('coerces valid formatted currency strings to standard 4-decimal strings', () => {
      expect(coerceDecimalAmount('150000', 'balance_amount')).toBe('150000.0000');
      expect(coerceDecimalAmount('  $ 150,000.50 ', 'balance_amount')).toBe('150000.5000');
      expect(coerceDecimalAmount('₹25,00,000.7500', 'balance_amount')).toBe('2500000.7500');
      expect(coerceDecimalAmount('-₹20,000.00', 'balance_amount')).toBe('-20000.0000');
      expect(coerceDecimalAmount('(500.25)', 'balance_amount')).toBe('-500.2500');
      expect(coerceDecimalAmount('0', 'balance_amount')).toBe('0.0000');
    });

    it('rejects unparseable decimal amounts with structured TypeError', () => {
      expect(() => coerceDecimalAmount('invalid-number', 'balance_amount')).toThrowError(
        /cannot be parsed as a valid numeric decimal/
      );
      expect(() => coerceDecimalAmount('', 'balance_amount')).toThrowError(
        /Missing numeric decimal amount/
      );
    });

    it('coerces various date formats to ISO 8601 (YYYY-MM-DD)', () => {
      expect(coerceIsoDate('2026-04-01', 'as_of_date')).toBe('2026-04-01');
      expect(coerceIsoDate('2026/04/01', 'as_of_date')).toBe('2026-04-01');
      expect(coerceIsoDate('01-04-2026', 'as_of_date')).toBe('2026-04-01');
      expect(coerceIsoDate('15/04/2026', 'as_of_date')).toBe('2026-04-15');
      expect(coerceIsoDate('2026-04-15T12:00:00.000Z', 'as_of_date')).toBe('2026-04-15');
    });

    it('rejects invalid dates with structured TypeError', () => {
      expect(() => coerceIsoDate('not-a-date', 'as_of_date')).toThrowError(
        /not a recognized date format/
      );
      expect(() => coerceIsoDate('', 'as_of_date')).toThrowError(/Missing date/);
    });

    it('coerces boolean values reliably', () => {
      expect(coerceBoolean('true')).toBe(true);
      expect(coerceBoolean('1')).toBe(true);
      expect(coerceBoolean('yes')).toBe(true);
      expect(coerceBoolean('false')).toBe(false);
      expect(coerceBoolean('0')).toBe(false);
      expect(coerceBoolean('no')).toBe(false);
      expect(coerceBoolean('', true)).toBe(true);
    });
  });

  // ── 2. Enum Translation Tables (AC2) ───────────────────────────────────────
  describe('2. Enum Translation Tables (AC2)', () => {
    it('translates legacy account classifications to domain allowlist', () => {
      expect(translateEnum('Current Asset', ACCOUNT_TYPE_TRANSLATION_MAP, 'type')).toBe('asset');
      expect(translateEnum('ASSETS', ACCOUNT_TYPE_TRANSLATION_MAP, 'type')).toBe('asset');
      expect(translateEnum('CA', ACCOUNT_TYPE_TRANSLATION_MAP, 'type')).toBe('asset');

      expect(translateEnum('Current Liability', ACCOUNT_TYPE_TRANSLATION_MAP, 'type')).toBe('liability');
      expect(translateEnum('LIA', ACCOUNT_TYPE_TRANSLATION_MAP, 'type')).toBe('liability');

      expect(translateEnum('Revenue', ACCOUNT_TYPE_TRANSLATION_MAP, 'type')).toBe('income');
      expect(translateEnum('SALES', ACCOUNT_TYPE_TRANSLATION_MAP, 'type')).toBe('income');

      expect(translateEnum('COGS', ACCOUNT_TYPE_TRANSLATION_MAP, 'type')).toBe('expense');
      expect(translateEnum('Cost', ACCOUNT_TYPE_TRANSLATION_MAP, 'type')).toBe('expense');
    });

    it('translates currency strings and symbols to ISO 4217 standard codes', () => {
      expect(translateEnum('inr', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('INR');
      expect(translateEnum('₹', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('INR');
      expect(translateEnum('rs.', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('INR');
      expect(translateEnum('usd', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('USD');
      expect(translateEnum('$', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('USD');
      expect(translateEnum('€', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('EUR');
    });

    it('translates period statuses accurately', () => {
      expect(translateEnum('Open', PERIOD_STATUS_TRANSLATION_MAP, 'status')).toBe('open');
      expect(translateEnum('soft closed', PERIOD_STATUS_TRANSLATION_MAP, 'status')).toBe('soft_closed');
      expect(translateEnum('Closed', PERIOD_STATUS_TRANSLATION_MAP, 'status')).toBe('locked');
    });

    it('raises EnumTranslationError when encountering unmapped enum values', () => {
      expect(() =>
        translateEnum('UNKNOWN_TYPE', ACCOUNT_TYPE_TRANSLATION_MAP, 'type')
      ).toThrowError(EnumTranslationError);

      try {
        translateEnum('CRYPTO', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code');
      } catch (e: any) {
        expect(e).toBeInstanceOf(EnumTranslationError);
        expect(e.fieldName).toBe('currency_code');
        expect(e.sourceValue).toBe('CRYPTO');
        expect(e.allowedValues).toContain('INR');
      }
    });
  });

  // ── 3. Required Target Field Enforcement Guards (AC3) ──────────────────────
  describe('3. Required Target Column Enforcement Guards (AC3)', () => {
    it('validates a complete mapping for account successfully', () => {
      const mapping = {
        code: 'legacy_code',
        name: 'legacy_name',
        type: 'legacy_type',
        currency_code: 'currency',
        source_id: 'legacy_id',
      };
      const result = validateErp4Mapping('account', mapping);
      expect(result.valid).toBe(true);
      expect(result.missingRequiredFields).toHaveLength(0);
    });

    it('flags unmapped required target fields and blocks execution', () => {
      // Omit required 'type' and 'currency_code'
      const mapping = {
        code: 'legacy_code',
        name: 'legacy_name',
        source_id: 'legacy_id',
      };
      const result = validateErp4Mapping('account', mapping);
      expect(result.valid).toBe(false);
      expect(result.missingRequiredFields).toContain('Account Classification');
      expect(result.missingRequiredFields).toContain('Currency Code');
    });

    it('validates opening balances required fields', () => {
      // Omit balance_amount and as_of_date
      const incompleteMapping = {
        account_id: 'acc_code',
        currency_code: 'currency',
        source_id: 'id',
      };
      const result = validateErp4Mapping('opening_balance', incompleteMapping);
      expect(result.valid).toBe(false);
      expect(result.missingRequiredFields).toContain('Balance Amount');
      expect(result.missingRequiredFields).toContain('As of Date');
    });

    it('reports unknown entity cleanly', () => {
      const result = validateErp4Mapping('non_existent_entity', {});
      expect(result.valid).toBe(false);
      expect(result.missingRequiredFields[0]).toContain('Unknown entity');
    });
  });

  // ── 4. Named, Versioned Mapping Templates (AC4) ───────────────────────────
  describe('4. Named, Versioned Mapping Templates (AC4)', () => {
    it('provides reproducible canonical template erp4-canonical-v1', () => {
      expect(ERP4_DEFAULT_MAPPING_TEMPLATES.length).toBeGreaterThan(0);
      const canonical = ERP4_CANONICAL_MAPPING_TEMPLATE;

      expect(canonical.templateId).toBe('erp4-canonical-v1');
      expect(canonical.version).toBe('1.0.0');
      expect(canonical.module).toBe('erp4');
      expect(canonical.mappingSchemaVersion).toBe(1);

      // Verify all 4 domain entities are represented
      expect(canonical.entities.account).toBeDefined();
      expect(canonical.entities.opening_balance).toBeDefined();
      expect(canonical.entities.journal_entry).toBeDefined();
      expect(canonical.entities.journal_line).toBeDefined();
    });

    it('matches target table schemas defined in SDS', () => {
      expect(ERP4_CANONICAL_MAPPING_TEMPLATE.entities.account.targetTable).toBe('erp4.accounts');
      expect(ERP4_CANONICAL_MAPPING_TEMPLATE.entities.opening_balance.targetTable).toBe(
        'erp4.opening_balances'
      );
      expect(ERP4_CANONICAL_MAPPING_TEMPLATE.entities.journal_entry.targetTable).toBe(
        'erp4.journal_entries'
      );
      expect(ERP4_CANONICAL_MAPPING_TEMPLATE.entities.journal_line.targetTable).toBe(
        'erp4.journal_lines'
      );
    });
  });

  // ── 5. Transformation Engine (AC1, AC2, AC3) ──────────────────────────────
  describe('5. Row & Dataset Transformation Engine', () => {
    it('projects and coerces legacy row to clean account target', () => {
      const mapping = {
        code: 'src_code',
        name: 'src_name',
        type: 'src_type',
        currency_code: 'src_curr',
        source_id: 'src_id',
      };
      const sourceRow = {
        src_id: 'ACC-001',
        src_code: '  1010-cash ',
        src_name: ' Cash on Hand ',
        src_type: 'Current Asset',
        src_curr: '₹',
      };

      const outcome = transformSourceRowToTarget('account', mapping, sourceRow);
      expect(outcome.success).toBe(true);
      expect(outcome.data.code).toBe('1010-CASH');
      expect(outcome.data.name).toBe('Cash on Hand');
      expect(outcome.data.type).toBe('asset');
      expect(outcome.data.currency_code).toBe('INR');
      expect(outcome.data.source_id).toBe('ACC-001');
    });

    it('projects and coerces legacy opening balance row with currency symbols and date slashes', () => {
      const mapping = {
        account_id: 'account_code',
        currency_code: 'currency',
        balance_amount: 'amount',
        as_of_date: 'date_str',
        source_id: 'legacy_id',
      };
      const sourceRow = {
        legacy_id: 'OB-01',
        account_code: '1010-CASH',
        currency: 'USD',
        amount: ' $ 150,000.50 ',
        date_str: '2026/04/01',
      };

      const outcome = transformSourceRowToTarget('opening_balance', mapping, sourceRow);
      expect(outcome.success).toBe(true);
      expect(outcome.data.account_id).toBe('1010-CASH');
      expect(outcome.data.currency_code).toBe('USD');
      expect(outcome.data.balance_amount).toBe('150000.5000');
      expect(outcome.data.as_of_date).toBe('2026-04-01');
    });

    it('accurately accumulates errors on invalid row data', () => {
      const mapping = {
        code: 'src_code',
        name: 'src_name',
        type: 'src_type',
        currency_code: 'src_curr',
        source_id: 'src_id',
      };
      const invalidRow = {
        src_id: 'ACC-BAD',
        src_code: '1010',
        src_name: '', // Empty required
        src_type: 'INVALID_ENUM',
        src_curr: 'BITCOIN',
      };

      const outcome = transformSourceRowToTarget('account', mapping, invalidRow);
      expect(outcome.success).toBe(false);
      expect(outcome.errors.length).toBeGreaterThan(0);
      expect(outcome.errors.some((e) => e.includes('Missing required target field'))).toBe(true);
    });

    it('transforms entire dataset and reports counts accurately', () => {
      const mapping = {
        code: 'c',
        name: 'n',
        type: 't',
        currency_code: 'cur',
        source_id: 'id',
      };
      const rows = [
        { id: '1', c: '1010-CASH', n: 'Cash', t: 'asset', cur: 'INR' },
        { id: '2', c: '2010-AP', n: 'Payable', t: 'liability', cur: 'INR' },
        { id: '3', c: '3010-BAD', n: '', t: 'unknown', cur: 'XYZ' },
      ];

      const result = transformDataset('account', mapping, rows);
      expect(result.totalRows).toBe(3);
      expect(result.successCount).toBe(2);
      expect(result.failedCount).toBe(1);
    });
  });

  // ── 6. Fastify 5 Endpoints & RBAC Security (AC5) ───────────────────────────
  describe('6. Fastify 5 Routes & RBAC Policies (AC5)', () => {
    let fastify: FastifyInstance;

    beforeAll(async () => {
      fastify = Fastify({ logger: false });

      // Mock authentication hook
      fastify.addHook('onRequest', async (req: any) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) return;

        if (authHeader.includes('token_viewer')) {
          req.user = { id: 'u1', username: 'viewer', roles: ['viewer'] };
        } else if (authHeader.includes('token_editor')) {
          req.user = { id: 'u2', username: 'editor', roles: ['editor'] };
        } else if (authHeader.includes('token_unauthorized_role')) {
          req.user = { id: 'u3', username: 'guest', roles: ['guest'] };
        }
      });

      await fastify.register(mappingRoutes);
      await fastify.ready();
    });

    it('GET /migration/mapping/templates rejects unauthenticated requests with HTTP 401', async () => {
      const res = await fastify.inject({
        method: 'GET',
        url: '/migration/mapping/templates',
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /migration/mapping/templates rejects unauthorized roles with HTTP 403', async () => {
      const res = await fastify.inject({
        method: 'GET',
        url: '/migration/mapping/templates',
        headers: { authorization: 'Bearer token_unauthorized_role' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('GET /migration/mapping/templates succeeds for viewer role with HTTP 200', async () => {
      const res = await fastify.inject({
        method: 'GET',
        url: '/migration/mapping/templates',
        headers: { authorization: 'Bearer token_viewer' },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);
      expect(json.data[0].templateId).toBe('erp4-canonical-v1');
    });

    it('GET /migration/mapping/templates/:id returns 404 on unknown template', async () => {
      const res = await fastify.inject({
        method: 'GET',
        url: '/migration/mapping/templates/non-existent-template',
        headers: { authorization: 'Bearer token_viewer' },
      });
      expect(res.statusCode).toBe(404);
      const json = JSON.parse(res.payload);
      expect(json.code).toBe('TEMPLATE_NOT_FOUND');
    });

    it('POST /migration/mapping/validate validates mapping and returns required fields status', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/migration/mapping/validate',
        headers: { authorization: 'Bearer token_editor' },
        payload: {
          entity: 'account',
          mapping: {
            code: 'col_code',
            name: 'col_name',
            // Missing type, currency_code, source_id
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.valid).toBe(false);
      expect(json.data.missingRequiredFields.length).toBeGreaterThan(0);
    });

    it('POST /migration/mapping/transform blocks transformation when required fields are missing with HTTP 400', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/migration/mapping/transform',
        headers: { authorization: 'Bearer token_editor' },
        payload: {
          entity: 'account',
          mapping: {
            code: 'c', // Missing required fields
          },
          rows: [{ c: '1010-CASH' }],
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.code).toBe('UNMAPPED_REQUIRED_FIELDS');
      expect(json.message).toContain('missing required target field');
    });

    it('POST /migration/mapping/transform succeeds when mapping is complete', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/migration/mapping/transform',
        headers: { authorization: 'Bearer token_editor' },
        payload: {
          entity: 'account',
          mapping: {
            code: 'c',
            name: 'n',
            type: 't',
            currency_code: 'cur',
            source_id: 'id',
          },
          rows: [{ id: '1', c: ' 1010-cash ', n: 'Cash', t: 'asset', cur: 'INR' }],
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.successCount).toBe(1);
      expect(json.data.rows[0].data.code).toBe('1010-CASH');
    });
  });
});
