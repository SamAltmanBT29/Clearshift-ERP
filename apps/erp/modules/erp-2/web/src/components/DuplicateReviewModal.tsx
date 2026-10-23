/**
 * ERP-2 Vendors & Purchasing — Duplicate Review Modal
 *
 * Accessible modal dialog presenting side-by-side comparison of an incoming
 * candidate record against an existing target record, highlighting exact normalized
 * matching keys, and providing operator decision actions (Merge, Reject, Keep Both)
 * with mandatory documented rationale.
 *
 * Traceability:
 *   - ERP2-12: Exact duplicate key policy for the module
 *   - KIT-10: Exact duplicate candidate review and audited merge decisions
 *
 * @module erp2/web/components/DuplicateReviewModal
 */

import React, { useState, useEffect } from 'react';
import type {
  DuplicateCandidateRecord,
  MergeDecisionType,
  ReviewDuplicateRequest,
} from '@clearshift/contracts';

export interface DuplicateReviewModalProps {
  candidate: DuplicateCandidateRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmitDecision: (request: ReviewDuplicateRequest) => Promise<void>;
  isSubmitting?: boolean;
}

export const DuplicateReviewModal: React.FC<DuplicateReviewModalProps> = ({
  candidate,
  isOpen,
  onClose,
  onSubmitDecision,
  isSubmitting = false,
}) => {
  const [decision, setDecision] = useState<MergeDecisionType>('MERGE');
  const [keptChoice, setKeptChoice] = useState<'existing' | 'incoming'>('existing');
  const [rationale, setRationale] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDecision('MERGE');
      setKeptChoice('existing');
      setRationale('');
      setError(null);
    }
  }, [isOpen, candidate]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !candidate) {
    return null;
  }

  const existing = candidate.existing_record as Record<string, unknown>;
  const incoming = candidate.incoming_record as Record<string, unknown>;

  const existingId = (existing['id'] as string) || '';
  const incomingId = (incoming['id'] as string) || candidate.candidate_id;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (rationale.trim().length < 5) {
      setError('Please provide a documented review rationale of at least 5 characters.');
      return;
    }

    let kept_id: string | undefined = undefined;
    let merged_id: string | undefined = undefined;

    if (decision === 'MERGE') {
      if (keptChoice === 'existing') {
        kept_id = existingId;
        merged_id = incomingId;
      } else {
        kept_id = incomingId;
        merged_id = existingId;
      }

      if (kept_id === merged_id) {
        setError('Cannot merge a record into itself. Kept and merged IDs must be distinct.');
        return;
      }
    }

    try {
      await onSubmitDecision({
        candidate_id: candidate.candidate_id,
        decision,
        kept_id,
        merged_id,
        rationale: rationale.trim(),
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit review decision';
      setError(msg);
    }
  };

  return (
    <div
      className="cs-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-review-title"
    >
      <div className="cs-modal-card bg-[var(--cs-bg-card,#1e293b)] border border-[var(--cs-border,#334155)] rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 text-[var(--cs-text,#f8fafc)]">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-[var(--cs-border,#334155)] pb-4 mb-4">
          <div>
            <h2 id="duplicate-review-title" className="text-xl font-bold tracking-tight">
              Duplicate Candidate Review
            </h2>
            <p className="text-sm text-[var(--cs-text-muted,#94a3b8)] mt-1">
              Deterministic exact key comparison for entity:{' '}
              <span className="font-semibold uppercase text-[var(--cs-primary,#38bdf8)]">
                {candidate.entity}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-[var(--cs-text-muted,#94a3b8)] hover:text-white text-2xl font-bold p-1 rounded transition-colors"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {/* Invariant & Matching Banner */}
        <div className="bg-[var(--cs-bg-secondary,#0f172a)] border border-[var(--cs-border,#334155)] rounded-md p-4 mb-5 flex flex-wrap gap-4 items-center justify-between">
          <div>
            <span className="text-xs uppercase tracking-wider text-[var(--cs-text-muted,#94a3b8)]">
              Matching Key & Value
            </span>
            <div className="font-mono text-sm font-semibold text-emerald-400 mt-0.5">
              {candidate.matching_key}: &ldquo;{candidate.matching_value}&rdquo;
            </div>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider text-[var(--cs-text-muted,#94a3b8)]">
              Match Classification
            </span>
            <div className="text-sm font-semibold mt-0.5">
              <span
                className={`inline-block px-2.5 py-0.5 rounded text-xs font-semibold ${
                  candidate.match_kind === 'AMBIGUOUS'
                    ? 'bg-amber-900/60 text-amber-200 border border-amber-600'
                    : 'bg-blue-900/60 text-blue-200 border border-blue-600'
                }`}
              >
                {candidate.match_kind}
              </span>
            </div>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider text-[var(--cs-text-muted,#94a3b8)]">
              Match Confidence
            </span>
            <div className="text-sm font-bold text-sky-400 mt-0.5">100% (Deterministic 1.0)</div>
          </div>
        </div>

        {/* Side-by-Side Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Existing Target Record */}
          <div className="border border-[var(--cs-border,#334155)] rounded-md p-4 bg-[var(--cs-bg-surface,#141e33)]">
            <div className="flex items-center justify-between mb-3 border-b border-[var(--cs-border,#334155)] pb-2">
              <h3 className="font-semibold text-sky-400 text-sm">Existing Target Record</h3>
              <span className="text-xs text-[var(--cs-text-muted,#94a3b8)]">In Database</span>
            </div>
            <dl className="text-xs space-y-2">
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">ID</dt>
                <dd className="font-mono truncate">{existingId || '—'}</dd>
              </div>
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Name / Title</dt>
                <dd className="font-medium text-sm">
                  {String(existing['name'] || existing['po_number'] || '—')}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Tax Number</dt>
                <dd className="font-mono">{String(existing['tax_number'] || '—')}</dd>
              </div>
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Email</dt>
                <dd className="font-mono">{String(existing['email'] || '—')}</dd>
              </div>
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Bank Details</dt>
                <dd className="font-mono text-amber-300">
                  {String(existing['bank_masked'] || 'Masked / Protected')}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Location / Currency</dt>
                <dd>
                  {String(existing['city'] || '')} {String(existing['country'] || '')} (
                  {String(existing['currency'] || 'USD')})
                </dd>
              </div>
            </dl>
          </div>

          {/* Incoming Candidate Record */}
          <div className="border border-[var(--cs-border,#334155)] rounded-md p-4 bg-[var(--cs-bg-surface,#141e33)]">
            <div className="flex items-center justify-between mb-3 border-b border-[var(--cs-border,#334155)] pb-2">
              <h3 className="font-semibold text-emerald-400 text-sm">Incoming Candidate Record</h3>
              <span className="text-xs text-[var(--cs-text-muted,#94a3b8)]">Pending Load</span>
            </div>
            <dl className="text-xs space-y-2">
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Candidate ID</dt>
                <dd className="font-mono truncate">{incomingId}</dd>
              </div>
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Name / Title</dt>
                <dd className="font-medium text-sm">
                  {String(incoming['name'] || incoming['po_number'] || '—')}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Tax Number</dt>
                <dd className="font-mono">{String(incoming['tax_number'] || '—')}</dd>
              </div>
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Email</dt>
                <dd className="font-mono">{String(incoming['email'] || '—')}</dd>
              </div>
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Bank Details</dt>
                <dd className="font-mono text-amber-300">
                  {String(incoming['bank_masked'] || 'Masked / Protected')}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--cs-text-muted,#94a3b8)]">Location / Currency</dt>
                <dd>
                  {String(incoming['city'] || '')} {String(incoming['country'] || '')} (
                  {String(incoming['currency'] || 'USD')})
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Decision Form */}
        <form onSubmit={handleSubmit} className="border-t border-[var(--cs-border,#334155)] pt-4">
          {error && (
            <div className="mb-4 p-3 bg-red-950/80 border border-red-700 text-red-200 text-sm rounded">
              {error}
            </div>
          )}

          {/* Decision Selection */}
          <div className="mb-4">
            <label className="block text-sm font-semibold mb-2">Review Decision</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label
                className={`flex items-center gap-2 p-3 border rounded cursor-pointer transition-colors ${
                  decision === 'MERGE'
                    ? 'border-sky-500 bg-sky-950/50 text-sky-200'
                    : 'border-[var(--cs-border,#334155)] bg-[var(--cs-bg-secondary,#0f172a)]'
                }`}
              >
                <input
                  type="radio"
                  name="decision"
                  value="MERGE"
                  checked={decision === 'MERGE'}
                  onChange={() => setDecision('MERGE')}
                  className="accent-sky-500"
                />
                <div>
                  <span className="font-bold text-sm block">Approve Merge</span>
                  <span className="text-xs text-[var(--cs-text-muted,#94a3b8)]">
                    Absorb candidate into target
                  </span>
                </div>
              </label>

              <label
                className={`flex items-center gap-2 p-3 border rounded cursor-pointer transition-colors ${
                  decision === 'KEEP_BOTH'
                    ? 'border-emerald-500 bg-emerald-950/50 text-emerald-200'
                    : 'border-[var(--cs-border,#334155)] bg-[var(--cs-bg-secondary,#0f172a)]'
                }`}
              >
                <input
                  type="radio"
                  name="decision"
                  value="KEEP_BOTH"
                  checked={decision === 'KEEP_BOTH'}
                  onChange={() => setDecision('KEEP_BOTH')}
                  className="accent-emerald-500"
                />
                <div>
                  <span className="font-bold text-sm block">Keep Both</span>
                  <span className="text-xs text-[var(--cs-text-muted,#94a3b8)]">
                    Retain as distinct entities
                  </span>
                </div>
              </label>

              <label
                className={`flex items-center gap-2 p-3 border rounded cursor-pointer transition-colors ${
                  decision === 'REJECT'
                    ? 'border-rose-500 bg-rose-950/50 text-rose-200'
                    : 'border-[var(--cs-border,#334155)] bg-[var(--cs-bg-secondary,#0f172a)]'
                }`}
              >
                <input
                  type="radio"
                  name="decision"
                  value="REJECT"
                  checked={decision === 'REJECT'}
                  onChange={() => setDecision('REJECT')}
                  className="accent-rose-500"
                />
                <div>
                  <span className="font-bold text-sm block">Reject Candidate</span>
                  <span className="text-xs text-[var(--cs-text-muted,#94a3b8)]">
                    Discard duplicate row
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Merge Target Selector (shown only if decision === 'MERGE') */}
          {decision === 'MERGE' && (
            <div className="mb-4 p-3 bg-[var(--cs-bg-secondary,#0f172a)] border border-[var(--cs-border,#334155)] rounded">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--cs-text-muted,#94a3b8)] mb-2">
                Which Record To Keep As Master?
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="keptChoice"
                    value="existing"
                    checked={keptChoice === 'existing'}
                    onChange={() => setKeptChoice('existing')}
                    className="accent-sky-500"
                  />
                  <span>
                    Keep Existing (<strong>{String(existing['name'] || existingId)}</strong>)
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="keptChoice"
                    value="incoming"
                    checked={keptChoice === 'incoming'}
                    onChange={() => setKeptChoice('incoming')}
                    className="accent-sky-500"
                  />
                  <span>
                    Keep Incoming (<strong>{String(incoming['name'] || incomingId)}</strong>)
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Review Rationale */}
          <div className="mb-5">
            <label htmlFor="review-rationale" className="block text-sm font-semibold mb-1">
              Documented Review Rationale <span className="text-red-400">*</span>
            </label>
            <textarea
              id="review-rationale"
              rows={3}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Document operator justification for merge/reject decision (recorded in immutable audit log)..."
              required
              className="w-full bg-[var(--cs-bg-secondary,#0f172a)] border border-[var(--cs-border,#334155)] rounded p-2 text-sm text-[var(--cs-text,#f8fafc)] focus:outline-none focus:border-sky-500"
            />
            <p className="text-xs text-[var(--cs-text-muted,#94a3b8)] mt-1">
              Minimum 5 characters. This decision is immutably logged with actor ID and timestamp.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm rounded border border-[var(--cs-border,#334155)] hover:bg-[var(--cs-bg-secondary,#0f172a)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || rationale.trim().length < 5}
              className="px-5 py-2 text-sm font-semibold rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Recording Audit Trail...' : 'Confirm Decision'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DuplicateReviewModal;
