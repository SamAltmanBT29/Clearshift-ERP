// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DuplicateReviewPage } from '../src/pages/DuplicateReviewPage.js';
import * as api from '../src/api/migration-kit.js';

describe('DuplicateReviewPage Web Component (KIT-10)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders duplicate candidates and submits an audited merge decision', async () => {
    const mockCandidates = [
      {
        id: 'dup-101',
        sourceRow: 5,
        key: 'billing@acme.com',
        existingId: 'cust-uuid-001',
        rule: 'RULE_DUP_EMAIL_EXACT',
        status: 'pending_review' as const,
      },
    ];

    vi.spyOn(api, 'fetchDuplicates').mockResolvedValue(mockCandidates);
    const resolveSpy = vi.spyOn(api, 'resolveDuplicate').mockResolvedValue();

    render(
      <MemoryRouter initialEntries={['/kit/batches/b-001/duplicates']}>
        <Routes>
          <Route path="/kit/batches/:batchId/duplicates" element={<DuplicateReviewPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Assert table renders
    await waitFor(() => {
      expect(screen.getByTestId('duplicate-table')).toBeDefined();
    });

    expect(screen.getByText('Row 5')).toBeDefined();
    expect(screen.getByText('billing@acme.com')).toBeDefined();
    expect(screen.getByText('RULE_DUP_EMAIL_EXACT')).toBeDefined();

    // Click Merge
    const mergeBtn = screen.getByTestId('btn-merge-dup-101');
    fireEvent.click(mergeBtn);

    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith('dup-101', 'merge', expect.objectContaining({
        reviewerRole: 'editor',
      }));
    });
  });

  it('submits a keep both decision', async () => {
    const mockCandidates = [
      {
        id: 'dup-102',
        sourceRow: 12,
        key: '+15550199::acme supplies',
        existingId: 'cust-uuid-002',
        rule: 'RULE_DUP_PHONE_NAME_EXACT',
        status: 'pending_review' as const,
      },
    ];

    vi.spyOn(api, 'fetchDuplicates').mockResolvedValue(mockCandidates);
    const resolveSpy = vi.spyOn(api, 'resolveDuplicate').mockResolvedValue();

    render(
      <MemoryRouter initialEntries={['/kit/batches/b-002/duplicates']}>
        <Routes>
          <Route path="/kit/batches/:batchId/duplicates" element={<DuplicateReviewPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('btn-keep-both-dup-102')).toBeDefined();
    });

    const keepBothBtn = screen.getByTestId('btn-keep-both-dup-102');
    fireEvent.click(keepBothBtn);

    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith('dup-102', 'keep_both', expect.anything());
    });
  });

  it('displays empty state when zero duplicate candidates exist', async () => {
    vi.spyOn(api, 'fetchDuplicates').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/kit/batches/b-empty/duplicates']}>
        <Routes>
          <Route path="/kit/batches/:batchId/duplicates" element={<DuplicateReviewPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No duplicate candidates')).toBeDefined();
    });
  });
});
