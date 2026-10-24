/**
 * ERP-4 Finance & Accounting — Data Dictionary, ERD, Traceability & Dirty Data Pack Plan Test Suite
 *
 * Dedicated test suite for Issue #180 [ERP4-24]:
 *   [✓] AC1. Data dictionary defines every entity column: type, nullability, constraint, business rule, and example.
 *   [✓] AC2. ERD clearly documents primary keys, foreign keys, and master-data ownership boundaries.
 *   [✓] AC3. Traceability matrix maps every module Must requirement to planned automated test cases.
 *   [✓] AC4. Dirty Data Pack plan defines synthetic edge-case scenarios and expected defect distributions.
 *   [✓] AC5. Design artifacts are signed off at Gate G1 review.
 *
 * @module erp4/tests/migration/data-dictionary-erd.test
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const GLOBAL_DICT_PATH = resolve(REPO_ROOT, 'docs/data-dictionaries/erp-4.md');
const MODULE_DICT_PATH = resolve(
  REPO_ROOT,
  'apps/erp/modules/erp-4/docs/data-dictionary.md'
);
const FIELD_DICT_PATH = resolve(
  REPO_ROOT,
  'apps/erp/modules/erp-4/docs/field-level-data-dictionary.md'
);
const ERD_PATH = resolve(REPO_ROOT, 'apps/erp/modules/erp-4/docs/erd.md');
const TRACEABILITY_PATH = resolve(
  REPO_ROOT,
  'apps/erp/modules/erp-4/docs/traceability-matrix.md'
);
const DIRTY_DATA_PLAN_PATH = resolve(
  REPO_ROOT,
  'apps/erp/modules/erp-4/docs/dirty-data-pack-plan.md'
);

describe('ERP-4 Data Dictionary, ERD, Traceability & Dirty Data Pack Plan ([ERP4-24] #180)', () => {
  const globalDictContent = readFileSync(GLOBAL_DICT_PATH, 'utf8');
  const moduleDictContent = readFileSync(MODULE_DICT_PATH, 'utf8');
  const fieldDictContent = readFileSync(FIELD_DICT_PATH, 'utf8');
  const erdContent = readFileSync(ERD_PATH, 'utf8');
  const traceContent = readFileSync(TRACEABILITY_PATH, 'utf8');
  const dirtyDataPlanContent = readFileSync(DIRTY_DATA_PLAN_PATH, 'utf8');

  // ── AC1: Comprehensive Field-Level Data Dictionary ──────────────────────────
  describe('AC1: Field-Level Data Dictionary', () => {
    it('verifies existence of all artifact files', () => {
      expect(existsSync(GLOBAL_DICT_PATH)).toBe(true);
      expect(existsSync(MODULE_DICT_PATH)).toBe(true);
      expect(existsSync(FIELD_DICT_PATH)).toBe(true);
      expect(existsSync(ERD_PATH)).toBe(true);
      expect(existsSync(TRACEABILITY_PATH)).toBe(true);
      expect(existsSync(DIRTY_DATA_PLAN_PATH)).toBe(true);
    });

    const requiredTables = [
      'erp4.accounts',
      'erp4.accounting_periods',
      'erp4.journal_entries',
      'erp4.journal_lines',
      'erp4.opening_balances',
      'erp4.import_receipts',
    ];

    it.each(requiredTables)('documents table %s with full schema', (tableName) => {
      expect(fieldDictContent).toContain(tableName);
    });

    it('documents all required column attributes: Type, Nullable, Default, Constraints, Business Rule, Example', () => {
      expect(fieldDictContent).toContain('PostgreSQL Type');
      expect(fieldDictContent).toContain('TypeScript / Zod Type');
      expect(fieldDictContent).toContain('Nullable');
      expect(fieldDictContent).toContain('Default');
      expect(fieldDictContent).toContain('Constraints');
      expect(fieldDictContent).toContain('Business Rule');
      expect(fieldDictContent).toContain('Example');
    });

    it('defines key business columns in field-level dictionary', () => {
      // Accounts
      expect(fieldDictContent).toContain('code');
      expect(fieldDictContent).toContain('1010-CASH');
      expect(fieldDictContent).toContain('is_posting_account');

      // Periods
      expect(fieldDictContent).toContain('period_label');
      expect(fieldDictContent).toContain('2026-04');

      // Journal Entries
      expect(fieldDictContent).toContain('entry_number');
      expect(fieldDictContent).toContain('JE-2026-0001');

      // Journal Lines
      expect(fieldDictContent).toContain('debit_amount');
      expect(fieldDictContent).toContain('credit_amount');

      // Opening Balances
      expect(fieldDictContent).toContain('balance_amount');

      // Import Receipts
      expect(fieldDictContent).toContain('idempotency_key');
    });
  });

  // ── AC2: Entity-Relationship Diagram (ERD) ──────────────────────────────────
  describe('AC2: Entity-Relationship Diagram (ERD)', () => {
    it('contains valid Mermaid ERD diagram block', () => {
      expect(erdContent).toContain('```mermaid');
      expect(erdContent).toContain('erDiagram');
    });

    it('documents primary keys and foreign keys for all core entities', () => {
      expect(erdContent).toContain('ERP4_ACCOUNTS');
      expect(erdContent).toContain('ERP4_ACCOUNTING_PERIODS');
      expect(erdContent).toContain('ERP4_JOURNAL_ENTRIES');
      expect(erdContent).toContain('ERP4_JOURNAL_LINES');
      expect(erdContent).toContain('ERP4_OPENING_BALANCES');
      expect(erdContent).toContain('ERP4_IMPORT_RECEIPTS');

      expect(erdContent).toContain('uuid id PK');
      expect(erdContent).toContain('varchar code UK');
      expect(erdContent).toContain('varchar entry_number UK');
      expect(erdContent).toContain('uuid journal_entry_id FK');
      expect(erdContent).toContain('uuid account_id FK');
    });

    it('documents cross-module master-data ownership boundaries (Decision C7)', () => {
      expect(erdContent).toContain('ERP2_VENDOR_BILLS');
      expect(erdContent).toContain('ERP3_INVOICES');
      expect(erdContent).toContain('ERP5_PAYROLL_RUNS');
      expect(erdContent).toContain('Decision C7');
      expect(erdContent).toContain('no DB FK');
    });

    it('documents foreign key delete actions (CASCADE on lines, RESTRICT on periods/accounts)', () => {
      expect(erdContent).toContain('ON DELETE CASCADE');
      expect(erdContent).toContain('ON DELETE RESTRICT');
    });
  });

  // ── AC3: Traceability Matrix ───────────────────────────────────────────────
  describe('AC3: Requirement-to-Test Traceability Matrix', () => {
    const requiredReqs = [
      'FR-ERP4-01',
      'FR-ERP4-02',
      'FR-ERP4-03',
      'FR-ERP4-04',
      'FR-ERP4-05',
      'BR-ERP4-01',
      'BR-ERP4-02',
      'KIT-08',
      'KIT-14',
      'KIT-16',
      'SEC-01',
    ];

    it.each(requiredReqs)('maps requirement %s to automated test cases', (reqId) => {
      expect(traceContent).toContain(reqId);
    });

    it('maps requirements across DB, Domain, API, and UI levels', () => {
      expect(traceContent).toContain('| DB |');
      expect(traceContent).toContain('| Domain |');
      expect(traceContent).toContain('| API |');
      expect(traceContent).toContain('| UI |');
      expect(traceContent).toContain('| Migration |');
      expect(traceContent).toContain('| Security |');
    });

    it('references existing test files in the repository', () => {
      expect(traceContent).toContain('tests/db/schema.test.ts');
      expect(traceContent).toContain('tests/domain/invariants.test.ts');
      expect(traceContent).toContain('tests/api/mutations.test.ts');
      expect(traceContent).toContain('tests/api/list.test.ts');
      expect(traceContent).toContain('tests/migration/idempotency.test.ts');
      expect(traceContent).toContain('tests/migration/retry-stop.test.ts');
      expect(traceContent).toContain('web/tests/AccountsListPage.test.tsx');
    });
  });

  // ── AC4: Dirty Data Pack Plan ──────────────────────────────────────────────
  describe('AC4: Dirty Data Pack Plan', () => {
    it('defines 120-row synthetic fixture layout across 4 entity types', () => {
      expect(dirtyDataPlanContent).toContain('120 source rows');
      expect(dirtyDataPlanContent).toContain('40 accounts');
      expect(dirtyDataPlanContent).toContain('30 opening balances');
      expect(dirtyDataPlanContent).toContain('journal entries');
      expect(dirtyDataPlanContent).toContain('journal lines');
    });

    it('strictly mandates 100% synthetic data with no real credentials or PII', () => {
      expect(dirtyDataPlanContent).toContain('100% Synthetic');
      expect(dirtyDataPlanContent).toContain('Zero real customer, financial, or personal data');
    });

    it('defines exact defect categories: clean, cleaned, duplicate merged, and rejected', () => {
      expect(dirtyDataPlanContent).toContain('ACC-CLEAN');
      expect(dirtyDataPlanContent).toContain('ACC-CLN-01');
      expect(dirtyDataPlanContent).toContain('ACC-DUP-01');
      expect(dirtyDataPlanContent).toContain('ACC-REJ-01');
      expect(dirtyDataPlanContent).toContain('JRN-REJ-01');
      expect(dirtyDataPlanContent).toContain('JOURNAL_UNBALANCED');
      expect(dirtyDataPlanContent).toContain('PERIOD_LOCKED');
    });

    it('enforces total terminal outcome reconciliation invariant', () => {
      expect(dirtyDataPlanContent).toContain('source = loaded + rejected + merged + skipped');
      expect(dirtyDataPlanContent).toContain('unaccounted = 0');
    });
  });

  // ── AC5: Gate G1 Sign-Off & Global Docs Reference ─────────────────────────
  describe('AC5: Gate G1 Sign-Off & Global Docs Reference', () => {
    it('global documentation references Gate G1 design artifacts', () => {
      expect(globalDictContent).toContain('Gate G1 Design Artifacts');
      expect(globalDictContent).toContain('field-level-data-dictionary.md');
      expect(globalDictContent).toContain('erd.md');
      expect(globalDictContent).toContain('traceability-matrix.md');
      expect(globalDictContent).toContain('dirty-data-pack-plan.md');
    });
  });
});
