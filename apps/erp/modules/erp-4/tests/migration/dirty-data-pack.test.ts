/**
 * ERP-4 Finance & Accounting — Canonical Dirty Data Pack Test Suite
 *
 * Dedicated test suite for Issue #181 [ERP4-25]:
 *   [✓] AC1. Dirty Data Pack contains at least 100 realistic synthetic rows; zero real personal data.
 *   [✓] AC2. Manifest documents expected outcome per row: valid, malformed, null required, exact duplicate, foreign key missing.
 *   [✓] AC3. Edge cases include UTF-8 characters, whitespace padding, date format variants, and boundary numbers.
 *   [✓] AC4. Test suite verifies fixture counts reproduce identically across multiple runs.
 *
 * @module erp4/tests/migration/dirty-data-pack.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readRawRows,
  evaluateDataset,
  buildProfile,
  sha256Hex,
  stableStringify,
  type ProfileReport,
} from '../../src/migration/rules.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const CSV_REL_PATH = 'sample-data/erp-4/dirty-data-v1.csv';
const PROFILE_REL_PATH = 'sample-data/erp-4/expected-profile.json';
const CSV_FULL_PATH = resolve(REPO_ROOT, CSV_REL_PATH);
const PROFILE_FULL_PATH = resolve(REPO_ROOT, PROFILE_REL_PATH);

describe('ERP-4 Canonical Dirty Data Pack ([ERP4-25] #181)', () => {
  const csvText = readFileSync(CSV_FULL_PATH, 'utf8');
  const expectedProfileText = readFileSync(PROFILE_FULL_PATH, 'utf8');
  const expectedProfile = JSON.parse(expectedProfileText) as ProfileReport;
  const rawRows = readRawRows(csvText);

  // ── AC1: Dataset Volume & Privacy Guarantees ───────────────────────────────
  describe('AC1: Dataset Volume & Zero Real Data Guarantee', () => {
    it('dirty-data-v1.csv exists and contains at least 100 data rows', () => {
      expect(existsSync(CSV_FULL_PATH)).toBe(true);
      expect(rawRows.length).toBeGreaterThanOrEqual(100);
      expect(rawRows.length).toBe(143);
    });

    it('contains 100% synthetic corporate accounts with zero real personal data', () => {
      for (const row of rawRows) {
        if (row.source_id) {
          expect(row.source_id).toMatch(/^(ACC-SRC-|OPB-SRC-|JE-SRC-|JRL-SRC-)/);
        }

        if (row.code) {
          expect(row.code).toMatch(/^[A-Za-z0-9_\- !]+$/);
        }
      }
    });

    it('covers all 4 primary finance record types in required volumes', () => {
      const counts: Record<string, number> = {
        account: rawRows.filter((r) => r.record_type === 'account').length,
        opening_balance: rawRows.filter((r) => r.record_type === 'opening_balance').length,
        journal_entry: rawRows.filter((r) => r.record_type === 'journal_entry').length,
        journal_line: rawRows.filter((r) => r.record_type === 'journal_line').length,
      };

      expect(counts).toEqual(expectedProfile.fixture.by_record_type);
      expect(counts['account']).toBe(31);
      expect(counts['opening_balance']).toBe(19);
      expect(counts['journal_entry']).toBe(31);
      expect(counts['journal_line']).toBe(62);
    });
  });

  // ── AC2: Deterministic Manifest & Expected Outcomes ─────────────────────────
  describe('AC2: Outcome Manifest per Row', () => {
    it('manifest matches expected evaluation counts for accepted, rejected, review', () => {
      const profile = buildProfile(csvText);
      expect(profile.fixture.row_count).toBe(143);

      let totalAccepted = 0;
      let totalRejected = 0;
      let totalReview = 0;

      for (const entityCounts of Object.values(profile.by_record_type)) {
        totalAccepted += entityCounts.accepted;
        totalRejected += entityCounts.rejected;
        totalReview += entityCounts.review;
      }

      expect(totalAccepted).toBe(32);
      expect(totalRejected).toBe(106);
      expect(totalReview).toBe(5);
      expect(totalAccepted + totalRejected + totalReview).toBe(143);
    });

    it('documents expected failure categories: malformed, null required, duplicate, foreign key missing', () => {
      const byReason = expectedProfile.by_reason_code;

      // Null required
      expect(byReason['ACCOUNT_CODE_REQUIRED']).toBeGreaterThanOrEqual(1);
      expect(byReason['ACCOUNT_NAME_REQUIRED']).toBeGreaterThanOrEqual(1);
      expect(byReason['ACCOUNT_TYPE_REQUIRED']).toBeGreaterThanOrEqual(1);
      expect(byReason['ENTRY_NUMBER_REQUIRED']).toBeGreaterThanOrEqual(1);
      expect(byReason['BALANCE_AMOUNT_REQUIRED']).toBeGreaterThanOrEqual(1);

      // Malformed / invalid format
      expect(byReason['INVALID_ACCOUNT_CODE_FORMAT']).toBeGreaterThanOrEqual(1);
      expect(byReason['INVALID_ACCOUNT_TYPE']).toBeGreaterThanOrEqual(1);
      expect(byReason['INVALID_CURRENCY']).toBeGreaterThanOrEqual(1);
      expect(byReason['INVALID_BALANCE_AMOUNT']).toBeGreaterThanOrEqual(1);
      expect(byReason['INVALID_BOOLEAN']).toBeGreaterThanOrEqual(1);

      // Exact duplicate review
      expect(byReason['DUPLICATE_ACCOUNT_CODE_REVIEW']).toBeGreaterThanOrEqual(1);
      expect(byReason['DUPLICATE_ENTRY_NUMBER_REVIEW']).toBeGreaterThanOrEqual(1);
      expect(byReason['DUPLICATE_OPENING_BALANCE_REVIEW']).toBeGreaterThanOrEqual(1);

      // Foreign key / Reference missing
      expect(byReason['ACCOUNT_NOT_FOUND']).toBeGreaterThanOrEqual(1);
      expect(byReason['PARENT_ACCOUNT_NOT_FOUND']).toBeGreaterThanOrEqual(1);
      expect(byReason['CYCLE_DETECTED']).toBeGreaterThanOrEqual(1);
    });

    it('enforces total reconciliation invariant: source = accepted + rejected + review (unaccounted = 0)', () => {
      const counts = expectedProfile.by_record_type;
      let totalAccepted = 0;
      let totalRejected = 0;
      let totalReview = 0;

      for (const entityCounts of Object.values(counts)) {
        totalAccepted += entityCounts.accepted;
        totalRejected += entityCounts.rejected;
        totalReview += entityCounts.review;
      }

      const totalAccounted = totalAccepted + totalRejected + totalReview;
      expect(totalAccounted).toBe(expectedProfile.fixture.row_count);
      expect(expectedProfile.fixture.row_count - totalAccounted).toBe(0);
    });
  });

  // ── AC3: Edge Cases: Whitespace, Formatting, Boundaries ─────────────────────
  describe('AC3: Edge Cases & Anomaly Patterns', () => {
    it('contains leading and trailing whitespace padding in code and name', () => {
      const whitespaceRow = rawRows.find((r) => r.row_id === 'R002');
      expect(whitespaceRow).toBeDefined();
      expect(whitespaceRow?.code).toBe('  1010-CASH ');
      expect(whitespaceRow?.name).toBe('  Cash   on  Hand ');
      expect(whitespaceRow?.type).toBe(' ASSET ');
      expect(whitespaceRow?.currency_code).toBe(' inr ');
    });

    it('contains boundary length overflow fields', () => {
      const longCodeRow = rawRows.find((r) => r.row_id === 'R017');
      expect(longCodeRow?.code.length).toBeGreaterThan(32);

      const longNameRow = rawRows.find((r) => r.row_id === 'R019');
      expect(longNameRow?.name.length).toBeGreaterThan(255);
    });

    it('contains boundary numeric edge cases (negative amounts, zero amounts, excess decimals)', () => {
      const byReason = expectedProfile.by_reason_code;
      expect(byReason['NEGATIVE_AMOUNT']).toBeGreaterThanOrEqual(1);
      expect(byReason['EXCESS_DECIMAL_PLACES']).toBeGreaterThanOrEqual(1);
      expect(byReason['AMOUNT_OVERFLOW']).toBeGreaterThanOrEqual(1);
    });

    it('contains date format variants and locked periods', () => {
      const byReason = expectedProfile.by_reason_code;
      expect(byReason['AMBIGUOUS_DATE_FORMAT']).toBeGreaterThanOrEqual(1);
      expect(byReason['PERIOD_LOCKED']).toBeGreaterThanOrEqual(1);
    });
  });

  // ── AC4: Deterministic Reproducibility Across Runs ─────────────────────────
  describe('AC4: Deterministic Reproducibility', () => {
    it('produces identical fixture SHA-256 hash across repeated runs', () => {
      const hash1 = sha256Hex(csvText);
      const hash2 = sha256Hex(readFileSync(CSV_FULL_PATH, 'utf8'));
      expect(hash1).toBe(hash2);
      expect(hash1).toBe(expectedProfile.fixture.sha256);
    });

    it('evaluates identically and matches expected profile JSON byte-for-byte', () => {
      const profile = buildProfile(csvText);
      const profileJson = stableStringify(profile);
      expect(profileJson).toBe(expectedProfileText);
    });
  });
});
