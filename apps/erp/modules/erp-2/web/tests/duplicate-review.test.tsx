// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DuplicateReviewModal } from '../src/components/DuplicateReviewModal.js';
import { DuplicateCandidatesPage } from '../src/pages/DuplicateCandidatesPage.js';
import type { DuplicateCandidateRecord } from '@clearshift/contracts';

const mockCandidate: DuplicateCandidateRecord = {
  candidate_id: '12345678-1234-4234-8234-123456789012',
  entity: 'vendor',
  match_kind: 'EXACT_TAX_NUMBER',
  status: 'PENDING_REVIEW',
  matching_key: 'tax_number',
  matching_value: 'US-EIN-123456789',
  confidence: 1.0,
  incoming_record: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Acme Re-import Candidate',
    tax_number: 'US-EIN-123456789',
    email: 'billing@acme.com',
    currency: 'USD',
  },
  existing_record: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Acme Industrial Supplies LLC',
    tax_number: 'US-EIN-123456789',
    email: 'procurement@acme.com',
    currency: 'USD',
  },
  created_at: '2026-10-23T00:00:00Z',
};

describe('ERP-2 Duplicate Review Web Components (ERP2-12 / KIT-10)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('DuplicateReviewModal Component', () => {
    it('renders side-by-side comparison and exact matching key info', () => {
      render(
        <DuplicateReviewModal
          candidate={mockCandidate}
          isOpen={true}
          onClose={vi.fn()}
          onSubmitDecision={vi.fn()}
        />
      );

      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText('Duplicate Candidate Review')).toBeDefined();
      expect(screen.getAllByText(/US-EIN-123456789/).length).toBeGreaterThan(0);
      expect(screen.getByText('EXACT_TAX_NUMBER')).toBeDefined();
      expect(screen.getAllByText('Acme Industrial Supplies LLC').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Acme Re-import Candidate').length).toBeGreaterThan(0);
    });

    it('requires documented review rationale with at least 5 characters', async () => {
      const handleSubmit = vi.fn();
      render(
        <DuplicateReviewModal
          candidate={mockCandidate}
          isOpen={true}
          onClose={vi.fn()}
          onSubmitDecision={handleSubmit}
        />
      );

      const submitButton = screen.getByRole('button', { name: /Confirm Decision/i }) as HTMLButtonElement;
      expect(submitButton.disabled).toBe(true);

      const textarea = screen.getByRole('textbox', { name: /Documented Review Rationale/i });
      fireEvent.change(textarea, { target: { value: 'test' } }); // 4 chars -> still disabled
      expect(submitButton.disabled).toBe(true);

      fireEvent.change(textarea, { target: { value: 'Valid operator rationale' } }); // >5 chars
      expect(submitButton.disabled).toBe(false);
    });

    it('submits MERGE decision with kept_id and merged_id', async () => {
      const handleSubmit = vi.fn().mockResolvedValue(undefined);
      const handleClose = vi.fn();

      render(
        <DuplicateReviewModal
          candidate={mockCandidate}
          isOpen={true}
          onClose={handleClose}
          onSubmitDecision={handleSubmit}
        />
      );

      const textarea = screen.getByRole('textbox', { name: /Documented Review Rationale/i });
      fireEvent.change(textarea, {
        target: { value: 'Verified legitimate duplicate legal entity.' },
      });

      const submitButton = screen.getByRole('button', { name: /Confirm Decision/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalledWith({
          candidate_id: '12345678-1234-4234-8234-123456789012',
          decision: 'MERGE',
          kept_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          merged_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          rationale: 'Verified legitimate duplicate legal entity.',
        });
        expect(handleClose).toHaveBeenCalled();
      });
    });

    it('submits REJECT decision without requiring target merge IDs', async () => {
      const handleSubmit = vi.fn().mockResolvedValue(undefined);
      const handleClose = vi.fn();

      render(
        <DuplicateReviewModal
          candidate={mockCandidate}
          isOpen={true}
          onClose={handleClose}
          onSubmitDecision={handleSubmit}
        />
      );

      const rejectRadio = screen.getByLabelText(/Reject Candidate/i);
      fireEvent.click(rejectRadio);

      const textarea = screen.getByRole('textbox', { name: /Documented Review Rationale/i });
      fireEvent.change(textarea, {
        target: { value: 'Spurious test entry from legacy dump.' },
      });

      const submitButton = screen.getByRole('button', { name: /Confirm Decision/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalledWith({
          candidate_id: '12345678-1234-4234-8234-123456789012',
          decision: 'REJECT',
          kept_id: undefined,
          merged_id: undefined,
          rationale: 'Spurious test entry from legacy dump.',
        });
        expect(handleClose).toHaveBeenCalled();
      });
    });

    it('closes when Escape key is pressed', () => {
      const handleClose = vi.fn();
      render(
        <DuplicateReviewModal
          candidate={mockCandidate}
          isOpen={true}
          onClose={handleClose}
          onSubmitDecision={vi.fn()}
        />
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(handleClose).toHaveBeenCalled();
    });
  });

  describe('DuplicateCandidatesPage Integration', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            items: [mockCandidate],
            total: 1,
          }),
        })
      );
    });

    it('loads and displays duplicate candidate table', async () => {
      render(<DuplicateCandidatesPage />);

      expect(screen.getByText('Duplicate candidates')).toBeDefined();
      expect(
        screen.getByText(/Deterministic exact duplicate matching and audited human review/i)
      ).toBeDefined();

      const matchBadge = await screen.findByText('EXACT_TAX_NUMBER');
      expect(matchBadge).toBeDefined();
      expect(screen.getByText('PENDING_REVIEW')).toBeDefined();
      expect(screen.getByText('Review & Decide')).toBeDefined();
    });

    it('opens review modal when Review & Decide button is clicked', async () => {
      render(<DuplicateCandidatesPage />);

      const reviewBtn = await screen.findByText('Review & Decide');
      expect(reviewBtn).toBeDefined();

      fireEvent.click(reviewBtn);

      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText('Duplicate Candidate Review')).toBeDefined();
    });
  });
});
