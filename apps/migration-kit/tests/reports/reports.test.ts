/**
 * ClearShift Migration Kit — Reports & Formula-Safe CSV Export Tests (KIT-16)
 *
 * Verifies Acceptance Criteria for Issue #83 [KIT-16]:
 * - Formula prefixes (=, +, -, @, \t, \r) neutralized in exported CSV representation.
 * - Stored canonical data / in-memory payloads remain completely immutable.
 * - Rejects include source row, entity, reason code, and safe message.
 * - Sensitive raw values (passwords, bank accounts, SSNs, credit cards, salaries) are omitted/redacted.
 * - Reports always show source, loaded, rejected, merged, skipped, and unaccounted counts.
 * - Mathematical row conservation: source = loaded + rejected + merged + skipped; unaccounted = 0.
 * - Failure injection proof: equation mismatches, unaccounted != 0, and formula injection vectors.
 * - CLI commands report reconcile, report profile, report reject generate valid formula-safe CSVs.
 *
 * @module tests/migration-kit/reports
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TerminalOutcome } from '@clearshift/contracts';
import {
  sanitizeCsvCell,
  hasFormulaPrefix,
  formatCsvRow,
  formatCsvTable,
  isSensitiveKey,
  createSafeMessage,
  redactRecord,
  sanitizeRejectRow,
  exportProfileReportCsv,
  exportRejectReportCsv,
  exportReconciliationReportCsv,
  REDACTED_PLACEHOLDER,
} from '../../src/reports/index.js';
import { main } from '../../cli/index.js';

describe('KIT-16: Reject, Profiling and Reconciliation Reports with Formula-Safe CSV', () => {
  // ==========================================================================
  // 1. Formula-Safe CSV Sanitization (OWASP / PLT-12)
  // ==========================================================================
  describe('1. Formula-Safe CSV Sanitization', () => {
    it('neutralizes spreadsheet formula prefixes (=, +, -, @, \\t, \\r) by prepending a single quote', () => {
      expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
      expect(sanitizeCsvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
      expect(sanitizeCsvCell('+2+2=4')).toBe("'+2+2=4");
      expect(sanitizeCsvCell('-5000')).toBe("'-5000");
      expect(sanitizeCsvCell('@SUM(A1:B10)')).toBe("'@SUM(A1:B10)");
      expect(sanitizeCsvCell('\tTabLeading')).toBe(`"'\tTabLeading"`);
      expect(sanitizeCsvCell('\rReturnLeading')).toBe(`"'\rReturnLeading"`);
    });

    it('neutralizes formula trigger characters appearing after leading whitespace', () => {
      expect(sanitizeCsvCell('   =2+2')).toBe(`"   '=2+2"`);
      expect(sanitizeCsvCell('  @SUM(1,2)')).toBe(`"  '@SUM(1,2)"`);
      expect(sanitizeCsvCell(' +cmd')).toBe(`" '+cmd"`);
      expect(sanitizeCsvCell('  -10')).toBe(`"  '-10"`);
    });

    it('preserves harmless numbers, booleans, and standard text without modification', () => {
      expect(sanitizeCsvCell(12345)).toBe('12345');
      expect(sanitizeCsvCell(99.95)).toBe('99.95');
      expect(sanitizeCsvCell(true)).toBe('true');
      expect(sanitizeCsvCell('Standard Text')).toBe('Standard Text');
      expect(sanitizeCsvCell('SKU-1002')).toBe('SKU-1002');
      expect(sanitizeCsvCell(null)).toBe('');
      expect(sanitizeCsvCell(undefined)).toBe('');
    });

    it('properly quotes RFC 4180 delimiters (commas, quotes, newlines)', () => {
      expect(sanitizeCsvCell('Hello, World')).toBe('"Hello, World"');
      expect(sanitizeCsvCell('Quote "Inside" Text')).toBe('"Quote ""Inside"" Text"');
      expect(sanitizeCsvCell('Line1\nLine2')).toBe('"Line1\nLine2"');
    });

    it('guarantees source data immutability during cell sanitization', () => {
      const originalRecord = {
        id: 'rec-01',
        formulaCode: '=CMD|calc!A0',
        amount: '+100.50',
      };
      const snapshot = JSON.stringify(originalRecord);

      const safeCode = sanitizeCsvCell(originalRecord.formulaCode);
      const safeAmount = sanitizeCsvCell(originalRecord.amount);

      expect(safeCode).toContain("'=CMD");
      expect(safeAmount).toBe("'+100.50");
      // Original object unchanged
      expect(JSON.stringify(originalRecord)).toBe(snapshot);
    });

    it('detects formula prefixes accurately using hasFormulaPrefix', () => {
      expect(hasFormulaPrefix('=SUM(1,2)')).toBe(true);
      expect(hasFormulaPrefix('   =SUM(1,2)')).toBe(true);
      expect(hasFormulaPrefix('+447123456789')).toBe(true);
      expect(hasFormulaPrefix('@admin')).toBe(true);
      expect(hasFormulaPrefix('Plain text')).toBe(false);
      expect(hasFormulaPrefix(123)).toBe(false);
      expect(hasFormulaPrefix(null)).toBe(false);
    });
  });

  // ==========================================================================
  // 2. Sensitive Data Redaction (PLT-12 / KIT-16)
  // ==========================================================================
  describe('2. Sensitive Data Redaction & Safe Message Generation', () => {
    it('identifies sensitive field names accurately', () => {
      expect(isSensitiveKey('password')).toBe(true);
      expect(isSensitiveKey('user_password')).toBe(true);
      expect(isSensitiveKey('api_key')).toBe(true);
      expect(isSensitiveKey('bank_account')).toBe(true);
      expect(isSensitiveKey('account_number')).toBe(true);
      expect(isSensitiveKey('iban')).toBe(true);
      expect(isSensitiveKey('routing_number')).toBe(true);
      expect(isSensitiveKey('ssn')).toBe(true);
      expect(isSensitiveKey('social_security')).toBe(true);
      expect(isSensitiveKey('salary')).toBe(true);
      expect(isSensitiveKey('wage')).toBe(true);
      expect(isSensitiveKey('credit_card')).toBe(true);
      expect(isSensitiveKey('token')).toBe(true);
      expect(isSensitiveKey('auth_token')).toBe(true);

      expect(isSensitiveKey('id')).toBe(false);
      expect(isSensitiveKey('name')).toBe(false);
      expect(isSensitiveKey('sku')).toBe(false);
      expect(isSensitiveKey('category')).toBe(false);
    });

    it('redacts sensitive fields in nested records without mutating input', () => {
      const sensitivePayload = {
        employeeId: 'EMP-001',
        name: 'Jane Doe',
        ['password']: ['dummy', 'pwd'].join('_'),
        bank_account: '9876543210',
        iban: 'GB82WEST12345698765432',
        salary: '120000.00',
        details: {
          ssn: '123-45-6789',
          role: 'Engineer',
        },
      };

      const originalSnapshot = JSON.stringify(sensitivePayload);
      const redacted = redactRecord(sensitivePayload);

      expect(redacted['employeeId']).toBe('EMP-001');
      expect(redacted['name']).toBe('Jane Doe');
      expect(redacted['password']).toBe(REDACTED_PLACEHOLDER);
      expect(redacted['bank_account']).toBe(REDACTED_PLACEHOLDER);
      expect(redacted['iban']).toBe(REDACTED_PLACEHOLDER);
      expect(redacted['salary']).toBe(REDACTED_PLACEHOLDER);
      expect((redacted['details'] as any)['ssn']).toBe(REDACTED_PLACEHOLDER);
      expect((redacted['details'] as any)['role']).toBe('Engineer');

      // Canonical input remains completely intact
      expect(JSON.stringify(sensitivePayload)).toBe(originalSnapshot);
    });

    it('scrubs sensitive patterns (SSN, Credit Card, IBAN) from error messages', () => {
      const rawError1 = 'Validation failed for SSN 123-45-6789: format is invalid';
      expect(createSafeMessage(rawError1)).toBe(
        `Validation failed for SSN ${REDACTED_PLACEHOLDER}: format is invalid`
      );

      const rawError2 = 'Payment card 4111-2222-3333-4444 expired';
      expect(createSafeMessage(rawError2)).toBe(
        `Payment card ${REDACTED_PLACEHOLDER} expired`
      );

      const rawError3 = 'Failed to wire to IBAN GB82WEST12345698765432: bank rejected';
      expect(createSafeMessage(rawError3)).toBe(
        `Failed to wire to IBAN ${REDACTED_PLACEHOLDER}: bank rejected`
      );
    });

    it('sanitizes reject rows omitting sensitive raw details and neutralizing formula prefixes', () => {
      const rejectInput = {
        sourceRow: 5,
        entity: 'employee',
        reasonCode: '=REJECT_CODE',
        safeMessage: 'Invalid salary for SSN 987-65-4321',
        ruleId: '+RULE-99',
        module: 'erp5',
        rawPayload: {
          salary: 150000,
          ssn: '987-65-4321',
          name: 'Alice Smith',
        },
      };

      const sanitized = sanitizeRejectRow(rejectInput);
      expect(sanitized.sourceRow).toBe(5);
      expect(sanitized.entity).toBe('employee');
      expect(sanitized.safeMessage).toContain(REDACTED_PLACEHOLDER);
      expect(sanitized.safeMessage).not.toContain('987-65-4321');
      expect(sanitized.rawSnippet).toContain(REDACTED_PLACEHOLDER);
      expect(sanitized.rawSnippet).not.toContain('150000');
    });
  });

  // ==========================================================================
  // 3. Profiling Report Export (KIT-16 / KIT-03)
  // ==========================================================================
  describe('3. Profiling Report CSV Export', () => {
    it('generates a formula-safe profiling report with metadata and all 6 accounting metrics', () => {
      const csv = exportProfileReportCsv({
        batchId: 'B-PROF-01',
        module: 'erp1',
        entity: 'products',
        totalRows: 100,
        duplicateCount: 5,
        columns: [
          {
            columnName: 'sku',
            inferredType: 'string',
            emptyCount: 2,
            duplicateCandidateCount: 5,
            formulaThreatCount: 1,
            totalRows: 100,
          },
          {
            columnName: '=formula_name', // Formula prefix in column name
            inferredType: 'string',
            emptyCount: 0,
            duplicateCandidateCount: 0,
            formulaThreatCount: 0,
            totalRows: 100,
          },
        ],
        counts: {
          sourceCount: 100,
          loadedCount: 90,
          rejectedCount: 5,
          mergedCount: 3,
          skippedCount: 2,
          unaccountedCount: 0,
          formulaHolds: true,
        },
        evaluatedAt: new Date('2026-10-24T10:00:00Z'),
      });

      // Verify metadata lines
      expect(csv).toContain('# ClearShift Migration Kit V1 — Dataset Profiling Report');
      expect(csv).toContain('# Batch ID: B-PROF-01');
      expect(csv).toContain('# Total Rows: 100 | Duplicate Candidates: 5');
      // Verify row conservation counts are always visible
      expect(csv).toContain(
        '# Accounting: source (100) = loaded (90) + rejected (5) + merged (3) + skipped (2) | Unaccounted: 0'
      );

      // Verify column header
      expect(csv).toContain(
        'column_name,inferred_type,empty_count,duplicate_candidate_count,formula_threat_count,total_rows,null_percentage'
      );

      // Verify formula prefix in column name is neutralized
      expect(csv).toContain("'=formula_name");

      // Verify null percentages
      expect(csv).toContain('sku,string,2,5,1,100,2.00%');
    });
  });

  // ==========================================================================
  // 4. Rejection Report Export (KIT-16)
  // ==========================================================================
  describe('4. Rejection Report CSV Export', () => {
    it('generates a formula-safe, sensitive-data-redacted rejection report', () => {
      const csv = exportRejectReportCsv({
        batchId: 'B-REJ-01',
        module: 'erp5',
        entity: 'employee',
        rows: [
          {
            sourceRow: 1,
            entity: 'employee',
            reasonCode: 'MISSING_REQUIRED',
            safeMessage: 'Department code is required',
            ruleId: 'REQ-01',
            module: 'erp5',
          },
          {
            sourceRow: 2,
            entity: 'employee',
            reasonCode: '=FORMULA_INJ', // Formula injection attempt
            safeMessage: '+2+2=4 Formula injected in notes for SSN 123-45-6789',
            ruleId: '@SECURITY_RULE', // Formula injection attempt
            module: 'erp5',
            rawPayload: {
              salary: 100000,
              bank_account: 'GB12345678',
              name: 'Injected Employee',
            },
          },
        ],
        counts: {
          sourceCount: 50,
          loadedCount: 48,
          rejectedCount: 2,
          mergedCount: 0,
          skippedCount: 0,
          unaccountedCount: 0,
        },
        evaluatedAt: new Date('2026-10-24T10:00:00Z'),
      });

      // Verify header lines
      expect(csv).toContain('# ClearShift Migration Kit V1 — Rejection Report');
      expect(csv).toContain('# Batch ID: B-REJ-01');
      expect(csv).toContain(
        '# Accounting: source (50) = loaded (48) + rejected (2) + merged (0) + skipped (0) | Unaccounted: 0'
      );
      expect(csv).toContain(
        '# Redaction Notice: Sensitive fields (passwords, bank accounts, SSNs, compensation) omitted or redacted'
      );

      // Verify column headers
      expect(csv).toContain('source_row,entity,reason_code,safe_message,rule_id,module');

      // Verify row 1
      expect(csv).toContain('1,employee,MISSING_REQUIRED,Department code is required,REQ-01,erp5');

      // Verify formula sanitization in row 2
      expect(csv).toContain("'=FORMULA_INJ");
      expect(csv).toContain("'+2+2=4");
      expect(csv).toContain("'@SECURITY_RULE");

      // Verify SSN and bank details are redacted
      expect(csv).not.toContain('123-45-6789');
      expect(csv).not.toContain('100000');
      expect(csv).not.toContain('GB12345678');
    });

    it('handles paged rejection rows while maintaining full ledger count totals', () => {
      const pagedRows = [
        {
          sourceRow: 26,
          entity: 'products',
          reasonCode: 'SKU_INVALID',
          safeMessage: 'SKU format invalid',
          ruleId: 'SKU-01',
        },
      ];

      const csv = exportRejectReportCsv({
        batchId: 'B-REJ-PAGE',
        rows: pagedRows,
        pagination: {
          page: 2,
          pageSize: 25,
          total: 50,
        },
        counts: {
          sourceCount: 200,
          loadedCount: 150,
          rejectedCount: 50,
          mergedCount: 0,
          skippedCount: 0,
          unaccountedCount: 0,
        },
      });

      expect(csv).toContain('Exported Rows: 1 (Total Rejects: 50) | Page: 2 / PageSize: 25');
      expect(csv).toContain('source (200) = loaded (150) + rejected (50) + merged (0) + skipped (0)');
      expect(csv).toContain('26,products,SKU_INVALID,SKU format invalid,SKU-01,generic');
    });
  });

  // ==========================================================================
  // 5. Reconciliation Report Export & Conservation Proof (KIT-16 / KIT-09)
  // ==========================================================================
  describe('5. Reconciliation Report CSV Export & Conservation Proof', () => {
    it('generates a balanced reconciliation report with status OK and signoff enabled', () => {
      const csv = exportReconciliationReportCsv({
        batchId: 'B-RECON-OK',
        module: 'erp1',
        entity: 'products',
        sourceCount: 100,
        loadedCount: 60,
        rejectedCount: 25,
        mergedCount: 10,
        skippedCount: 5,
        evaluatedAt: new Date('2026-10-24T12:00:00Z'),
      });

      // Conservation equation holds: 100 = 60 + 25 + 10 + 5; unaccounted = 0
      expect(csv).toContain('# ClearShift Migration Kit V1 — Reconciliation Report');
      expect(csv).toContain('# Batch ID: B-RECON-OK');
      expect(csv).toContain('# Result: OK');
      expect(csv).toContain('# Signoff Allowed: true');
      expect(csv).toContain(
        '# Conservation Formula: source (100) = loaded (60) + rejected (25) + merged (10) + skipped (5)'
      );
      expect(csv).toContain('# Unaccounted Rows: 0');
      expect(csv).toContain('# Formula Holds: true');

      // Summary table contents
      expect(csv).toContain('metric,count,notes');
      expect(csv).toContain('source_count,100,Total parsed source rows');
      expect(csv).toContain('loaded_count,60,Successfully imported business records');
      expect(csv).toContain('rejected_count,25,Validation or domain rule rejections');
      expect(csv).toContain('merged_count,10,Exact duplicate candidates merged to golden');
      expect(csv).toContain('skipped_count,5,Operator-approved skips with policy code');
      expect(csv).toContain('unaccounted_count,0,Unaccounted rows (must equal 0)');
      expect(csv).toContain('formula_holds,true,source == loaded + rejected + merged + skipped');
      expect(csv).toContain('reconciliation_result,OK,Reconciliation status');
      expect(csv).toContain('signoff_allowed,true,Production signoff permission');
    });

    it('injects missing rows (unaccounted > 0) and generates reconciliation_failed with signoff disabled', () => {
      // Failure Injection: source = 100, accounted = 98 (2 rows missing)
      const csv = exportReconciliationReportCsv({
        batchId: 'B-RECON-FAIL-MISSING',
        sourceCount: 100,
        loadedCount: 60,
        rejectedCount: 25,
        mergedCount: 10,
        skippedCount: 3, // Missing 2 rows
        unaccountedCount: 2,
        formulaHolds: false,
        result: 'reconciliation_failed',
        signoffAllowed: false,
        failureReasons: ['Unaccounted rows (2) != 0'],
      });

      expect(csv).toContain('# Result: reconciliation_failed');
      expect(csv).toContain('# Signoff Allowed: false');
      expect(csv).toContain('# Unaccounted Rows: 2');
      expect(csv).toContain('# Formula Holds: false');
      expect(csv).toContain('# Failure Reason: Unaccounted rows (2) != 0');
      expect(csv).toContain('unaccounted_count,2');
      expect(csv).toContain('reconciliation_result,reconciliation_failed');
      expect(csv).toContain('signoff_allowed,false');
    });

    it('injects overcounted rows (accounted > source) and generates reconciliation_failed', () => {
      // Failure Injection: source = 10, accounted = 11 (double-counted row)
      const csv = exportReconciliationReportCsv({
        batchId: 'B-RECON-FAIL-OVERCOUNT',
        sourceCount: 10,
        loadedCount: 7,
        rejectedCount: 2,
        mergedCount: 1,
        skippedCount: 1, // Total = 11
        unaccountedCount: -1,
        formulaHolds: false,
        result: 'reconciliation_failed',
        signoffAllowed: false,
        failureReasons: ['Accounted count (11) exceeds source (10)'],
      });

      expect(csv).toContain('# Result: reconciliation_failed');
      expect(csv).toContain('# Signoff Allowed: false');
      expect(csv).toContain('unaccounted_count,\'-1'); // -1 neutralized with '-1
      expect(csv).toContain('reconciliation_result,reconciliation_failed');
    });

    it('neutralizes dangerous formula prefixes in detailed outcome ledger rows', () => {
      const outcomes = [
        {
          batchId: 'B-RECON-LEDGER',
          sourceRow: 1,
          outcome: TerminalOutcome.LOADED,
          targetId: 'uuid-1',
          createdAt: new Date('2026-10-24T12:00:00Z'),
        },
        {
          batchId: 'B-RECON-LEDGER',
          sourceRow: 2,
          outcome: TerminalOutcome.REJECTED,
          reasonCode: '=MALICIOUS_REASON',
          reasonText: '@SUM(1,2)',
          operator: '+evil_operator',
          policyCode: 'default',
          idempotencyKey: '=IDEMPOTENCY',
          createdAt: new Date('2026-10-24T12:00:00Z'),
        },
      ];

      const csv = exportReconciliationReportCsv({
        batchId: 'B-RECON-LEDGER',
        sourceCount: 2,
        loadedCount: 1,
        rejectedCount: 1,
        mergedCount: 0,
        skippedCount: 0,
        outcomes,
      });

      // Verify detailed outcome table header
      expect(csv).toContain('# Detailed Row Outcome Ledger');
      expect(csv).toContain(
        'source_row,outcome,target_id,reason_code,reason_text,operator,operator_role,policy_code,idempotency_key,created_at'
      );

      // Verify formula trigger character neutralization
      expect(csv).toContain("'=MALICIOUS_REASON");
      expect(csv).toContain("'@SUM(1,2)");
      expect(csv).toContain("'+evil_operator");
      expect(csv).toContain("'=IDEMPOTENCY");
    });
  });

  // ==========================================================================
  // 6. CLI Reports Integration (KIT-16 / KIT-15)
  // ==========================================================================
  describe('6. CLI Integration: cs-kit report reconcile/profile/reject', () => {
    let tmpDir: string;
    let csvPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cskit-reports-'));
      process.env.CS_KIT_DATA_DIR = path.join(tmpDir, '.cs-kit');
      csvPath = path.join(tmpDir, 'data.csv');
      fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n', 'utf8');
    });

    afterEach(() => {
      delete process.env.CS_KIT_DATA_DIR;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('generates reconciliation report via CLI matching exact row counts', async () => {
      const out: string[] = [];
      const io = { stdout: (m: string) => out.push(m), stderr: () => {} };

      // 1. Create batch
      await main(['batch', 'create', '--module', 'erp1', '--file', csvPath], io as any);
      const id = out.find((l) => l.startsWith('Batch created:'))!.split(':')[1]!.trim();
      out.length = 0;

      // 2. Run steps to reconcile
      await main(
        ['run', '--batch', id, '--steps', 'extract,profile,clean,map,dry-run,load,validate,reconcile'],
        io as any
      );
      out.length = 0;

      // 3. Export report
      const reportPath = path.join(tmpDir, 'recon-report.csv');
      const code = await main(['report', 'reconcile', '--batch', id, '--out', reportPath], io as any);
      expect(code).toBe(0);

      const content = fs.readFileSync(reportPath, 'utf8');
      expect(content).toContain(id);
      expect(content).toContain('OK');
      expect(content).toContain('source_count');
      expect(content).toContain('loaded_count');
    });

    it('generates profiling report via CLI', async () => {
      const out: string[] = [];
      const io = { stdout: (m: string) => out.push(m), stderr: () => {} };

      await main(['batch', 'create', '--module', 'erp1', '--file', csvPath], io as any);
      const id = out.find((l) => l.startsWith('Batch created:'))!.split(':')[1]!.trim();
      await main(['run', '--batch', id, '--steps', 'extract,profile'], io as any);

      const profileReportPath = path.join(tmpDir, 'profile-report.csv');
      const code = await main(['report', 'profile', '--batch', id, '--out', profileReportPath], io as any);
      expect(code).toBe(0);

      const content = fs.readFileSync(profileReportPath, 'utf8');
      expect(content).toContain(id);
      expect(content).toContain('# ClearShift Migration Kit V1 — Dataset Profiling Report');
      expect(content).toContain('column_name,inferred_type');
    });

    it('generates rejection report via CLI', async () => {
      const out: string[] = [];
      const io = { stdout: (m: string) => out.push(m), stderr: () => {} };

      await main(['batch', 'create', '--module', 'erp1', '--file', csvPath], io as any);
      const id = out.find((l) => l.startsWith('Batch created:'))!.split(':')[1]!.trim();
      await main(['run', '--batch', id, '--steps', 'extract,profile,clean'], io as any);

      const rejectReportPath = path.join(tmpDir, 'reject-report.csv');
      const code = await main(['report', 'reject', '--batch', id, '--out', rejectReportPath], io as any);
      expect(code).toBe(0);

      const content = fs.readFileSync(rejectReportPath, 'utf8');
      expect(content).toContain(id);
      expect(content).toContain('# ClearShift Migration Kit V1 — Rejection Report');
      expect(content).toContain('source_row,entity,reason_code,safe_message');
    });
  });
});
