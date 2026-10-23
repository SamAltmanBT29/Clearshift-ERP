/**
 * ERP-1 Products & Inventory — Duplicate Candidates Page
 *
 * Provides the review queue for inspecting exact duplicate candidates (SKU, category code),
 * conflicting ambiguous candidate keys, and submitting audited human review decisions.
 *
 * Traceability:
 *   - ERP1-12: Exact duplicate key policy for the module
 *   - KIT-10: Exact duplicate candidate review and audited merge decisions
 *
 * @module erp1/web/pages/DuplicateCandidatesPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { PageTitle, SkeletonTable, EmptyState, Alert } from '@cs/ui';
import type {
  Erp1DuplicateCandidateRecord,
  ReviewErp1DuplicateRequest,
  ReviewErp1DuplicateResponse,
} from '@clearshift/contracts';
import { DuplicateReviewModal } from '../components/DuplicateReviewModal.js';

export const DuplicateCandidatesPage: React.FC = () => {
  const [candidates, setCandidates] = useState<Erp1DuplicateCandidateRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [entityFilter, setEntityFilter] = useState<'all' | 'product' | 'category'>('all');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'PENDING_REVIEW' | 'MERGED' | 'REJECTED' | 'KEPT_BOTH'
  >('all');

  // Modal State
  const [selectedCandidate, setSelectedCandidate] = useState<Erp1DuplicateCandidateRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchCandidates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url =
        entityFilter === 'all'
          ? '/api/v1/erp-products/duplicates/candidates'
          : `/api/v1/erp-products/duplicates/candidates?entity=${entityFilter}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch duplicate candidates: HTTP ${res.status}`);
      }
      const data = await res.json();
      setCandidates(data.items || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch duplicate candidates';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [entityFilter]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const handleOpenReview = (candidate: Erp1DuplicateCandidateRecord) => {
    setSelectedCandidate(candidate);
    setIsModalOpen(true);
  };

  const handleCloseReview = () => {
    setIsModalOpen(false);
    setSelectedCandidate(null);
  };

  const handleSubmitDecision = async (request: ReviewErp1DuplicateRequest) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/erp-products/duplicates/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-actor-role': 'migration_runner',
        },
        body: JSON.stringify(request),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to record review: HTTP ${res.status}`);
      }

      const responseData: ReviewErp1DuplicateResponse = await res.json();

      // Update candidate in local state
      setCandidates((prev) =>
        prev.map((c) =>
          c.candidate_id === responseData.candidate_id
            ? {
                ...c,
                status: responseData.status,
                decision: responseData.decision,
                decided_at: responseData.timestamp,
                decided_by: responseData.actor_id,
              }
            : c
        )
      );

      setSuccessMessage(
        `Decision "${responseData.decision}" successfully recorded (Audit Record ID: ${responseData.audit_record_id})`
      );
      setTimeout(() => setSuccessMessage(null), 6000);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCandidates = candidates.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="cs-page cs-duplicates-page" style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <PageTitle
        title="Duplicate Candidates & Human Review Queue"
        subtitle="Review exact normalized key duplicates and ambiguous records requiring authorized human decision before merging into target catalog."
      />

      {successMessage && (
        <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
          <Alert variant="success" title="Success">
            {successMessage}
          </Alert>
        </div>
      )}

      {error && (
        <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
          <Alert variant="error" title="Error">
            {error}
          </Alert>
        </div>
      )}

      {/* Filter Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '1.5rem',
          marginBottom: '1.5rem',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div>
            <label htmlFor="entity-filter" style={{ fontSize: '0.875rem', marginRight: '0.5rem', color: '#94a3b8' }}>
              Entity:
            </label>
            <select
              id="entity-filter"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value as any)}
              style={{
                backgroundColor: 'var(--cs-color-surface, #1e293b)',
                color: '#e2e8f0',
                border: '1px solid #475569',
                borderRadius: '0.375rem',
                padding: '0.375rem 0.75rem',
                fontSize: '0.875rem',
              }}
            >
              <option value="all">All Entities</option>
              <option value="product">Products</option>
              <option value="category">Categories</option>
            </select>
          </div>

          <div>
            <label htmlFor="status-filter" style={{ fontSize: '0.875rem', marginRight: '0.5rem', color: '#94a3b8' }}>
              Status:
            </label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              style={{
                backgroundColor: 'var(--cs-color-surface, #1e293b)',
                color: '#e2e8f0',
                border: '1px solid #475569',
                borderRadius: '0.375rem',
                padding: '0.375rem 0.75rem',
                fontSize: '0.875rem',
              }}
            >
              <option value="all">All Statuses</option>
              <option value="PENDING_REVIEW">Pending Review</option>
              <option value="MERGED">Merged</option>
              <option value="REJECTED">Rejected</option>
              <option value="KEPT_BOTH">Kept Both</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => fetchCandidates()}
          disabled={isLoading}
          style={{
            padding: '0.375rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #475569',
            backgroundColor: 'transparent',
            color: '#e2e8f0',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontSize: '0.875rem',
          }}
        >
          {isLoading ? 'Refreshing...' : 'Refresh Queue'}
        </button>
      </div>

      {/* Candidate List Table */}
      {isLoading ? (
        <SkeletonTable rows={5} columns={6} />
      ) : filteredCandidates.length === 0 ? (
        <EmptyState
          title="No Duplicate Candidates Found"
          message={
            statusFilter !== 'all' || entityFilter !== 'all'
              ? 'No duplicate candidates match the selected filters.'
              : 'There are currently no duplicate candidates requiring human review in ERP-1.'
          }
        />
      ) : (
        <div
          style={{
            overflowX: 'auto',
            border: '1px solid var(--cs-color-border, #334155)',
            borderRadius: '0.5rem',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.875rem',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: 'var(--cs-color-surface, #1e293b)', borderBottom: '1px solid #334155' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Candidate ID</th>
                <th style={{ padding: '0.75rem 1rem' }}>Entity</th>
                <th style={{ padding: '0.75rem 1rem' }}>Matching Key</th>
                <th style={{ padding: '0.75rem 1rem' }}>Matching Value</th>
                <th style={{ padding: '0.75rem 1rem' }}>Match Kind</th>
                <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredCandidates.map((c) => (
                <tr
                  key={c.candidate_id}
                  style={{
                    borderBottom: '1px solid #334155',
                    backgroundColor: 'var(--cs-color-bg, #0f172a)',
                  }}
                >
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <code style={{ fontSize: '0.8rem', color: '#93c5fd' }}>{c.candidate_id.slice(0, 8)}...</code>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', textTransform: 'capitalize' }}>{c.entity}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{ fontWeight: 600 }}>{c.matching_key}</span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <code style={{ backgroundColor: '#1e293b', padding: '0.125rem 0.375rem', borderRadius: '0.25rem' }}>
                      {c.matching_value}
                    </code>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span
                      style={{
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        backgroundColor: c.match_kind.includes('EXACT') ? '#1e3a8a' : '#854d0e',
                        color: c.match_kind.includes('EXACT') ? '#93c5fd' : '#fef08a',
                      }}
                    >
                      {c.match_kind}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span
                      style={{
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        backgroundColor:
                          c.status === 'PENDING_REVIEW'
                            ? '#713f12'
                            : c.status === 'MERGED'
                            ? '#14532d'
                            : c.status === 'REJECTED'
                            ? '#7f1d1d'
                            : '#334155',
                        color:
                          c.status === 'PENDING_REVIEW'
                            ? '#fef08a'
                            : c.status === 'MERGED'
                            ? '#86efac'
                            : c.status === 'REJECTED'
                            ? '#fca5a5'
                            : '#e2e8f0',
                      }}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => handleOpenReview(c)}
                      style={{
                        padding: '0.375rem 0.75rem',
                        borderRadius: '0.375rem',
                        border: 'none',
                        backgroundColor: c.status === 'PENDING_REVIEW' ? '#2563eb' : '#475569',
                        color: '#ffffff',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {c.status === 'PENDING_REVIEW' ? 'Review & Decide' : 'View Decision'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Review Modal */}
      <DuplicateReviewModal
        candidate={selectedCandidate}
        isOpen={isModalOpen}
        onClose={handleCloseReview}
        onSubmitDecision={handleSubmitDecision}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};
