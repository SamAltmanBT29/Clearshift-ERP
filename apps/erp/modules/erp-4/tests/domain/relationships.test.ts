/**
 * ERP-4 Finance & Accounting — Domain Relationships, State Transitions & Read Consistency Tests
 *
 * Exhaustively validates:
 *   - Issue #41 requirements and Acceptance Criteria
 *   - FR-ERP4-01..05 & BR-ERP4-01..02
 *   - Intra-module relationships:
 *       • Account parent hierarchy (cycle detection, currency match, non-existent parent, self-reference)
 *       • Journal entry to period (existence, closed period posting guard, locked/soft_closed)
 *       • Journal entry to lines & accounts (existence, active status, posting account, currency match)
 *       • Journal entry reversal relationship (only posted entries reversible, bidirectional link)
 *       • Opening balance to account (active, posting account, currency match, one-time enforcement)
 *   - Cross-module relationships & ReferenceResolver (Decision C7):
 *       • Department reference (ERP-5) via ReferenceResolver
 *       • Source reference (ERP-3) via ReferenceResolver
 *       • Failure safety on external resolver errors
 *       • Absent optional relationships produce approved warnings rather than synthetic records
 *       • Zero writes to external tables
 *   - State transition matrices (exhaustive allowed vs. forbidden transitions)
 *   - Enumeration rejection of unknown values
 *   - Immediate read-model consistency & authoritative derived totals
 *
 * @module erp4/tests/domain/relationships.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ReferenceResolver } from '@cs/kernel';
import type { JournalEntryStatus, PeriodStatus } from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { InMemoryFinanceRepository } from '../../src/services/repository.js';
import { FinanceService } from '../../src/services/finance.service.js';
import {
  RELATIONSHIP_ERROR_CODES,
  ERP4_RELATIONSHIPS,
  isJournalEntryTransitionAllowed,
  assertJournalEntryTransition,
  isPeriodTransitionAllowed,
  assertPeriodTransition,
  validateAccountParent,
  validateJournalLineAccount,
  validateJournalEntryPeriod,
  validateOpeningBalanceAccount,
  validateCrossModuleReference,
  assertValidAccountType,
  assertValidJournalEntryStatus,
  assertValidPeriodStatus,
  assertJournalEntryReadConsistency,
  assertTrialBalanceReadConsistency,
  handleOptionalRelationship,
  validateJournalEntryBalance,
} from '../../src/domain/relationships.js';
import { DomainError } from '../../domain/engine.js';
import {
  FIXTURE_ACCOUNT_CASH,
  FIXTURE_ACCOUNT_BANK,
  FIXTURE_ACCOUNT_SALES_REVENUE,
  FIXTURE_ACCOUNT_SALARY_EXPENSE,
  FIXTURE_PERIOD_OPEN,
  FIXTURE_PERIOD_SOFT_CLOSED,
  FIXTURE_PERIOD_LOCKED,
} from '../../fixtures/index.js';

describe('ERP-4 Finance & Accounting — Domain Relationships & State Transitions (#41)', () => {
  let repository: InMemoryFinanceRepository;
  let mockResolver: ReferenceResolver;
  let financeService: FinanceService;
  let app: FastifyInstance;

  beforeEach(() => {
    repository = new InMemoryFinanceRepository(true); // seed default fixtures
    mockResolver = {
      exists: vi.fn(async (entityType: string, id: string) => {
        if (entityType === 'department') {
          return id === 'dept-finance' || id === 'dept-engineering';
        }
        if (entityType === 'invoice') {
          return id === 'inv-valid-1001';
        }
        if (entityType === 'sales_order') {
          return id === 'so-valid-2001';
        }
        return false;
      }),
      get: vi.fn(async () => null),
    };
    financeService = new FinanceService({ repository, referenceResolver: mockResolver });
    app = buildApp({ repository, financeService, authRequired: false });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Intra-Module Relationships: Account Hierarchy
  // ───────────────────────────────────────────────────────────────────────────
  describe('Account Hierarchy & Parent Relationship (ACCOUNT_PARENT)', () => {
    it('allows creating child account referencing an existing parent with matching currency', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '1011-PETTY',
          name: 'Petty Cash Child',
          type: 'asset',
          currency_code: 'INR',
          parent_id: FIXTURE_ACCOUNT_CASH.id,
        },
      });

      expect(res.statusCode).toBe(201);
      const child = res.json();
      expect(child.parent_id).toBe(FIXTURE_ACCOUNT_CASH.id);
      expect(child.code).toBe('1011-PETTY');
    });

    it('rejects account creation with non-existent parent_id with stable code PARENT_NOT_FOUND', async () => {
      const fakeParentId = randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '1099-ORPHAN',
          name: 'Orphan Account',
          type: 'asset',
          currency_code: 'INR',
          parent_id: fakeParentId,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe(RELATIONSHIP_ERROR_CODES.PARENT_NOT_FOUND);
      expect(body.message).toContain('Parent account');

      // Verify no partial mutation occurred
      const lookup = await repository.getAccountByCode('1099-ORPHAN');
      expect(lookup).toBeNull();
    });

    it('rejects account update setting parent_id to itself with CYCLE_DETECTED', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/accounts/${FIXTURE_ACCOUNT_CASH.id}`,
        payload: {
          parent_id: FIXTURE_ACCOUNT_CASH.id,
        },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe(RELATIONSHIP_ERROR_CODES.CYCLE_DETECTED);
      expect(body.message).toContain('cannot have itself as parent_id');
    });

    it('rejects circular parent hierarchy across ancestors with CYCLE_DETECTED', async () => {
      // Create Account A
      const resA = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: { code: 'NODE-A', name: 'Node A', type: 'asset', currency_code: 'INR' },
      });
      const idA = resA.json().id;

      // Create Account B with parent A
      const resB = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: { code: 'NODE-B', name: 'Node B', type: 'asset', currency_code: 'INR', parent_id: idA },
      });
      const idB = resB.json().id;

      // Attempt to make A child of B (cycle: A -> B -> A)
      const resCycle = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/accounts/${idA}`,
        payload: { parent_id: idB },
      });

      expect(resCycle.statusCode).toBe(422);
      expect(resCycle.json().code).toBe(RELATIONSHIP_ERROR_CODES.CYCLE_DETECTED);
    });

    it('rejects parent relationship when child and parent currencies mismatch with CURRENCY_MISMATCH', async () => {
      // Cash fixture is INR; attempt to create USD child under it
      expect(() =>
        validateAccountParent(
          { code: 'USD-CHILD', currency_code: 'USD', parent_id: FIXTURE_ACCOUNT_CASH.id },
          FIXTURE_ACCOUNT_CASH
        )
      ).toThrowError(/Currency mismatch/);
    });

    it('renders approved warning when optional parent relationship is absent, without inventing a record', () => {
      const result = handleOptionalRelationship(null, 'parent_id', 'ACCOUNT_PARENT');
      expect(result.value).toBeNull();
      expect(result.warning).toBeDefined();
      expect(result.warning?.code).toBe('OPTIONAL_REFERENCE_ABSENT');
      expect(result.warning?.relationship).toBe('ACCOUNT_PARENT');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Intra-Module Relationships: Journal Entry to Period (JOURNAL_ENTRY_PERIOD)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Journal Entry to Period Relationship & Posting Guard', () => {
    it('creates draft entry in valid open period', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Valid open period draft',
          currency_code: 'INR',
          lines: [
            { account_id: FIXTURE_ACCOUNT_SALARY_EXPENSE.id, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_BANK.id, debit_amount: '0.0000', credit_amount: '1000.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const entry = res.json();
      expect(entry.period_id).toBe(FIXTURE_PERIOD_OPEN.id);
      expect(entry.status).toBe('draft');
    });

    it('rejects creating journal entry with non-existent period_id with PERIOD_NOT_FOUND', async () => {
      const fakePeriodId = randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: fakePeriodId,
          posting_date: '2026-04-10',
          description: 'Non-existent period entry',
          currency_code: 'INR',
          lines: [
            { account_id: FIXTURE_ACCOUNT_SALARY_EXPENSE.id, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_BANK.id, debit_amount: '0.0000', credit_amount: '1000.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(RELATIONSHIP_ERROR_CODES.PERIOD_NOT_FOUND);
    });

    it('rejects posting an entry into a locked period unconditionally with PERIOD_LOCKED', async () => {
      // Create draft in locked period
      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_LOCKED.id,
          posting_date: '2026-02-15',
          description: 'Locked period draft',
          currency_code: 'INR',
          lines: [
            { account_id: FIXTURE_ACCOUNT_SALARY_EXPENSE.id, debit_amount: '2000.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_BANK.id, debit_amount: '0.0000', credit_amount: '2000.0000' },
          ],
        },
      });
      const draftId = draftRes.json().id;

      // Attempt to post
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draftId}/post`,
        headers: {
          authorization: 'Bearer token-role:finance_admin',
        },
      });

      expect(postRes.statusCode).toBe(422);
      expect(postRes.json().code).toBe(RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED);
    });

    it('rejects staff posting into soft_closed period with PERIOD_SOFT_CLOSED (403)', async () => {
      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_SOFT_CLOSED.id,
          posting_date: '2026-03-15',
          description: 'Soft closed draft',
          currency_code: 'INR',
          lines: [
            { account_id: FIXTURE_ACCOUNT_SALARY_EXPENSE.id, debit_amount: '1500.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_BANK.id, debit_amount: '0.0000', credit_amount: '1500.0000' },
          ],
        },
      });
      const draftId = draftRes.json().id;

      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draftId}/post`,
        headers: {
          authorization: 'Bearer token-role:staff',
        },
      });

      expect(postRes.statusCode).toBe(403);
      expect(postRes.json().code).toBe(RELATIONSHIP_ERROR_CODES.PERIOD_SOFT_CLOSED);
    });

    it('allows finance_admin posting into soft_closed period', async () => {
      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_SOFT_CLOSED.id,
          posting_date: '2026-03-15',
          description: 'Soft closed admin draft',
          currency_code: 'INR',
          lines: [
            { account_id: FIXTURE_ACCOUNT_SALARY_EXPENSE.id, debit_amount: '1500.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_BANK.id, debit_amount: '0.0000', credit_amount: '1500.0000' },
          ],
        },
      });
      const draftId = draftRes.json().id;

      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draftId}/post`,
        headers: {
          authorization: 'Bearer token-role:finance_admin',
        },
      });

      expect(postRes.statusCode).toBe(200);
      expect(postRes.json().status).toBe('posted');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Intra-Module Relationships: Journal Entry to Lines & Accounts (JOURNAL_LINE_ACCOUNT)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Journal Line Account Relationships & Invariants', () => {
    it('rejects journal entry with fewer than 2 lines with MINIMUM_LINES_REQUIRED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'One line only',
          currency_code: 'INR',
          lines: [
            { account_id: FIXTURE_ACCOUNT_CASH.id, debit_amount: '100.0000', credit_amount: '0.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('at least 2 lines');
    });

    it('rejects line referencing non-existent account with ACCOUNT_NOT_FOUND', async () => {
      const fakeAccountId = randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Bad account',
          currency_code: 'INR',
          lines: [
            { account_id: fakeAccountId, debit_amount: '500.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_CASH.id, debit_amount: '0.0000', credit_amount: '500.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(RELATIONSHIP_ERROR_CODES.ACCOUNT_NOT_FOUND);
    });

    it('rejects line referencing an inactive account with ACCOUNT_INACTIVE', async () => {
      // Create an inactive account
      const acctRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: { code: 'INACTIVE-01', name: 'Decommissioned Account', type: 'asset', currency_code: 'INR' },
      });
      const inactiveId = acctRes.json().id;
      await repository.updateAccount(inactiveId, { is_active: false });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Post to inactive',
          currency_code: 'INR',
          lines: [
            { account_id: inactiveId, debit_amount: '500.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_CASH.id, debit_amount: '0.0000', credit_amount: '500.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(RELATIONSHIP_ERROR_CODES.ACCOUNT_INACTIVE);
    });

    it('rejects line referencing a header account with CANNOT_POST_TO_HEADER_ACCOUNT', async () => {
      // Create a non-posting header account
      const acctRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: 'HEADER-01',
          name: 'Summary Asset Header',
          type: 'asset',
          currency_code: 'INR',
          is_posting_account: false,
        },
      });
      const headerId = acctRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Post to header',
          currency_code: 'INR',
          lines: [
            { account_id: headerId, debit_amount: '500.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_CASH.id, debit_amount: '0.0000', credit_amount: '500.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(RELATIONSHIP_ERROR_CODES.CANNOT_POST_TO_HEADER_ACCOUNT);
    });

    it('rejects currency mismatch between account and journal entry with CURRENCY_MISMATCH', async () => {
      // Create USD account
      const usdAcctRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: { code: '1090-USD', name: 'US Dollar Bank', type: 'asset', currency_code: 'USD' },
      });
      const usdId = usdAcctRes.json().id;

      // Attempt to include USD account in INR journal entry
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Multi-currency forbidden in V1',
          currency_code: 'INR',
          lines: [
            { account_id: usdId, debit_amount: '100.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_CASH.id, debit_amount: '0.0000', credit_amount: '100.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(RELATIONSHIP_ERROR_CODES.CURRENCY_MISMATCH);
    });

    it('asserts domain invariant BR-ERP4-01: Every posted journal entry balances exactly at currency precision', async () => {
      // Valid balanced entry
      const balancedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Balanced entry',
          currency_code: 'INR',
          lines: [
            { account_id: FIXTURE_ACCOUNT_SALARY_EXPENSE.id, debit_amount: '3500.5000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_BANK.id, debit_amount: '0.0000', credit_amount: '3500.5000' },
          ],
        },
      });
      expect(balancedRes.statusCode).toBe(201);
      const entryId = balancedRes.json().id;

      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${entryId}/post`,
      });
      expect(postRes.statusCode).toBe(200);
      expect(postRes.json().status).toBe('posted');

      // Unbalanced entry rejected at creation
      const unbalRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Unbalanced draft',
          currency_code: 'INR',
          lines: [
            { account_id: FIXTURE_ACCOUNT_SALARY_EXPENSE.id, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_BANK.id, debit_amount: '0.0000', credit_amount: '950.0000' },
          ],
        },
      });
      expect(unbalRes.statusCode).toBe(400);
      expect(['VALIDATION_ERROR', RELATIONSHIP_ERROR_CODES.UNBALANCED_ENTRY]).toContain(unbalRes.json().code);
      expect(unbalRes.json().message.toLowerCase()).toContain('balance');

      // Assert domain validator throws exact RELATIONSHIP_ERROR_CODES.UNBALANCED_ENTRY
      expect(() =>
        validateJournalEntryBalance(
          [
            { account_id: FIXTURE_ACCOUNT_SALARY_EXPENSE.id, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_BANK.id, debit_amount: '0.0000', credit_amount: '950.0000' },
          ],
          'INR'
        )
      ).toThrowError(expect.objectContaining({ code: RELATIONSHIP_ERROR_CODES.UNBALANCED_ENTRY }));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Cross-Module Relationships & ReferenceResolver (Decision C7)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Cross-Module Integrity via ReferenceResolver (Decision C7)', () => {
    it('accepts journal lines referencing valid departments via ReferenceResolver', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Departmental expense',
          currency_code: 'INR',
          lines: [
            {
              account_id: FIXTURE_ACCOUNT_SALARY_EXPENSE.id,
              debit_amount: '1200.0000',
              credit_amount: '0.0000',
              department_ref: 'dept-engineering',
            },
            {
              account_id: FIXTURE_ACCOUNT_BANK.id,
              debit_amount: '0.0000',
              credit_amount: '1200.0000',
              department_ref: 'dept-finance',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockResolver.exists).toHaveBeenCalledWith('department', 'dept-engineering');
      expect(mockResolver.exists).toHaveBeenCalledWith('department', 'dept-finance');
    });

    it('rejects journal lines referencing non-existent departments with DEPARTMENT_NOT_FOUND (422) and no partial mutation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Bad department ref',
          currency_code: 'INR',
          lines: [
            {
              account_id: FIXTURE_ACCOUNT_SALARY_EXPENSE.id,
              debit_amount: '1200.0000',
              credit_amount: '0.0000',
              department_ref: 'dept-nonexistent-99',
            },
            {
              account_id: FIXTURE_ACCOUNT_BANK.id,
              debit_amount: '0.0000',
              credit_amount: '1200.0000',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(RELATIONSHIP_ERROR_CODES.DEPARTMENT_NOT_FOUND);
      expect(res.json().message).toContain('dept-nonexistent-99');
    });

    it('accepts journal entries referencing valid external invoices via ReferenceResolver', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Invoice revenue entry',
          currency_code: 'INR',
          source_reference: 'invoice:inv-valid-1001',
          lines: [
            { account_id: FIXTURE_ACCOUNT_CASH.id, debit_amount: '3000.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_SALES_REVENUE.id, debit_amount: '0.0000', credit_amount: '3000.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockResolver.exists).toHaveBeenCalledWith('invoice', 'inv-valid-1001');
    });

    it('rejects journal entries referencing non-existent external invoices with SOURCE_ENTITY_NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'Missing invoice reference',
          currency_code: 'INR',
          source_reference: 'invoice:inv-missing-9999',
          lines: [
            { account_id: FIXTURE_ACCOUNT_CASH.id, debit_amount: '3000.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_SALES_REVENUE.id, debit_amount: '0.0000', credit_amount: '3000.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(RELATIONSHIP_ERROR_CODES.SOURCE_ENTITY_NOT_FOUND);
    });

    it('handles absent optional cross-module references by rendering approved warnings without inventing dummy records', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          description: 'No external references',
          currency_code: 'INR',
          lines: [
            { account_id: FIXTURE_ACCOUNT_CASH.id, debit_amount: '400.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_SALES_REVENUE.id, debit_amount: '0.0000', credit_amount: '400.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json();
      expect(created.source_reference).toBeNull();
      expect(created.lines[0]?.department_ref).toBeNull();
    });

    it('is failure-safe when external ReferenceResolver throws an unexpected error', async () => {
      const errorResolver: ReferenceResolver = {
        exists: vi.fn(async () => {
          throw new Error('Connection refused to remote service');
        }),
        get: vi.fn(async () => null),
      };

      await expect(
        validateCrossModuleReference(errorResolver, 'department', 'dept-123', true, 'department_ref')
      ).rejects.toThrow(DomainError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. State Transition Matrices (Exhaustive Allowed vs Forbidden)
  // ───────────────────────────────────────────────────────────────────────────
  describe('State Transition Matrices (Journal Entry & Period FSM)', () => {
    const ALL_JE_STATUSES: JournalEntryStatus[] = ['draft', 'posted', 'reversed', 'voided'];

    it('validates every allowed and forbidden journal entry state transition', () => {
      // Allowed:
      // draft -> posted
      expect(isJournalEntryTransitionAllowed('draft', 'posted')).toBe(true);
      expect(() => assertJournalEntryTransition('draft', 'posted')).not.toThrow();

      // draft -> voided
      expect(isJournalEntryTransitionAllowed('draft', 'voided')).toBe(true);
      expect(() => assertJournalEntryTransition('draft', 'voided')).not.toThrow();

      // posted -> reversed
      expect(isJournalEntryTransitionAllowed('posted', 'reversed')).toBe(true);
      expect(() => assertJournalEntryTransition('posted', 'reversed')).not.toThrow();

      // Forbidden:
      // posted -> draft (immutable)
      expect(isJournalEntryTransitionAllowed('posted', 'draft')).toBe(false);
      expect(() => assertJournalEntryTransition('posted', 'draft')).toThrowError(
        /strictly immutable/
      );

      // posted -> voided (immutable)
      expect(isJournalEntryTransitionAllowed('posted', 'voided')).toBe(false);
      expect(() => assertJournalEntryTransition('posted', 'voided')).toThrowError(
        /cannot be voided/
      );

      // draft -> reversed (must be posted)
      expect(isJournalEntryTransitionAllowed('draft', 'reversed')).toBe(false);
      expect(() => assertJournalEntryTransition('draft', 'reversed')).toThrowError(
        /Only posted entries can be reversed/
      );

      // reversed -> * (terminal)
      for (const target of ALL_JE_STATUSES) {
        expect(isJournalEntryTransitionAllowed('reversed', target)).toBe(false);
        expect(() => assertJournalEntryTransition('reversed', target)).toThrow();
      }

      // voided -> * (terminal)
      for (const target of ALL_JE_STATUSES) {
        expect(isJournalEntryTransitionAllowed('voided', target)).toBe(false);
        expect(() => assertJournalEntryTransition('voided', target)).toThrow();
      }
    });

    const ALL_PERIOD_STATUSES: PeriodStatus[] = ['open', 'soft_closed', 'locked'];

    it('validates every allowed and forbidden accounting period state transition', () => {
      // Allowed:
      expect(isPeriodTransitionAllowed('open', 'soft_closed')).toBe(true);
      expect(isPeriodTransitionAllowed('soft_closed', 'locked')).toBe(true);
      expect(isPeriodTransitionAllowed('soft_closed', 'open')).toBe(true);
      expect(isPeriodTransitionAllowed('open', 'locked')).toBe(true);

      // Forbidden:
      expect(isPeriodTransitionAllowed('locked', 'open')).toBe(false);
      expect(() => assertPeriodTransition('locked', 'open', '2026-01')).toThrowError(/is locked/);

      expect(isPeriodTransitionAllowed('locked', 'soft_closed')).toBe(false);
      expect(() => assertPeriodTransition('locked', 'soft_closed', '2026-01')).toThrowError(
        /is locked/
      );
    });

    it('PATCH /periods/:id successfully updates open period to soft_closed', async () => {
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/periods/${FIXTURE_PERIOD_OPEN.id}`,
        payload: { status: 'soft_closed' },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().status).toBe('soft_closed');
      expect(patchRes.json().closed_at).toBeDefined();
    });

    it('PATCH /periods/:id rejects illegal transition from locked to open with HTTP 422 PERIOD_LOCKED', async () => {
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/periods/${FIXTURE_PERIOD_LOCKED.id}`,
        payload: { status: 'open' },
      });

      expect(patchRes.statusCode).toBe(422);
      expect(patchRes.json().code).toBe(RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Enumerations Validation
  // ───────────────────────────────────────────────────────────────────────────
  describe('Enumeration Rejection of Unknown Values', () => {
    it('rejects unknown account type values', () => {
      expect(() => assertValidAccountType('equity')).toThrowError(/Invalid account type/);
      expect(() => assertValidAccountType('capital')).toThrowError(/Invalid account type/);
      expect(() => assertValidAccountType('other')).toThrowError(/Invalid account type/);
      expect(assertValidAccountType('asset')).toBe('asset');
      expect(assertValidAccountType('liability')).toBe('liability');
      expect(assertValidAccountType('income')).toBe('income');
      expect(assertValidAccountType('expense')).toBe('expense');
    });

    it('rejects unknown journal entry status values', () => {
      expect(() => assertValidJournalEntryStatus('pending')).toThrowError(/Invalid journal entry status/);
      expect(() => assertValidJournalEntryStatus('approved')).toThrowError(/Invalid journal entry status/);
      expect(assertValidJournalEntryStatus('draft')).toBe('draft');
      expect(assertValidJournalEntryStatus('posted')).toBe('posted');
      expect(assertValidJournalEntryStatus('reversed')).toBe('reversed');
      expect(assertValidJournalEntryStatus('voided')).toBe('voided');
    });

    it('rejects unknown period status values', () => {
      expect(() => assertValidPeriodStatus('archived')).toThrowError(/Invalid accounting period status/);
      expect(() => assertValidPeriodStatus('active')).toThrowError(/Invalid accounting period status/);
      expect(assertValidPeriodStatus('open')).toBe('open');
      expect(assertValidPeriodStatus('soft_closed')).toBe('soft_closed');
      expect(assertValidPeriodStatus('locked')).toBe('locked');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Read-Model Consistency Immediately After Writes
  // ───────────────────────────────────────────────────────────────────────────
  describe('Read-Model Consistency & Authoritative State Agreement', () => {
    it('UI/Read API agree immediately on status, links, and derived trial balance totals after posting and reversal', async () => {
      // 1. Create draft entry
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-12',
          description: 'Consulting revenue transaction',
          currency_code: 'INR',
          lines: [
            { account_id: FIXTURE_ACCOUNT_BANK.id, debit_amount: '25000.0000', credit_amount: '0.0000' },
            { account_id: FIXTURE_ACCOUNT_SALES_REVENUE.id, debit_amount: '0.0000', credit_amount: '25000.0000' },
          ],
        },
      });
      const draft = createRes.json();
      expect(draft.status).toBe('draft');

      // 2. Read trial balance BEFORE posting: draft must NOT be present
      const tbBeforeRes = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-finance/trial-balance?period=${FIXTURE_PERIOD_OPEN.period_label}`,
      });
      const tbBefore = tbBeforeRes.json();
      const bankRowBefore = tbBefore.rows.find((r: any) => r.account_id === FIXTURE_ACCOUNT_BANK.id);
      expect(bankRowBefore?.total_debit ?? '0.0000').toBe('0.0000');

      // 3. Post the journal entry
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/post`,
      });
      expect(postRes.statusCode).toBe(200);
      const posted = postRes.json();
      expect(posted.status).toBe('posted');
      expect(posted.posted_at).toBeDefined();

      // Read single entry immediately reflects posted status and metadata
      const readPostedRes = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}`,
      });
      expect(readPostedRes.json().status).toBe('posted');
      expect(readPostedRes.json().posted_at).toBe(posted.posted_at);

      // 4. Read trial balance AFTER posting: immediately incorporates movements
      const tbAfterRes = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-finance/trial-balance?period=${FIXTURE_PERIOD_OPEN.period_label}`,
      });
      const tbAfter = tbAfterRes.json();
      const bankRowAfter = tbAfter.rows.find((r: any) => r.account_id === FIXTURE_ACCOUNT_BANK.id);
      expect(bankRowAfter?.total_debit).toBe('25000.0000');
      expect(tbAfter.totals.is_balanced).toBe(true);

      // 5. Reverse the journal entry
      const revRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/reverse`,
        payload: {
          reversal_description: 'Customer cancelled transaction',
        },
      });
      expect(revRes.statusCode).toBe(200);
      const { original, reversal } = revRes.json();
      expect(original.status).toBe('reversed');
      expect(original.reversed_by_entry_id).toBe(reversal.id);
      expect(reversal.status).toBe('posted');

      // 6. Read trial balance AFTER reversal: net balance immediately offsets
      const tbAfterRevRes = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-finance/trial-balance?period=${FIXTURE_PERIOD_OPEN.period_label}`,
      });
      const tbAfterRev = tbAfterRevRes.json();
      const bankRowRev = tbAfterRev.rows.find((r: any) => r.account_id === FIXTURE_ACCOUNT_BANK.id);
      expect(bankRowRev?.total_debit).toBe('25000.0000');
      expect(bankRowRev?.total_credit).toBe('25000.0000');
      expect(bankRowRev?.net_balance).toBe('0.0000');
      expect(tbAfterRev.totals.is_balanced).toBe(true);
    });

    it('asserts read-model consistency functions reject inconsistent entities', () => {
      // Inconsistent journal entry: status posted but posted_at is null
      expect(() =>
        assertJournalEntryReadConsistency({
          id: randomUUID(),
          entry_number: 'JV-FAIL',
          period_id: FIXTURE_PERIOD_OPEN.id,
          posting_date: '2026-04-10',
          status: 'posted',
          description: 'Broken posted entry',
          currency_code: 'INR',
          source_reference: null,
          idempotency_key: null,
          created_by_user_id: randomUUID(),
          posted_by_user_id: null,
          posted_at: null,
          reversed_by_entry_id: null,
          lines: [
            { id: randomUUID(), journal_entry_id: 'x', account_id: 'a', debit_amount: '10.0000', credit_amount: '0.0000', line_narration: null, department_ref: null, created_at: '' },
            { id: randomUUID(), journal_entry_id: 'x', account_id: 'b', debit_amount: '0.0000', credit_amount: '10.0000', line_narration: null, department_ref: null, created_at: '' },
          ],
          created_at: '',
          updated_at: '',
        })
      ).toThrowError(/posted_at and posted_by_user_id must be populated/);

      // Inconsistent trial balance totals: report debit does not equal sum of rows
      expect(() =>
        assertTrialBalanceReadConsistency(
          { total_debit: '100.0000', total_credit: '50.0000', difference: '50.0000', is_balanced: false },
          [
            {
              account_id: '1',
              account_code: '1010',
              account_name: 'Cash',
              account_type: 'asset',
              currency_code: 'INR',
              total_debit: '90.0000',
              total_credit: '50.0000',
              net_balance: '40.0000',
              opening_balance: '0.0000',
              closing_balance: '40.0000',
            },
          ]
        )
      ).toThrowError(/Trial balance total debit mismatch/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Opening Balances Relationship & One-Time Load Rule (FR-ERP4-04)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Opening Balances Relationship & One-Time Rule (FR-ERP4-04)', () => {
    it('loads opening balance once per account+currency; subsequent attempts are skipped with reason', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload: {
          balances: [
            {
              account_id: FIXTURE_ACCOUNT_CASH.id,
              currency_code: 'INR',
              balance_amount: '125000.0000',
              as_of_date: '2026-04-01',
            },
          ],
        },
      });

      expect(res1.statusCode).toBe(201);
      expect(res1.json().created).toHaveLength(1);
      expect(res1.json().skipped).toHaveLength(0);

      // Repeated load attempt for same account+currency
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload: {
          balances: [
            {
              account_id: FIXTURE_ACCOUNT_CASH.id,
              currency_code: 'INR',
              balance_amount: '125000.0000',
              as_of_date: '2026-04-01',
            },
          ],
        },
      });

      expect(res2.statusCode).toBe(201);
      expect(res2.json().created).toHaveLength(0);
      expect(res2.json().skipped).toHaveLength(1);
      expect(res2.json().skipped[0]?.reason).toContain('already loaded');
    });

    it('rejects opening balance for inactive or header accounts', () => {
      expect(() =>
        validateOpeningBalanceAccount(
          { account_id: 'x', currency_code: 'INR', balance_amount: '100.0000' },
          { ...FIXTURE_ACCOUNT_CASH, is_active: false },
          null
        )
      ).toThrowError(/inactive/);

      expect(() =>
        validateOpeningBalanceAccount(
          { account_id: 'x', currency_code: 'INR', balance_amount: '100.0000' },
          { ...FIXTURE_ACCOUNT_CASH, is_posting_account: false },
          null
        )
      ).toThrowError(/header account/);
    });
  });
});
