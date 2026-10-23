/**
 * ERP-4 Finance & Accounting — Cleaning Rules & Field-Level Audit Automated Tests
 * (Issue #183 / ERP4-27 / KIT-04)
 *
 * Test coverage:
 * - AC1: Standard cleaners execute (whitespace trimming, proper case, email, phone, date coercion, decimal clean).
 * - AC2: Every modified value generates an audit entry with source_row, field_name, original_value, cleaned_value, rule_id.
 * - AC3: Unrecoverable required-field anomalies result in structured row rejection with reason code.
 * - AC4: Transformed values match expected clean states.
 * - AC5: Fastify 5 endpoints & RBAC security policy enforcement.
 * - AC6: Formula-safe CSV audit export.
 * - AC7: Non-destructive raw source invariant.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  cleanErp4Dataset,
  exportErp4FieldAuditCsv,
  ERP4_FIELD_CLEAN_RULES,
  ERP4_CLEANER_CONFIG,
} from '../../src/migration/cleaning-config.js';
import { readRawRows, sha256Hex } from '../../src/migration/rules.js';
import { cleaningRoutes } from '../../src/routes/cleaning.js';
import { FinancePolicies, isFinancePolicyAllowed } from '../../src/policies/permissions.js';

const REPO_ROOT = resolve(process.cwd());
const FIXTURE_PATH = resolve(REPO_ROOT, 'sample-data/erp-4/dirty-data-v1.csv');

describe('[ERP4-27] ERP-4 Cleaning Rules & Field-Level Audit (#183)', () => {
  const csvContent = readFileSync(FIXTURE_PATH, 'utf8');
  const rawRows = readRawRows(csvContent);
  const rowsAsRecord = rawRows.map((r) => r as unknown as Record<string, string>);

  describe('1. Standard Cleaners & Normalization (AC1 & AC4)', () => {
    it('accurately cleans whitespace in account names and codes', () => {
      // Row R002 has "  1010-CASH " and "  Cash   on  Hand "
      const r002 = rowsAsRecord.find((r) => r.row_id === 'R002')!;
      expect(r002).toBeDefined();

      const result = cleanErp4Dataset([r002]);
      expect(result.totalRows).toBe(1);
      const cleaned = result.rows[0]!;

      expect(cleaned.outcome).toBe('cleaned');
      expect(cleaned.cleanedData.code).toBe('1010-CASH');
      expect(cleaned.cleanedData.name).toBe('Cash on Hand');
    });

    it('coerces slashed date format to ISO 8601 (YYYY-MM-DD)', () => {
      // Row R033 has "2026/04/01" as as_of_date
      const r033 = rowsAsRecord.find((r) => r.row_id === 'R033')!;
      expect(r033).toBeDefined();

      const result = cleanErp4Dataset([r033]);
      const cleaned = result.rows[0]!;

      expect(cleaned.cleanedData.as_of_date).toBe('2026-04-01');
    });

    it('cleans currency symbols and thousand commas from monetary amounts', () => {
      // Row R033 has ' 150,000.00 '
      const r033 = rowsAsRecord.find((r) => r.row_id === 'R033')!;
      expect(r033).toBeDefined();

      const result = cleanErp4Dataset([r033]);
      const cleaned = result.rows[0]!;

      expect(cleaned.cleanedData.balance_amount).toBe('150000.00');
    });

    it('cleans negative currency amounts properly', () => {
      // Row R034 has '-20000.00'
      const r034 = rowsAsRecord.find((r) => r.row_id === 'R034')!;
      expect(r034).toBeDefined();

      const result = cleanErp4Dataset([r034]);
      const cleaned = result.rows[0]!;

      expect(cleaned.cleanedData.balance_amount).toBe('-20000.00');
    });

    it('proper-cases journal entry descriptions and trims whitespace', () => {
      // Row R054 has "  Rent   and   COGS   payment "
      const r054 = rowsAsRecord.find((r) => r.row_id === 'R054')!;
      expect(r054).toBeDefined();

      const result = cleanErp4Dataset([r054]);
      const cleaned = result.rows[0]!;

      expect(cleaned.cleanedData.description).toBe('Rent and COGS payment');
    });
  });

  describe('2. Field-Level Change Audit Trail Generation (AC2)', () => {
    it('generates an audit entry with source_row, field_name, original_value, cleaned_value, rule_id for every modified field', () => {
      const r002 = rowsAsRecord.find((r) => r.row_id === 'R002')!;
      const result = cleanErp4Dataset([r002]);

      expect(result.audits.length).toBeGreaterThan(0);

      // Verify code audit
      const codeAudit = result.audits.find((a) => a.fieldName === 'code');
      expect(codeAudit).toBeDefined();
      expect(codeAudit?.sourceRow).toBe('R002');
      expect(codeAudit?.originalValue).toBe('  1010-CASH ');
      expect(codeAudit?.cleanedValue).toBe('1010-CASH');
      expect(codeAudit?.ruleId).toBe('RL-TEXT-01');

      // Verify name audit
      const nameAudit = result.audits.find((a) => a.fieldName === 'name');
      expect(nameAudit).toBeDefined();
      expect(nameAudit?.sourceRow).toBe('R002');
      expect(nameAudit?.originalValue).toBe('  Cash   on  Hand ');
      expect(nameAudit?.cleanedValue).toBe('Cash on Hand');
      expect(nameAudit?.ruleId).toBe('RL-TEXT-01');
    });

    it('produces cumulative audits for entire Dirty Data Pack', () => {
      const result = cleanErp4Dataset(rowsAsRecord);
      expect(result.totalRows).toBe(143);
      expect(result.auditCount).toBeGreaterThan(0);
      expect(result.audits.length).toBe(result.auditCount);

      // Every audit entry has all required AC2 properties
      for (const audit of result.audits) {
        expect(audit.sourceRow).toBeDefined();
        expect(audit.fieldName).toBeDefined();
        expect(audit.originalValue).toBeDefined();
        expect(audit.cleanedValue).toBeDefined();
        expect(audit.ruleId).toBeDefined();
      }
    });
  });

  describe('3. Unrecoverable Required-Field Anomalies Rejection (AC3)', () => {
    it('rejects row when required account code is missing with ACCOUNT_CODE_REQUIRED', () => {
      // Row R015: missing account code
      const r015 = rowsAsRecord.find((r) => r.row_id === 'R015')!;
      expect(r015).toBeDefined();

      const result = cleanErp4Dataset([r015]);
      const row = result.rows[0]!;

      expect(row.outcome).toBe('rejected');
      expect(row.rejections.some((rej) => rej.reasonCode === 'ACCOUNT_CODE_REQUIRED')).toBe(true);
      expect(row.rejections[0]?.ruleId).toBe('RL-REQ-01');
    });

    it('rejects row when required account name is missing with ACCOUNT_NAME_REQUIRED', () => {
      // Row R018: missing account name
      const r018 = rowsAsRecord.find((r) => r.row_id === 'R018')!;
      expect(r018).toBeDefined();

      const result = cleanErp4Dataset([r018]);
      const row = result.rows[0]!;

      expect(row.outcome).toBe('rejected');
      expect(row.rejections.some((rej) => rej.reasonCode === 'ACCOUNT_NAME_REQUIRED')).toBe(true);
    });

    it('rejects row when opening balance amount is missing with BALANCE_AMOUNT_REQUIRED', () => {
      // Row R043: missing balance_amount
      const r043 = rowsAsRecord.find((r) => r.row_id === 'R043')!;
      expect(r043).toBeDefined();

      const result = cleanErp4Dataset([r043]);
      const row = result.rows[0]!;

      expect(row.outcome).toBe('rejected');
      expect(row.rejections.some((rej) => rej.reasonCode === 'BALANCE_AMOUNT_REQUIRED')).toBe(true);
    });

    it('rejects row when date is invalid calendar date (e.g. 2026-02-31) with INVALID_DATE', () => {
      // Row R048: 2026-02-31
      const r048 = rowsAsRecord.find((r) => r.row_id === 'R048')!;
      expect(r048).toBeDefined();

      const result = cleanErp4Dataset([r048]);
      const row = result.rows[0]!;

      expect(row.outcome).toBe('rejected');
      expect(row.rejections.some((rej) => rej.reasonCode === 'INVALID_DATE')).toBe(true);
    });

    it('rejects row when currency is invalid with INVALID_CURRENCY', () => {
      // Row R023: XYZ1
      const r023 = rowsAsRecord.find((r) => r.row_id === 'R023')!;
      expect(r023).toBeDefined();

      const result = cleanErp4Dataset([r023]);
      const row = result.rows[0]!;

      expect(row.outcome).toBe('rejected');
      expect(row.rejections.some((rej) => rej.reasonCode === 'INVALID_CURRENCY')).toBe(true);
    });
  });

  describe('4. Rule Toggles & Non-Destructive Invariant (FR-CL-05 & BR-KIT-03)', () => {
    it('guarantees source data is immutable and unchanged during cleaning', () => {
      const initialSha = sha256Hex(csvContent);
      const snapshot = JSON.stringify(rowsAsRecord[0]);

      cleanErp4Dataset(rowsAsRecord);

      expect(sha256Hex(csvContent)).toBe(initialSha);
      expect(JSON.stringify(rowsAsRecord[0])).toBe(snapshot);
    });

    it('disables whitespace trimming when RL-TEXT-01 is toggled off', () => {
      const r002 = rowsAsRecord.find((r) => r.row_id === 'R002')!;
      const toggledResult = cleanErp4Dataset([r002], ['RL-NAME-01']);

      // RL-TEXT-01 was not enabled, so leading/trailing spaces in code remain
      expect(toggledResult.rows[0]!.cleanedData.code).toBe('  1010-CASH ');
    });
  });

  describe('5. Formula-Safe CSV Export (AC6 & PLT-12)', () => {
    it('exports audit trail as formula-safe CSV neutralizing formula triggers', () => {
      const mockAudits = [
        {
          sourceRow: 'R001',
          fieldName: 'code',
          originalValue: '=SUM(1,2)',
          cleanedValue: '1000-ASSETS',
          ruleId: 'RL-TEXT-01',
          timestamp: '2026-10-23T20:00:00.000Z',
        },
        {
          sourceRow: 'R002',
          fieldName: 'name',
          originalValue: '+@DANGEROUS',
          cleanedValue: 'Safe Name',
          ruleId: 'RL-NAME-01',
          timestamp: '2026-10-23T20:00:00.000Z',
        },
      ];

      const csv = exportErp4FieldAuditCsv(mockAudits);

      expect(csv).toContain('Source Row,Field Name,Original Value,Cleaned Value,Rule ID,Timestamp');
      // Assert formula injection neutralization (prefixed with single quote)
      expect(csv).not.toContain('\n=SUM');
      expect(csv).not.toContain('\n+@DANGEROUS');
      expect(csv).toContain("'=SUM(1,2)");
      expect(csv).toContain("'+@DANGEROUS");
    });
  });

  describe('6. Fastify 5 Cleaning Endpoints & Security Guards (AC5)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify();
      app.decorateRequest('user', null);

      // Simple mock user decoration
      app.addHook('preHandler', async (req) => {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.replace('Bearer ', '');
          if (token === 'analyst-token') {
            (req as any).user = { id: 'usr-analyst', roles: ['analyst'] };
          } else if (token === 'runner-token') {
            (req as any).user = { id: 'usr-runner', roles: ['migration_runner'] };
          } else if (token === 'viewer-token') {
            (req as any).user = { id: 'usr-viewer', roles: ['viewer'] };
          }
        }
      });

      await app.register(cleaningRoutes);
      await app.ready();
    });

    it('rejects unauthenticated GET /migration/clean with HTTP 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/migration/clean',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 and DatasetCleanResult for authorized analyst', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/migration/clean',
        headers: { authorization: 'Bearer analyst-token' },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.totalRows).toBe(143);
      expect(json.data.auditCount).toBeGreaterThan(0);
    });

    it('downloads formula-safe CSV export via GET /migration/clean/audit/export', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/migration/clean/audit/export',
        headers: { authorization: 'Bearer analyst-token' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('erp4-field-clean-audit.csv');
      expect(res.payload).toContain('Source Row,Field Name,Original Value,Cleaned Value,Rule ID,Timestamp');
    });

    it('executes cleaning on custom payload via POST /migration/clean for migration_runner', async () => {
      const customCsv = [
        'row_id,record_type,case_tags,source_id,parent_source_id,code,name,type,currency_code,parent_code,description,is_active,is_posting_account,balance_amount,as_of_date,entry_number,period_label,posting_date,debit_amount,credit_amount,line_narration,department_ref,expect_outcome,expect_reasons',
        'R001,account,test,ACC-01,,  1010-CASH ,  Petty   Cash ,asset,INR,,,,true,true,,,,,,,,,,accepted,',
      ].join('\n');

      const res = await app.inject({
        method: 'POST',
        url: '/migration/clean',
        headers: {
          authorization: 'Bearer runner-token',
          'content-type': 'application/json',
        },
        payload: {
          csvContent: customCsv,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.totalRows).toBe(1);
      expect(json.data.rows[0].cleanedData.code).toBe('1010-CASH');
      expect(json.data.rows[0].cleanedData.name).toBe('Petty Cash');
    });

    it('rejects POST /migration/clean with missing body with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/migration/clean',
        headers: {
          authorization: 'Bearer runner-token',
          'content-type': 'application/json',
        },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
