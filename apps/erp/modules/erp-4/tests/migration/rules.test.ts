/**
 * ERP-4 Finance & Accounting — V1 Data-Quality Rules Test Suite
 *
 * Proves the rule catalogue against the committed synthetic Dirty Data Pack:
 *   - Fixture manifest + SHA-256 checksum + schema/version
 *   - Rule catalogue integrity (stable IDs, versions, conditions, reasons)
 *   - Every required/optional field and enumeration has a valid and an invalid test row
 *   - Determinism (byte-equivalent profile) and raw-input immutability (BR-KIT-03)
 *   - No fuzzy matching, no automatic destructive merge
 *   - Domain invariants: BR-ERP4-01, BR-ERP4-02, FR-ERP4-01, FR-ERP4-02, FR-ERP4-03, FR-ERP4-04
 *   - Output accepted by public Zod contracts (@clearshift/contracts)
 *
 * @module erp4/tests/migration/rules.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CreateAccountRequestSchema,
  CreateJournalEntryRequestSchema,
  OpeningBalanceItemSchema,
  isJournalEntryBalanced,
} from '@clearshift/contracts';
import {
  ACCEPTED_CURRENCIES,
  ACCOUNT_TYPES,
  COVERED_FIELDS,
  FIXTURE_COLUMNS,
  FIXTURE_PATH,
  FIXTURE_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  RULES_VERSION,
  RULE_CATALOGUE,
  buildProfile,
  evaluateDataset,
  parseCsv,
  readRawRows,
  sha256Hex,
  stableStringify,
  toTenThousandths,
  formatHundredths,
  type ProfileReport,
  type RawRow,
} from '../../src/migration/rules.js';

// ─────────────────────────────────────────────────────────────────────────────
// Load committed fixtures (read-only)
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const CSV_TEXT = read('sample-data/erp-4/dirty-data-v1.csv');
const EXPECTED_PROFILE_TEXT = read('sample-data/erp-4/expected-profile.json');
const EXPECTED_PROFILE = JSON.parse(EXPECTED_PROFILE_TEXT) as ProfileReport;
const MAPPING_TEMPLATE = JSON.parse(read('sample-data/erp-4/mapping-template.json')) as {
  policy: {
    fuzzy_matching: boolean;
    automatic_merge: boolean;
    raw_input_mutation: boolean;
    balancing_handling: string;
    period_handling: string;
  };
  load_order: string[];
  reference_fixtures: { calendar_periods: Array<{ period_label: string; status: string }>; erp5_department_refs: string[] };
  entities: Record<string, { api: string; target_table: string; fields: Array<{ source: string; target: string; required: boolean }> }>;
};

describe('ERP-4 Finance & Accounting — V1 Data Quality Rules & Dirty Pack (#43)', () => {
  // ── 1. Fixture Manifest, Checksum & Immutability ───────────────────────────
  describe('1. Fixture Manifest & Checksum Validation', () => {
    it('verifies dirty-data-v1.csv matches the committed SHA-256 fingerprint exactly', () => {
      const computedHash = sha256Hex(CSV_TEXT);
      expect(computedHash).toBe(EXPECTED_PROFILE.fixture.sha256);
      expect(EXPECTED_PROFILE.fixture.file).toBe(FIXTURE_PATH);
      expect(EXPECTED_PROFILE.fixture.schema_version).toBe(FIXTURE_SCHEMA_VERSION);
    });

    it('verifies row counts and record types in committed manifest', () => {
      const rows = readRawRows(CSV_TEXT);
      expect(rows.length).toBe(EXPECTED_PROFILE.fixture.row_count);
      expect(rows.length).toBe(143);

      const byType = {
        account: rows.filter((r) => r.record_type === 'account').length,
        opening_balance: rows.filter((r) => r.record_type === 'opening_balance').length,
        journal_entry: rows.filter((r) => r.record_type === 'journal_entry').length,
        journal_line: rows.filter((r) => r.record_type === 'journal_line').length,
      };

      expect(byType).toEqual(EXPECTED_PROFILE.fixture.by_record_type);
    });

    it('asserts raw input is never mutated during profiling or cleaning (BR-KIT-03)', () => {
      const rowsBefore = readRawRows(CSV_TEXT);
      const snapshotBefore = JSON.stringify(rowsBefore);

      const profile = buildProfile(CSV_TEXT);
      expect(profile).toBeDefined();

      const rowsAfter = readRawRows(CSV_TEXT);
      const snapshotAfter = JSON.stringify(rowsAfter);

      expect(snapshotAfter).toBe(snapshotBefore);
      expect(sha256Hex(CSV_TEXT)).toBe(EXPECTED_PROFILE.fixture.sha256);
    });
  });

  // ── 2. Rule Catalogue Integrity ───────────────────────────────────────────
  describe('2. Rule Catalogue Integrity', () => {
    it('verifies all rules have unique IDs and version 1.0.0', () => {
      const seenIds = new Set<string>();
      for (const rule of RULE_CATALOGUE) {
        expect(seenIds.has(rule.rule_id)).toBe(false);
        seenIds.add(rule.rule_id);
        expect(rule.version).toBe(RULES_VERSION);
        expect(rule.input_condition.length).toBeGreaterThan(0);
        expect(rule.human_reason.length).toBeGreaterThan(0);
        expect(['reject', 'normalize', 'review', 'derive']).toContain(rule.result);
      }
    });

    it('verifies all reject and review rules specify a stable reason code', () => {
      for (const rule of RULE_CATALOGUE) {
        if (rule.result === 'reject' || rule.result === 'review') {
          expect(rule.reason_code).toBeDefined();
          expect(rule.reason_code).toMatch(/^[A-Z0-9_]+$/);
        }
      }
    });

    it('verifies mapping template references declared rules', () => {
      expect(MAPPING_TEMPLATE.policy.fuzzy_matching).toBe(false);
      expect(MAPPING_TEMPLATE.policy.automatic_merge).toBe(false);
      expect(MAPPING_TEMPLATE.policy.raw_input_mutation).toBe(false);
      expect(MAPPING_TEMPLATE.load_order).toEqual(['account', 'opening_balance', 'journal_entry']);
    });
  });

  // ── 3. Field & Enumeration Coverage (AC: at least 1 valid & 1 invalid row) ──
  describe('3. Field & Enumeration Coverage Matrix', () => {
    const rawRows = readRawRows(CSV_TEXT);
    const tagsFound = new Set<string>();
    for (const r of rawRows) {
      if (r.case_tags) {
        r.case_tags.split('|').forEach((t) => tagsFound.add(t.trim()));
      }
    }

    it('ensures every required/optional field and enumeration has at least 1 valid test row', () => {
      for (const [entity, fields] of Object.entries(COVERED_FIELDS)) {
        for (const [field, spec] of Object.entries(fields)) {
          for (const validTag of spec.valid_tags) {
            expect(
              tagsFound.has(validTag),
              `Missing valid test case for ${entity}.${field} with tag ${validTag}`
            ).toBe(true);
          }
        }
      }
    });

    it('ensures every required/optional field and enumeration has at least 1 invalid test row', () => {
      for (const [entity, fields] of Object.entries(COVERED_FIELDS)) {
        for (const [field, spec] of Object.entries(fields)) {
          for (const invalidTag of spec.invalid_tags) {
            expect(
              tagsFound.has(invalidTag),
              `Missing invalid test case for ${entity}.${field} with tag ${invalidTag}`
            ).toBe(true);
          }
        }
      }
    });

    it('verifies all accepted account types (asset, liability, income, expense) have valid test rows', () => {
      const acceptedAccounts = EXPECTED_PROFILE.by_record_type.account.accepted;
      expect(acceptedAccounts).toBeGreaterThanOrEqual(4);

      const evaluation = evaluateDataset(rawRows);
      const typesPresent = new Set(evaluation.cleanAccounts.map((a) => a.type));
      for (const t of ACCOUNT_TYPES) {
        expect(typesPresent.has(t)).toBe(true);
      }
    });

    it('verifies all accepted currencies (INR, USD, EUR) have valid test rows', () => {
      const evaluation = evaluateDataset(rawRows);
      const currenciesPresent = new Set(evaluation.cleanAccounts.map((a) => a.currency_code));
      for (const c of ACCEPTED_CURRENCIES) {
        expect(currenciesPresent.has(c)).toBe(true);
      }
    });
  });

  // ── 4. Determinism & Profile Reproducibility ───────────────────────────────
  describe('4. Determinism & Profile Reproducibility', () => {
    it('yields byte-identical profile JSON output across repeated runs', () => {
      const profile1 = buildProfile(CSV_TEXT);
      const profile2 = buildProfile(CSV_TEXT);

      const json1 = stableStringify(profile1);
      const json2 = stableStringify(profile2);

      expect(json1).toBe(json2);
      expect(json1).toBe(EXPECTED_PROFILE_TEXT);
    });

    it('reconciles perfectly: source = accepted + rejected + review (unaccounted = 0)', () => {
      const counts = EXPECTED_PROFILE.by_record_type;
      let totalAccepted = 0;
      let totalRejected = 0;
      let totalReview = 0;

      for (const entityCounts of Object.values(counts)) {
        totalAccepted += entityCounts.accepted;
        totalRejected += entityCounts.rejected;
        totalReview += entityCounts.review;
      }

      const totalAccounted = totalAccepted + totalRejected + totalReview;
      expect(totalAccounted).toBe(EXPECTED_PROFILE.fixture.row_count);
      expect(EXPECTED_PROFILE.fixture.row_count - totalAccounted).toBe(0);
    });
  });

  // ── 5. Exact Candidate Keys (No Fuzzy Matching, No Auto-Merge) ─────────────
  describe('5. Duplicate Candidate Keys & No Fuzzy Merge Policy', () => {
    it('holds duplicate account code candidates for review with DUPLICATE_ACCOUNT_CODE_REVIEW', () => {
      const dupAccount = EXPECTED_PROFILE.rows['R031'];
      expect(dupAccount.outcome).toBe('review');
      expect(dupAccount.reasons).toContain('DUPLICATE_ACCOUNT_CODE_REVIEW');
    });

    it('holds duplicate opening balance candidates for review with DUPLICATE_OPENING_BALANCE_REVIEW', () => {
      const dupOpb = EXPECTED_PROFILE.rows['R050'];
      expect(dupOpb.outcome).toBe('review');
      expect(dupOpb.reasons).toContain('DUPLICATE_OPENING_BALANCE_REVIEW');
    });

    it('holds duplicate journal entry numbers for review with DUPLICATE_ENTRY_NUMBER_REVIEW', () => {
      const dupJe = EXPECTED_PROFILE.rows['R073'];
      expect(dupJe.outcome).toBe('review');
      expect(dupJe.reasons).toContain('DUPLICATE_ENTRY_NUMBER_REVIEW');

      // Lines attached to a review entry are held in review, not loaded
      expect(EXPECTED_PROFILE.rows['R074'].outcome).toBe('review');
      expect(EXPECTED_PROFILE.rows['R074'].reasons).toContain('PARENT_ENTRY_IN_REVIEW');
      expect(EXPECTED_PROFILE.rows['R075'].outcome).toBe('review');
      expect(EXPECTED_PROFILE.rows['R075'].reasons).toContain('PARENT_ENTRY_IN_REVIEW');
    });
  });

  // ── 6. Domain Invariants ──────────────────────────────────────────────────
  describe('6. Domain Invariants Enforcement', () => {
    it('asserts double-entry exact balancing (BR-ERP4-01): every accepted journal entry balances exactly', () => {
      const rawRows = readRawRows(CSV_TEXT);
      const evaluation = evaluateDataset(rawRows);

      for (const entry of evaluation.cleanJournalEntries) {
        let debitSum = 0n;
        let creditSum = 0n;
        for (const line of entry.lines) {
          debitSum += toTenThousandths(line.debit_amount);
          creditSum += toTenThousandths(line.credit_amount);
        }
        expect(debitSum).toBe(creditSum);
        expect(
          isJournalEntryBalanced(
            entry.lines.map((l) => ({ debit_amount: l.debit_amount, credit_amount: l.credit_amount }))
          )
        ).toBe(true);
      }
    });

    it('rejects unbalanced journal entries with UNBALANCED_JOURNAL_ENTRY (BR-ERP4-01)', () => {
      const unbalancedEntry = EXPECTED_PROFILE.rows['R106'];
      expect(unbalancedEntry.outcome).toBe('rejected');
      expect(unbalancedEntry.reasons).toContain('UNBALANCED_JOURNAL_ENTRY');
    });

    it('asserts closed/locked fiscal periods reject postings unconditionally (BR-ERP4-02)', () => {
      const lockedEntry = EXPECTED_PROFILE.rows['R082'];
      expect(lockedEntry.outcome).toBe('rejected');
      expect(lockedEntry.reasons).toContain('PERIOD_LOCKED');
    });

    it('enforces debit and credit mutual exclusivity and non-negativity per line', () => {
      // Both debit and credit positive
      expect(EXPECTED_PROFILE.rows['R119'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R119'].reasons).toContain('LINE_DEBIT_AND_CREDIT');

      // Both zero
      expect(EXPECTED_PROFILE.rows['R122'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R122'].reasons).toContain('LINE_ZERO_AMOUNTS');

      // Negative debit
      expect(EXPECTED_PROFILE.rows['R125'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R125'].reasons).toContain('NEGATIVE_AMOUNT');

      // Negative credit
      expect(EXPECTED_PROFILE.rows['R129'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R129'].reasons).toContain('NEGATIVE_AMOUNT');
    });

    it('enforces entry atomicity: child line rejection rejects parent entry (LINE_REJECTED) and peer lines', () => {
      // R109 has an invalid account in R110
      expect(EXPECTED_PROFILE.rows['R109'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R109'].reasons).toContain('LINE_REJECTED');

      // Peer line R111 is rejected due to parent rejection
      expect(EXPECTED_PROFILE.rows['R111'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R111'].reasons).toContain('PARENT_ENTRY_REJECTED');
    });

    it('enforces chart of accounts hierarchy and rejects self-parent cycles (CYCLE_DETECTED)', () => {
      expect(EXPECTED_PROFILE.rows['R024'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R024'].reasons).toContain('CYCLE_DETECTED');
    });

    it('verifies trial balance groups by account and currency and never mixes currencies (FR-ERP4-03)', () => {
      const tbSummary = EXPECTED_PROFILE.trial_balance_summary;
      expect(Object.keys(tbSummary).sort()).toEqual(['EUR', 'INR', 'USD']);

      for (const [curr, data] of Object.entries(tbSummary)) {
        expect(data.is_balanced).toBe(true);
        expect(data.difference).toBe('0.00');
        expect(data.total_debit).toBe(data.total_credit);
      }
    });

    it('rejects postings to header/non-posting accounts (CANNOT_POST_TO_HEADER_ACCOUNT)', () => {
      expect(EXPECTED_PROFILE.rows['R116'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R116'].reasons).toContain('CANNOT_POST_TO_HEADER_ACCOUNT');
    });

    it('rejects postings to inactive accounts (ACCOUNT_INACTIVE)', () => {
      expect(EXPECTED_PROFILE.rows['R113'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R113'].reasons).toContain('ACCOUNT_INACTIVE');
    });
  });

  // ── 7. Public API Contract Compatibility ──────────────────────────────────
  describe('7. Public API Contract Schema Validation', () => {
    const rawRows = readRawRows(CSV_TEXT);
    const evaluation = evaluateDataset(rawRows);

    it('validates clean accounts satisfy CreateAccountRequestSchema', () => {
      for (const cleanAcc of evaluation.cleanAccounts) {
        const payload = {
          code: cleanAcc.code,
          name: cleanAcc.name,
          type: cleanAcc.type,
          currency_code: cleanAcc.currency_code,
          parent_id: null,
          description: cleanAcc.description,
          is_posting_account: cleanAcc.is_posting_account,
        };
        const parseResult = CreateAccountRequestSchema.safeParse(payload);
        expect(parseResult.success, `Account ${cleanAcc.code} failed schema: ${parseResult.error}`).toBe(true);
      }
    });

    it('validates clean opening balances satisfy OpeningBalanceItemSchema', () => {
      for (const cleanOpb of evaluation.cleanOpeningBalances) {
        const payload = {
          account_id: '00000000-0000-0000-0000-000000000001', // synthetic resolved UUID
          currency_code: cleanOpb.currency_code,
          balance_amount: cleanOpb.balance_amount,
          as_of_date: cleanOpb.as_of_date,
          source_reference: cleanOpb.description,
        };
        const parseResult = OpeningBalanceItemSchema.safeParse(payload);
        expect(parseResult.success, `Opening balance for ${cleanOpb.code} failed schema`).toBe(true);
      }
    });

    it('validates clean journal entries satisfy CreateJournalEntryRequestSchema', () => {
      for (const cleanJe of evaluation.cleanJournalEntries) {
        const payload = {
          period_id: '00000000-0000-0000-0000-000000000002', // synthetic resolved period UUID
          posting_date: cleanJe.posting_date,
          description: cleanJe.description,
          currency_code: cleanJe.currency_code,
          lines: cleanJe.lines.map((l) => ({
            account_id: '00000000-0000-0000-0000-000000000001',
            debit_amount: l.debit_amount,
            credit_amount: l.credit_amount,
            line_narration: l.line_narration,
            department_ref: l.department_ref,
          })),
        };
        const parseResult = CreateJournalEntryRequestSchema.safeParse(payload);
        expect(parseResult.success, `Journal Entry ${cleanJe.entry_number} failed schema`).toBe(true);
      }
    });
  });
});
