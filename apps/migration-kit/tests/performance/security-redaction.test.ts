/**
 * ClearShift Migration Kit — Security Scan, PII Redaction & 40%-Invalid Failure Safety (KIT-18)
 *
 * Validates SDS ClearShift Migration Kit v2.0 §§3-4, §11.1-11.9, Core Rules & Acceptance Criteria:
 * - 40%-invalid fixture changes zero target records and persists zero receipts.
 * - Circuit breaker halts at > 10% failure rate (STP-01).
 * - Safe logging & PII redaction: emails, passwords, bearer tokens, credit cards, SSNs, API keys.
 * - Full repository security scanner integration passes with zero violations.
 *
 * @module migration-kit/tests/performance/security-redaction.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  redactSensitiveLogMessage,
  redactSensitiveRowPayload,
  computeStableIdempotencyKey,
  type MigrationTargetAdapter,
} from '@clearshift/contracts';
import {
  BaseTargetAdapter,
  GenericTargetAdapterRegistry,
  TargetBatchLoader,
  InMemoryImportReceiptStore,
} from '../../src/load/target-adapter.js';
import { InMemoryKitRowOutcomeStore } from '../../src/reconcile/outcome-ledger.js';
import { InMemoryDryRunTokenManager } from '../../src/reconcile/dry-run-token.js';
import { parseCsv } from '../../cli/batch-engine.js';
import { scanDirectory } from '../../../../infra/security/scan-secrets.js';

const REPO_ROOT = resolve(__dirname, '../../../../');
const DIRTY_PACK_DIR = resolve(REPO_ROOT, 'sample-data/dirty-data-pack');

class MockSecurityTargetAdapter extends BaseTargetAdapter<Record<string, unknown>> {
  public readonly module = 'crm1';
  public readonly entity = 'contacts';
  public readonly schemaVersion = 1;

  protected async validateRow(row: Record<string, unknown>): Promise<{
    valid: boolean;
    reasonCode?: string;
    message?: string;
    field?: string;
  }> {
    // Required field check
    if (!row['first_name'] || String(row['first_name']).trim() === '') {
      return { valid: false, reasonCode: 'EMPTY_REQUIRED_FIELD', message: 'First name is required', field: 'first_name' };
    }
    // Status enum check
    const status = String(row['status'] ?? '');
    if (status === 'UNKNOWN_INVALID_STATUS_VALUE' || status.startsWith('INVALID')) {
      return { valid: false, reasonCode: 'INVALID_ENUM', message: 'Status enum is invalid' };
    }
    // Parent company check
    if (row['company'] === 'COMP-NONEXISTENT-UUID') {
      return { valid: false, reasonCode: 'PARENT_NOT_FOUND', message: 'Parent company not found' };
    }
    // Email format check
    const email = String(row['email'] ?? '');
    if (!email || !email.includes('@')) {
      return { valid: false, reasonCode: 'INVALID_EMAIL', message: 'Email missing @ sign' };
    }
    return { valid: true };
  }
}

describe('KIT-18: Security Scan, PII Redaction & Failure-Safety Verification', () => {
  let registry: GenericTargetAdapterRegistry;
  let receiptStore: InMemoryImportReceiptStore;
  let outcomeStore: InMemoryKitRowOutcomeStore;
  let dryRunTokenManager: InMemoryDryRunTokenManager;
  let adapter: MockSecurityTargetAdapter;
  let loader: TargetBatchLoader;

  beforeEach(() => {
    registry = new GenericTargetAdapterRegistry();
    receiptStore = new InMemoryImportReceiptStore();
    outcomeStore = new InMemoryKitRowOutcomeStore();
    dryRunTokenManager = new InMemoryDryRunTokenManager();
    adapter = new MockSecurityTargetAdapter(receiptStore);
    registry.register(adapter);
    loader = new TargetBatchLoader(registry, outcomeStore, dryRunTokenManager);
  });

  // ==========================================================================
  // 1. 40%-Invalid Fixture: Zero Target Mutations Invariant
  // ==========================================================================
  describe('40%-Invalid Fixture Zero Target Changes', () => {
    it('verifies 40%-invalid fixture changes zero target records and halts at 10% threshold', async () => {
      const b1Path = resolve(DIRTY_PACK_DIR, 'boundary-40-percent-invalid.csv');
      expect(existsSync(b1Path)).toBe(true);
      const { rows } = parseCsv(readFileSync(b1Path, 'utf8'));
      expect(rows.length).toBe(50); // 50 rows total

      const targetRows = rows.map((r, i) => ({ sourceRow: i + 1, data: r }));

      // Dry run preflight must not mutate target database or import receipts
      const drySummary = await loader.loadBatch('B-SEC-DRY', 'crm1', 'contacts', targetRows, {
        isDryRun: true,
      });

      expect(adapter.getTargetRecords().length).toBe(0);
      expect(await receiptStore.countByBatchId('B-SEC-DRY')).toBe(0);
      expect(drySummary.dryRunToken).toBeDefined();

      // Real load attempts to process with 10% circuit breaker
      const realSummary = await loader.loadBatch('B-SEC-REAL', 'crm1', 'contacts', targetRows, {
        chunkSize: 500,
        maxFailureRatePercent: 10.0,
        isDryRun: false,
      });

      // Circuit breaker halted
      expect(realSummary.halted).toBe(true);
      expect(realSummary.haltReason).toContain('exceeds 10% threshold (STP-01)');

      // Invariant: Zero target domain records created and zero import receipts
      expect(adapter.getTargetRecords().length).toBe(0);
      expect(await receiptStore.countByBatchId('B-SEC-REAL')).toBe(0);
      expect(realSummary.loadedCount).toBe(0);

      // Mathematical row conservation
      expect(realSummary.totalSourceRows).toBe(50);
      expect(realSummary.unaccountedCount).toBe(0);
    });
  });

  // ==========================================================================
  // 2. Safe Logging & Error-Log Redaction
  // ==========================================================================
  describe('Safe Logging & Error-Log Redaction', () => {
    it('redacts sensitive authentication tokens and passwords from log messages', () => {
      const rawLog = 'Worker failed authentication: password="SuperSecretPassword123!" for user';
      const redacted = redactSensitiveLogMessage(rawLog);
      expect(redacted).not.toContain('SuperSecretPassword123!');
      expect(redacted).toContain('password=[REDACTED]');
    });

    it('redacts Bearer authorization tokens from log messages', () => {
      const rawLog = 'Authorization header failed validation: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.dummy';
      const redacted = redactSensitiveLogMessage(rawLog);
      expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(redacted).toContain('Bearer [REDACTED]');
    });

    it('redacts credit card numbers from log strings', () => {
      const rawLog = 'Payment failed for customer card 4532-1234-5678-9012 during batch import';
      const redacted = redactSensitiveLogMessage(rawLog);
      expect(redacted).not.toContain('4532-1234-5678-9012');
      expect(redacted).toContain('****-****-****-****');
    });

    it('redacts Social Security Numbers from log strings', () => {
      const rawLog = 'Identity verification failed for SSN 123-45-6789 in row 44';
      const redacted = redactSensitiveLogMessage(rawLog);
      expect(redacted).not.toContain('123-45-6789');
      expect(redacted).toContain('***-**-****');
    });

    it('masks personal email addresses in log outputs while preserving domain', () => {
      const rawLog = 'Rejected contact row: alexander.hamilton@example.com is duplicate';
      const redacted = redactSensitiveLogMessage(rawLog);
      expect(redacted).not.toContain('alexander.hamilton@');
      expect(redacted).toContain('a***n@example.com');
    });

    it('redactSensitiveRowPayload masks sensitive fields in error payloads', () => {
      const dirtyPayload = {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        password: 'PlainTextPassword!',
        iban: 'GB29NWBK60161331926819',
        ssn: '987-65-4321',
        salary: '150000',
        notes: 'Confidential executive record',
      };

      const safePayload = redactSensitiveRowPayload(dirtyPayload);
      expect(safePayload.name).toBe('Jane Doe');
      expect(safePayload.password).toBe('[REDACTED]');
      expect(safePayload.iban).toBe('[REDACTED]');
      expect(safePayload.ssn).toBe('[REDACTED]');
      expect(safePayload.salary).toBe('[REDACTED]');
      expect(safePayload.email).toContain('j***e@example.com');
    });
  });

  // ==========================================================================
  // 3. Security Scanner Integration
  // ==========================================================================
  describe('Full Security Scanner Conformance', () => {
    it('executes secret scanner across repository code with zero violations', () => {
      const result = scanDirectory(REPO_ROOT);
      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(0);
    });
  });
});
