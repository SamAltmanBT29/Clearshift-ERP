import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { DataHealthProfilePage } from '../src/pages/DataHealthProfilePage.js';
import type { DatasetProfileReport } from '@cs/kit';

describe('ERP-4 Data Health Profile Page Component (ERP4-26 / KIT-03)', () => {
  const mockReport: DatasetProfileReport = {
    totalRows: 143,
    sha256: '506eabd2932433b43c4181f84be1298fd5a2a5a3292d601d477885491cf130d1',
    isNonDestructive: true,
    generatedAt: '2026-10-23T20:00:00.000Z',
    columns: {
      'account.code': {
        column: 'code',
        label: 'Account Code',
        recordType: 'account',
        totalRows: 31,
        populatedCount: 30,
        nullCount: 1,
        distinctCount: 29,
        invalidFormatCount: 2,
        invalidFormatRate: 6.45,
        topValues: [
          { value: '1010-CASH', count: 2 },
          { value: '1020-BANK', count: 1 },
        ],
      },
      'journal_entry.entry_number': {
        column: 'entry_number',
        label: 'Journal Entry Number',
        recordType: 'journal_entry',
        totalRows: 31,
        populatedCount: 30,
        nullCount: 1,
        distinctCount: 29,
        invalidFormatCount: 2,
        invalidFormatRate: 6.45,
        topValues: [
          { value: 'JV-2026-0001', count: 2 },
        ],
      },
    },
    exactDuplicates: {
      account_code: {
        ruleName: 'account_code',
        label: 'Account Code (Exact Match)',
        recordType: 'account',
        candidateCount: 1,
        groups: [
          {
            key: '1010-CASH',
            occurrences: 2,
            rowIds: ['R002', 'R031'],
          },
        ],
      },
      journal_entry_number: {
        ruleName: 'journal_entry_number',
        label: 'Journal Entry Number (Exact Match)',
        recordType: 'journal_entry',
        candidateCount: 1,
        groups: [
          {
            key: 'JV-2026-0001',
            occurrences: 2,
            rowIds: ['R051', 'R073'],
          },
        ],
      },
    },
  };

  it('renders with initial report and props', () => {
    const onBack = vi.fn();
    const element = <DataHealthProfilePage initialReport={mockReport} onBack={onBack} />;
    expect(element).toBeDefined();
    expect(element.props.initialReport).toBe(mockReport);
    expect(element.props.onBack).toBe(onBack);
  });

  it('renders loading state when initialReport is null', () => {
    const element = <DataHealthProfilePage initialReport={null} />;
    expect(element.props.initialReport).toBeNull();
  });

  it('verifies report contains correct KPI metrics', () => {
    expect(mockReport.totalRows).toBe(143);
    expect(mockReport.isNonDestructive).toBe(true);
    expect(mockReport.sha256).toBe('506eabd2932433b43c4181f84be1298fd5a2a5a3292d601d477885491cf130d1');

    const exactDups = Object.values(mockReport.exactDuplicates);
    const candidateCount = exactDups.reduce((acc, r) => acc + r.candidateCount, 0);
    expect(candidateCount).toBe(2);
  });
});
