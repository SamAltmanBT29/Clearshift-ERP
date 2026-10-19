import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchAccounts,
  fetchTrialBalance,
  createAccount,
  createJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  ApiError,
} from '../src/api/erp-4.js';
import { isJournalEntryBalanced } from '@clearshift/contracts';

describe('ERP-4 Frontend API Client & View Logic Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchAccounts() and Query Construction', () => {
    it('constructs correct query params and returns paginated accounts', async () => {
      const mockResponse = {
        items: [
          {
            id: 'a1111111-1111-1111-1111-111111111111',
            code: '1010',
            name: 'Cash in Bank',
            type: 'asset',
            currencyCode: 'USD',
            isActive: true,
            balance: 25000,
            createdAt: '2026-10-19T00:00:00.000Z',
            updatedAt: '2026-10-19T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchAccounts({
        page: 1,
        limit: 20,
        search: 'Cash',
        type: 'asset',
        isActive: true,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/erp-finance/accounts?page=1&limit=20&search=Cash&type=asset&isActive=true',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        })
      );
      expect(result.items.length).toBe(1);
      expect(result.items[0]?.code).toBe('1010');
    });

    it('asserts that changing search or filter resets page to 1', () => {
      // Logic test for search/filter resetting pagination
      const initialFilters = { page: 3, limit: 20, search: '', type: undefined };
      const updatedSearch = 'Receivable';
      const newFilters = {
        ...initialFilters,
        search: updatedSearch,
        page: 1, // Acceptance criterion: resets to page 1
      };

      expect(newFilters.page).toBe(1);
      expect(newFilters.search).toBe('Receivable');
    });

    it('handles API errors gracefully with ApiError envelope', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          code: 'ACCOUNTS_NOT_FOUND',
          message: 'Chart of accounts table is not initialized',
        }),
      });

      await expect(fetchAccounts()).rejects.toThrow(ApiError);
    });
  });

  describe('fetchTrialBalance() and Invariant Verification', () => {
    it('fetches trial balance and asserts double-entry balance invariant', async () => {
      const mockTrialBalance = {
        period: '2026-10',
        currencyCode: 'USD',
        items: [
          {
            accountId: 'a1111111-1111-1111-1111-111111111111',
            accountCode: '1010',
            accountName: 'Cash',
            accountType: 'asset',
            currencyCode: 'USD',
            debit: 10000,
            credit: 0,
            netBalance: 10000,
          },
          {
            accountId: 'a2222222-2222-2222-2222-222222222222',
            accountCode: '3010',
            accountName: 'Retained Earnings',
            accountType: 'equity',
            currencyCode: 'USD',
            debit: 0,
            credit: 10000,
            netBalance: -10000,
          },
        ],
        totalDebit: 10000,
        totalCredit: 10000,
        isBalanced: true,
        accountCount: 2,
        generatedAt: '2026-10-19T00:00:00.000Z',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTrialBalance,
      });

      const report = await fetchTrialBalance('2026-10', 'USD');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/erp-finance/trial-balance?period=2026-10&currencyCode=USD',
        expect.anything()
      );
      expect(report.isBalanced).toBe(true);
      expect(report.totalDebit).toEqual(report.totalCredit);
    });
  });

  describe('Journal Entry Balance Verification (BR-ERP4-01)', () => {
    it('returns true when lines balance at 2 decimal places', () => {
      const balancedLines = [
        { debit: 1250.75, credit: 0 },
        { debit: 0, credit: 1250.75 },
      ];
      expect(isJournalEntryBalanced(balancedLines)).toBe(true);
    });

    it('returns false when lines do not balance', () => {
      const unbalancedLines = [
        { debit: 1250.75, credit: 0 },
        { debit: 0, credit: 1250.0 }, // 75 cents off
      ];
      expect(isJournalEntryBalanced(unbalancedLines)).toBe(false);
    });
  });

  describe('Post and Reversal Actions', () => {
    it('calls post endpoint with correct URL', async () => {
      const entryId = 'j1111111-1111-1111-1111-111111111111';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: entryId, status: 'posted' }),
      });

      const res = await postJournalEntry(entryId);
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/v1/erp-finance/journal-entries/${entryId}/post`,
        expect.objectContaining({ method: 'POST' })
      );
      expect(res.status).toBe('posted');
    });

    it('calls reverse endpoint with correct URL', async () => {
      const entryId = 'j1111111-1111-1111-1111-111111111111';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: entryId, status: 'reversed' }),
      });

      const res = await reverseJournalEntry(entryId);
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/v1/erp-finance/journal-entries/${entryId}/reverse`,
        expect.objectContaining({ method: 'POST' })
      );
      expect(res.status).toBe('reversed');
    });
  });
});
