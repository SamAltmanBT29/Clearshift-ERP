/**
 * ERP-1 Products & Inventory — Duplicate Review Modal
 *
 * Accessible modal dialog presenting side-by-side comparison of an incoming
 * candidate record against an existing target record, highlighting exact normalized
 * matching keys (SKU or category code), and providing operator decision actions
 * (Merge, Reject, Keep Both) with mandatory documented rationale.
 *
 * Traceability:
 *   - ERP1-12: Exact duplicate key policy for the module
 *   - KIT-10: Exact duplicate candidate review and audited merge decisions
 *
 * @module erp1/web/components/DuplicateReviewModal
 */

import React, { useState, useEffect } from 'react';
import type {
  Erp1DuplicateCandidateRecord,
  Erp1MergeDecisionType,
  ReviewErp1DuplicateRequest,
} from '@clearshift/contracts';

export interface DuplicateReviewModalProps {
  candidate: Erp1DuplicateCandidateRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmitDecision: (request: ReviewErp1DuplicateRequest) => Promise<void>;
  isSubmitting?: boolean;
}

export const DuplicateReviewModal: React.FC<DuplicateReviewModalProps> = ({
  candidate,
  isOpen,
  onClose,
  onSubmitDecision,
  isSubmitting = false,
}) => {
  const [decision, setDecision] = useState<Erp1MergeDecisionType>('MERGE');
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

  const isExactSku = candidate.match_kind === 'EXACT_SKU' || candidate.match_kind === 'EXACT';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="cs-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1.5rem',
      }}
    >
      <div
        className="cs-modal-container"
        style={{
          backgroundColor: 'var(--cs-color-surface, #1e293b)',
          color: 'var(--cs-color-text, #f8fafc)',
          borderRadius: '0.75rem',
          maxWidth: '850px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          border: '1px solid var(--cs-color-border, #334155)',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--cs-color-border, #334155)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 id="modal-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
              Duplicate Candidate Review
            </h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#94a3b8' }}>
              Entity: <strong style={{ color: '#e2e8f0' }}>{candidate.entity.toUpperCase()}</strong> |
              Match Kind:{' '}
              <span
                style={{
                  display: 'inline-block',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  backgroundColor: isExactSku ? '#1e3a8a' : '#854d0e',
                  color: isExactSku ? '#93c5fd' : '#fef08a',
                  marginLeft: '0.25rem',
                }}
              >
                {candidate.match_kind}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.5rem',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              padding: '0.25rem',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Modal Body: Comparison */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {error && (
            <div
              role="alert"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid #ef4444',
                color: '#fca5a5',
                padding: '0.75rem 1rem',
                borderRadius: '0.375rem',
                marginBottom: '1.25rem',
                fontSize: '0.875rem',
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1.5rem',
              marginBottom: '1.5rem',
            }}
          >
            {/* Existing Target Record */}
            <div
              style={{
                backgroundColor: 'var(--cs-color-bg-secondary, #0f172a)',
                border: '1px solid var(--cs-color-border, #334155)',
                borderRadius: '0.5rem',
                padding: '1rem',
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: '#60a5fa',
                  marginBottom: '0.75rem',
                }}
              >
                Existing Target Record
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                <div>
                  <span style={{ color: '#94a3b8' }}>ID: </span>
                  <code style={{ fontSize: '0.8rem', color: '#e2e8f0' }}>{existingId || '—'}</code>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Name: </span>
                  <strong>{String(existing['name'] ?? '—')}</strong>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>{candidate.matching_key.toUpperCase()}: </span>
                  <span
                    style={{
                      backgroundColor: '#1e293b',
                      padding: '0.125rem 0.375rem',
                      borderRadius: '0.25rem',
                      border: '1px solid #3b82f6',
                      color: '#93c5fd',
                      fontWeight: 600,
                    }}
                  >
                    {String(existing[candidate.matching_key] ?? candidate.matching_value)}
                  </span>
                </div>
                {candidate.entity === 'product' && (
                  <>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Unit: </span>
                      <span>{String(existing['unitOfMeasure'] ?? '—')}</span>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Price: </span>
                      <span>{String(existing['price'] ?? '—')}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Incoming Candidate Record */}
            <div
              style={{
                backgroundColor: 'var(--cs-color-bg-secondary, #0f172a)',
                border: '1px solid var(--cs-color-border, #334155)',
                borderRadius: '0.5rem',
                padding: '1rem',
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: '#f59e0b',
                  marginBottom: '0.75rem',
                }}
              >
                Incoming Candidate Record
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                <div>
                  <span style={{ color: '#94a3b8' }}>Candidate ID: </span>
                  <code style={{ fontSize: '0.8rem', color: '#e2e8f0' }}>{incomingId || '—'}</code>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Name: </span>
                  <strong>{String(incoming['name'] ?? '—')}</strong>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>{candidate.matching_key.toUpperCase()}: </span>
                  <span
                    style={{
                      backgroundColor: '#1e293b',
                      padding: '0.125rem 0.375rem',
                      borderRadius: '0.25rem',
                      border: '1px solid #f59e0b',
                      color: '#fcd34d',
                      fontWeight: 600,
                    }}
                  >
                    {String(incoming[candidate.matching_key] ?? candidate.matching_value)}
                  </span>
                </div>
                {candidate.entity === 'product' && (
                  <>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Unit: </span>
                      <span>{String(incoming['unitOfMeasure'] ?? '—')}</span>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Price: </span>
                      <span>{String(incoming['price'] ?? '—')}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Decision Form */}
          <form id="duplicate-review-form" onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1.25rem' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  marginBottom: '0.5rem',
                  color: '#e2e8f0',
                }}
              >
                Merge Decision
              </label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                {(['MERGE', 'REJECT', 'KEEP_BOTH'] as const).map((opt) => (
                  <label
                    key={opt}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      fontSize: '0.875rem',
                      cursor: 'pointer',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '0.375rem',
                      backgroundColor: decision === opt ? '#334155' : 'transparent',
                      border: '1px solid',
                      borderColor: decision === opt ? '#60a5fa' : '#475569',
                    }}
                  >
                    <input
                      type="radio"
                      name="decision"
                      value={opt}
                      checked={decision === opt}
                      onChange={() => setDecision(opt)}
                      disabled={isSubmitting}
                    />
                    {opt === 'MERGE' && 'Merge Records'}
                    {opt === 'REJECT' && 'Reject Candidate'}
                    {opt === 'KEEP_BOTH' && 'Keep Both (Override)'}
                  </label>
                ))}
              </div>
            </div>

            {decision === 'MERGE' && (
              <div
                style={{
                  marginBottom: '1.25rem',
                  padding: '1rem',
                  backgroundColor: '#0f172a',
                  borderRadius: '0.375rem',
                  border: '1px solid #334155',
                }}
              >
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    marginBottom: '0.5rem',
                    color: '#e2e8f0',
                  }}
                >
                  Record to Retain (Golden Record)
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                    <input
                      type="radio"
                      name="keptChoice"
                      value="existing"
                      checked={keptChoice === 'existing'}
                      onChange={() => setKeptChoice('existing')}
                      disabled={isSubmitting}
                    />
                    <span>
                      Keep <strong>Existing Record</strong> ({existingId.slice(0, 8)}...), merge incoming candidate
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                    <input
                      type="radio"
                      name="keptChoice"
                      value="incoming"
                      checked={keptChoice === 'incoming'}
                      onChange={() => setKeptChoice('incoming')}
                      disabled={isSubmitting}
                    />
                    <span>
                      Keep <strong>Incoming Candidate</strong>, archive existing record
                    </span>
                  </label>
                </div>
              </div>
            )}

            <div style={{ marginBottom: '1rem' }}>
              <label
                htmlFor="review-rationale"
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  marginBottom: '0.375rem',
                  color: '#e2e8f0',
                }}
              >
                Review Rationale <span style={{ color: '#ef4444' }}>*</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400, marginLeft: '0.5rem' }}>
                  (Minimum 5 characters for immutable audit log)
                </span>
              </label>
              <textarea
                id="review-rationale"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                rows={3}
                required
                disabled={isSubmitting}
                placeholder="Document the operational or master-data rationale for this decision..."
                style={{
                  width: '100%',
                  padding: '0.625rem',
                  borderRadius: '0.375rem',
                  backgroundColor: '#0f172a',
                  border: '1px solid #475569',
                  color: '#f8fafc',
                  fontSize: '0.875rem',
                  resize: 'vertical',
                }}
              />
            </div>
          </form>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--cs-color-border, #334155)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            backgroundColor: 'var(--cs-color-surface, #1e293b)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="cs-btn cs-btn-secondary"
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: '1px solid #475569',
              background: 'transparent',
              color: '#e2e8f0',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="duplicate-review-form"
            disabled={isSubmitting || rationale.trim().length < 5}
            className="cs-btn cs-btn-primary"
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '0.375rem',
              border: 'none',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              fontWeight: 600,
              cursor: isSubmitting || rationale.trim().length < 5 ? 'not-allowed' : 'pointer',
              opacity: isSubmitting || rationale.trim().length < 5 ? 0.6 : 1,
              fontSize: '0.875rem',
            }}
          >
            {isSubmitting ? 'Recording Audit...' : 'Submit Decision'}
          </button>
        </div>
      </div>
    </div>
  );
};
