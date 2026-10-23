import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { DataCleaningReviewPage } from '../src/pages/DataCleaningReviewPage.js';
import type { DatasetCleanResult } from '@cs/kit';

describe('ERP-4 Data Cleaning Review Page Component (ERP4-27 / KIT-04)', () => {
  const mockReport: DatasetCleanResult = {
    totalRows: 143,
    newCount: 77,
    cleanedCount: 42,
    rejectedCount: 24,
    auditCount: 65,
    generatedAt: '2026-10-23T20:00:00.000Z',
    enabledRuleIds: ['RL-TEXT-01', 'RL-NAME-01', 'RL-EMAIL-01', 'RL-DATE-01', 'RL-CURRENCY-01'],
    audits: [
      {
        sourceRow: 'R002',
        fieldName: 'code',
        originalValue: '  1010-CASH ',
        cleanedValue: '1010-CASH',
        ruleId: 'RL-TEXT-01',
        timestamp: '2026-10-23T20:00:00.000Z',
      },
      {
        sourceRow: 'R002',
        fieldName: 'name',
        originalValue: '  Cash   on  Hand ',
        cleanedValue: 'Cash on Hand',
        ruleId: 'RL-TEXT-01',
        timestamp: '2026-10-23T20:00:00.000Z',
      },
    ],
    rows: [
      {
        sourceRow: 'R002',
        outcome: 'cleaned',
        rawData: { row_id: 'R002', code: '  1010-CASH ', name: '  Cash   on  Hand ' },
        cleanedData: { row_id: 'R002', code: '1010-CASH', name: 'Cash on Hand' },
        audits: [
          {
            sourceRow: 'R002',
            fieldName: 'code',
            originalValue: '  1010-CASH ',
            cleanedValue: '1010-CASH',
            ruleId: 'RL-TEXT-01',
          },
        ],
        rejections: [],
      },
      {
        sourceRow: 'R015',
        outcome: 'rejected',
        rawData: { row_id: 'R015', code: '', name: 'No Code Account' },
        cleanedData: { row_id: 'R015', code: '', name: 'No Code Account' },
        audits: [],
        rejections: [
          {
            field: 'code',
            ruleId: 'RL-REQ-01',
            reasonCode: 'ACCOUNT_CODE_REQUIRED',
            message: 'Account code is required and cannot be empty.',
          },
        ],
      },
    ],
    rejections: [
      {
        sourceRow: 'R015',
        field: 'code',
        ruleId: 'RL-REQ-01',
        reasonCode: 'ACCOUNT_CODE_REQUIRED',
        message: 'Account code is required and cannot be empty.',
      },
    ],
  };

  it('renders with initial report and validates KPI props', () => {
    const onBack = vi.fn();
    const onProceed = vi.fn();
    const element = (
      <DataCleaningReviewPage
        initialReport={mockReport}
        onBack={onBack}
        onProceedToMapping={onProceed}
      />
    );
    expect(element).toBeDefined();
    expect(element.props.initialReport).toBe(mockReport);
    expect(element.props.onBack).toBe(onBack);
    expect(element.props.onProceedToMapping).toBe(onProceed);
  });

  it('renders loading state when initialReport is null', () => {
    const element = <DataCleaningReviewPage initialReport={null} />;
    expect(element.props.initialReport).toBeNull();
  });

  it('verifies report KPI totals match expectations', () => {
    expect(mockReport.totalRows).toBe(143);
    expect(mockReport.cleanedCount).toBe(42);
    expect(mockReport.rejectedCount).toBe(24);
    expect(mockReport.auditCount).toBe(65);
    expect(mockReport.audits.length).toBe(2);
    expect(mockReport.audits[0]?.fieldName).toBe('code');
    expect(mockReport.audits[0]?.ruleId).toBe('RL-TEXT-01');
  });
});
