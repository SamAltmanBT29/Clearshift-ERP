/**
 * ERP-4 Finance & Accounting — Profiling Configuration & Expected Result Assertions
 * (Issue #182 / ERP4-26 / KIT-03)
 *
 * Verifies:
 * 1. Profiler accurately computes total rows, null counts, distinct values, and invalid format rates.
 * 2. Exact duplicate candidate count matches manifest expectation without fuzzy matching.
 * 3. Profiling operation is strictly non-destructive; source data remains untouched.
 * 4. Automated assertions confirm profiler output matches pre-calculated manifest numbers.
 * 5. Formula-safe CSV export prevents spreadsheet formula injection.
 * 6. Fastify 5 REST API endpoints enforce RBAC and error envelopes.
 *
 * @module erp4/tests/migration/profiling.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  profileErp4Dataset,
  exportErp4ProfileCsv,
} from '../../src/migration/profiling-config.js';
import { readRawRows, sha256Hex } from '../../src/migration/rules.js';
import { buildApp } from '../../src/app.js';
import { signAccessToken, Roles } from '@cs/identity';

const REPO_ROOT = resolve(process.cwd());
const CSV_PATH = resolve(REPO_ROOT, 'sample-data/erp-4/dirty-data-v1.csv');
const CSV_TEXT = readFileSync(CSV_PATH, 'utf8');
const EXPECTED_MANIFEST_SHA256 = '506eabd2932433b43c4181f84be1298fd5a2a5a3292d601d477885491cf130d1';

describe('[ERP4-26] ERP-4 Profiling Configuration & Expected-Result Assertions (#182)', () => {
  const rawRows = readRawRows(CSV_TEXT);
  const rowsAsRecord = rawRows.map((r) => r as unknown as Record<string, string>);

  // ── 1. Column Metrics Assertions ───────────────────────────────────────────
  describe('1. Column Profiling Metrics Accuracy (AC1)', () => {
    const report = profileErp4Dataset(rowsAsRecord, CSV_TEXT);

    it('accurately computes total dataset rows matching Dirty Data Pack', () => {
      expect(report.totalRows).toBe(143);
      expect(report.columns).toBeDefined();
    });

    it('accurately profiles Account code: total=31, populated=30, null=1, distinct=29, invalid=2', () => {
      const col = report.columns['account.code'];
      expect(col).toBeDefined();
      expect(col.totalRows).toBe(31);
      expect(col.populatedCount).toBe(30);
      expect(col.nullCount).toBe(1); // Row R028 has empty code
      expect(col.distinctCount).toBe(29); // 1 duplicate candidate R031 ("1010-CASH")
      expect(col.invalidFormatCount).toBe(2); // 1 empty required + 1 too long (R027)
      expect(col.invalidFormatRate).toBe(6.45);
      expect(col.topValues).toHaveLength(5);
      expect(col.topValues[0].value).toBe('1010-CASH');
      expect(col.topValues[0].count).toBe(2);
    });

    it('accurately profiles Account name: total=31, populated=30, null=1, distinct=30, invalid=2', () => {
      const col = report.columns['account.name'];
      expect(col).toBeDefined();
      expect(col.totalRows).toBe(31);
      expect(col.nullCount).toBe(1); // R029 empty name
      expect(col.distinctCount).toBe(30);
      expect(col.invalidFormatCount).toBe(2); // 1 empty + 1 too long (R030)
    });

    it('accurately profiles Account type: null=1, distinct=6, invalid=4 (1 null, 3 bad enums)', () => {
      const col = report.columns['account.type'];
      expect(col).toBeDefined();
      expect(col.nullCount).toBe(1);
      expect(col.distinctCount).toBe(6);
      expect(col.invalidFormatCount).toBe(4);
    });

    it('accurately profiles Journal Entry entry_number: total=31, populated=30, null=1, distinct=29, invalid=2', () => {
      const col = report.columns['journal_entry.entry_number'];
      expect(col).toBeDefined();
      expect(col.totalRows).toBe(31);
      expect(col.populatedCount).toBe(30);
      expect(col.nullCount).toBe(1);
      expect(col.distinctCount).toBe(29); // 1 duplicate candidate R073 ("JV-2026-0001")
      expect(col.invalidFormatCount).toBe(2); // 1 empty (R067) + 1 too long (R070)
      expect(col.topValues[0].value).toBe('JV-2026-0001');
      expect(col.topValues[0].count).toBe(2);
    });

    it('accurately profiles Journal Entry posting_date: total=31, null=1, invalid=3', () => {
      const col = report.columns['journal_entry.posting_date'];
      expect(col).toBeDefined();
      expect(col.totalRows).toBe(31);
      expect(col.nullCount).toBe(1); // R088 empty date
      expect(col.invalidFormatCount).toBe(3); // 1 empty + 1 non-ISO slash format + 1 impossible date
    });

    it('accurately profiles Opening Balance amount: total=19, null=1, distinct=10, invalid=6', () => {
      const col = report.columns['opening_balance.balance_amount'];
      expect(col).toBeDefined();
      expect(col.totalRows).toBe(19);
      expect(col.nullCount).toBe(1); // R043 empty
      expect(col.distinctCount).toBe(10);
      expect(col.invalidFormatCount).toBe(6); // 1 empty + 1 negative + 1 non-numeric + 1 overflow + 1 excess decimals + 1 comma format
    });

    it('accurately profiles Journal Line debit/credit amounts: debit invalid=3, credit invalid=1', () => {
      const debitCol = report.columns['journal_line.debit_amount'];
      expect(debitCol.totalRows).toBe(62);
      expect(debitCol.nullCount).toBe(0);
      expect(debitCol.distinctCount).toBe(10);
      expect(debitCol.invalidFormatCount).toBe(3);

      const creditCol = report.columns['journal_line.credit_amount'];
      expect(creditCol.totalRows).toBe(62);
      expect(creditCol.nullCount).toBe(0);
      expect(creditCol.distinctCount).toBe(9);
      expect(creditCol.invalidFormatCount).toBe(1);
    });
  });

  // ── 2. Exact Duplicate Candidate Review Assertions ─────────────────────────
  describe('2. Exact Duplicate Candidates Assertion (AC2)', () => {
    const report = profileErp4Dataset(rowsAsRecord, CSV_TEXT);

    it('identifies exact duplicate Account code candidate matching manifest (R031 duplicate of R002)', () => {
      const accountDup = report.exactDuplicates['account_code'];
      expect(accountDup).toBeDefined();
      expect(accountDup.candidateCount).toBe(1);
      expect(accountDup.groups).toHaveLength(1);
      expect(accountDup.groups[0].key).toBe('1010-CASH');
      expect(accountDup.groups[0].occurrences).toBe(2);
      expect(accountDup.groups[0].rowIds).toContain('R002');
      expect(accountDup.groups[0].rowIds).toContain('R031');
    });

    it('identifies exact duplicate Opening Balance candidate matching manifest (R050 duplicate of R032)', () => {
      const opbDup = report.exactDuplicates['opening_balance_key'];
      expect(opbDup).toBeDefined();
      expect(opbDup.groups.some((g) => g.key === '1010-CASH:INR')).toBe(true);
      const group = opbDup.groups.find((g) => g.key === '1010-CASH:INR')!;
      expect(group.rowIds).toContain('R032');
      expect(group.rowIds).toContain('R050');
    });

    it('identifies exact duplicate Journal Entry number matching manifest (R073 duplicate of R051)', () => {
      const jeDup = report.exactDuplicates['journal_entry_number'];
      expect(jeDup).toBeDefined();
      expect(jeDup.candidateCount).toBe(1);
      expect(jeDup.groups).toHaveLength(1);
      expect(jeDup.groups[0].key).toBe('JV-2026-0001');
      expect(jeDup.groups[0].occurrences).toBe(2);
      expect(jeDup.groups[0].rowIds).toContain('R051');
      expect(jeDup.groups[0].rowIds).toContain('R073');
    });
  });

  // ── 3. Strictly Non-Destructive Invariant ──────────────────────────────────
  describe('3. Non-Destructive Operation Invariant (AC3 & BR-KIT-03)', () => {
    it('guarantees source CSV text and SHA-256 are unmodified before and after profiling', () => {
      const shaBefore = sha256Hex(CSV_TEXT);
      expect(shaBefore).toBe(EXPECTED_MANIFEST_SHA256);

      const report = profileErp4Dataset(rowsAsRecord, CSV_TEXT);
      expect(report.isNonDestructive).toBe(true);

      const textAfter = readFileSync(CSV_PATH, 'utf8');
      const shaAfter = sha256Hex(textAfter);

      expect(shaAfter).toBe(shaBefore);
      expect(textAfter).toBe(CSV_TEXT);
    });

    it('does not mutate parsed row objects in memory', () => {
      const snapshotBefore = JSON.stringify(rowsAsRecord);
      profileErp4Dataset(rowsAsRecord, CSV_TEXT);
      const snapshotAfter = JSON.stringify(rowsAsRecord);
      expect(snapshotAfter).toBe(snapshotBefore);
    });
  });

  // ── 4. Formula-Safe CSV Export ────────────────────────────────────────────
  describe('4. Formula-Safe CSV Export (AC5 & PLT-12)', () => {
    const report = profileErp4Dataset(rowsAsRecord, CSV_TEXT);
    const csvExport = exportErp4ProfileCsv(report);

    it('produces structured CSV with metadata, column metrics, and duplicate sections', () => {
      expect(csvExport).toContain('# ClearShift Data Health Profile Report');
      expect(csvExport).toContain(`Source SHA-256: ${EXPECTED_MANIFEST_SHA256}`);
      expect(csvExport).toContain('## Section 1: Column Quality Metrics');
      expect(csvExport).toContain('## Section 2: Exact Duplicate Candidate Groups');
      expect(csvExport).toContain('1010-CASH');
      expect(csvExport).toContain('JV-2026-0001');
    });

    it('sanitizes formula-injection characters in export cells', () => {
      const rowsWithInjection: Record<string, string>[] = [
        { row_id: '1', record_type: 'account', code: '=cmd|"/C calc"!A0', name: '+44123456', type: 'asset', currency_code: 'USD' },
      ];
      const injReport = profileErp4Dataset(rowsWithInjection);
      const injCsv = exportErp4ProfileCsv(injReport);

      expect(injCsv).toContain("=cmd");
      expect(injCsv).toContain("'+44123456");
    });
  });

  // ── 5. Fastify 5 REST API Endpoints & RBAC ────────────────────────────────
  describe('5. Fastify 5 Profiling Endpoints & Security Guards (AC6)', () => {
    let app: FastifyInstance;
    let viewerToken: string;

    beforeAll(async () => {
      app = buildApp({ authRequired: true });
      await app.ready();

      viewerToken = await signAccessToken('usr-viewer-01', [Roles.VIEWER]);
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects unauthenticated GET /api/v1/erp-finance/migration/profile with HTTP 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/migration/profile',
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('returns 200 and DatasetProfileReport for authorized viewer/analyst role', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/migration/profile',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.totalRows).toBe(143);
      expect(body.data.isNonDestructive).toBe(true);
      expect(body.data.sha256).toBe(EXPECTED_MANIFEST_SHA256);
      expect(body.data.columns['account.code']).toBeDefined();
      expect(body.data.exactDuplicates['account_code'].candidateCount).toBe(1);
    });

    it('downloads formula-safe CSV export via GET /api/v1/erp-finance/migration/profile/export', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/migration/profile/export',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment; filename="erp4-data-health-profile.csv"');
      expect(res.body).toContain('## Section 1: Column Quality Metrics');
      expect(res.body).toContain('1010-CASH');
    });

    it('executes strictly non-destructive profiling via POST /api/v1/erp-finance/migration/profile', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/migration/profile',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
        payload: {
          csvContent: 'row_id,record_type,code,name,type,currency_code\nR1,account,1010,Cash,asset,USD\nR2,account,1010,Duplicate Cash,asset,USD',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.totalRows).toBe(2);
      expect(body.data.exactDuplicates['account_code'].candidateCount).toBe(1);
    });

    it('rejects POST /api/v1/erp-finance/migration/profile with missing body with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/migration/profile',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('BAD_REQUEST');
    });
  });
});
