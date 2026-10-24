// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DuplicateReviewModal } from '../src/components/DuplicateReviewModal.js';
import { DuplicateCandidatesPage } from '../src/pages/DuplicateCandidatesPage.js';
import type { Erp1DuplicateCandidateRecord } from '@clearshift/contracts';

const mockCandidate: Erp1DuplicateCandidateRecord = {
  candidate_id: '12345678-1234-4234-8234-123456789012',
  entity: 'product',
  match_kind: 'EXACT_SKU',
  status: 'PENDING_REVIEW',
  matching_key: 'sku',
  matching_value: 'BOLT-M8-STD',
  confidence: 1.0,
  incoming_record: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Bolt M8 Incoming Candidate',
    sku: 'BOLT-M8-STD',
    unitOfMeasure: 'pcs',
    price: '0.45',
  },
  existing_record: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Standard Steel Bolt M8',
    sku: 'BOLT-M8-STD',
    unitOfMeasure: 'pcs',
    price: '0.42',
  },
  created_at: '2026-10-23T00:00:00Z',
};

describe('ERP-1 Duplicate Review Web Components (ERP1-12 / KIT-10)', () => {
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
      expect(screen.getAllByText(/BOLT-M8-STD/).length).toBeGreaterThan(0);
      expect(screen.getByText('EXACT_SKU')).toBeDefined();
      expect(screen.getAllByText('Standard Steel Bolt M8').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Bolt M8 Incoming Candidate').length).toBeGreaterThan(0);
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

      const submitButton = screen.getByRole('button', { name: /Submit Decision/i }) as HTMLButtonElement;
      expect(submitButton.disabled).toBe(true);

      const textarea = screen.getByRole('textbox', { name: /Review Rationale/i });
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

      const textarea = screen.getByRole('textbox', { name: /Review Rationale/i });
      fireEvent.change(textarea, {
        target: { value: 'Verified legitimate duplicate product.' },
      });

      const submitButton = screen.getByRole('button', { name: /Submit Decision/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalledWith({
          candidate_id: '12345678-1234-4234-8234-123456789012',
          decision: 'MERGE',
          kept_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          merged_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          rationale: 'Verified legitimate duplicate product.',
        });
        expect(handleClose).toHaveBeenCalled();
      });
    });

    it('submits REJECT decision without kept/merged IDs', async () => {
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

      const rejectRadio = screen.getByRole('radio', { name: /Reject Candidate/i });
      fireEvent.click(rejectRadio);

      const textarea = screen.getByRole('textbox', { name: /Review Rationale/i });
      fireEvent.change(textarea, {
        target: { value: 'Invalid duplicate row, reject candidate' },
      });

      const submitButton = screen.getByRole('button', { name: /Submit Decision/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalledWith({
          candidate_id: '12345678-1234-4234-8234-123456789012',
          decision: 'REJECT',
          kept_id: undefined,
          merged_id: undefined,
          rationale: 'Invalid duplicate row, reject candidate',
        });
      });
    });
  });

  describe('DuplicateCandidatesPage Component', () => {
    it('fetches and renders candidate table with status badges', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [mockCandidate],
          total: 1,
        }),
      } as Response);

      render(<DuplicateCandidatesPage />);

      await waitFor(() => {
        expect(screen.getByText('Duplicate Candidates & Human Review Queue')).toBeDefined();
        expect(screen.getAllByText('BOLT-M8-STD').length).toBeGreaterThan(0);
        expect(screen.getByText('PENDING_REVIEW')).toBeDefined();
        expect(screen.getByRole('button', { name: /Review & Decide/i })).toBeDefined();
      });
    });

    it('opens review modal when clicking Review & Decide', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [mockCandidate],
          total: 1,
        }),
      } as Response);

      render(<DuplicateCandidatesPage />);

      const reviewButton = await screen.findByRole('button', { name: /Review & Decide/i });
      fireEvent.click(reviewButton);

      expect(screen.getByRole('dialog')).toBeDefined();
    });
  });
});
