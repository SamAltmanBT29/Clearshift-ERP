/**
 * ERP-2 Vendors & Purchasing — Duplicate Candidates Page
 *
 * Provides the integration review queue for inspecting exact duplicate candidates,
 * conflicting ambiguous candidate keys, and submitting audited human review decisions.
 *
 * Traceability:
 *   - ERP2-12: Exact duplicate key policy for the module
 *   - KIT-10: Exact duplicate candidate review and audited merge decisions
 *
 * @module erp2/web/pages/DuplicateCandidatesPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { PageTitle } from '@cs/ui';
import type {
  DuplicateCandidateRecord,
  ReviewDuplicateRequest,
  ReviewDuplicateResponse,
} from '@clearshift/contracts';
import { DuplicateReviewModal } from '../components/DuplicateReviewModal.js';
import { EmptyState, SkeletonTable } from '../components/StateViews.js';

export const DuplicateCandidatesPage: React.FC = () => {
  const [candidates, setCandidates] = useState<DuplicateCandidateRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [entityFilter, setEntityFilter] = useState<'all' | 'vendor' | 'purchase_order'>('all');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'PENDING_REVIEW' | 'MERGED' | 'REJECTED' | 'KEPT_BOTH'
  >('all');

  // Modal State
  const [selectedCandidate, setSelectedCandidate] = useState<DuplicateCandidateRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchCandidates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url =
        entityFilter === 'all'
          ? '/api/v1/erp-vendors/duplicates/candidates'
          : `/api/v1/erp-vendors/duplicates/candidates?entity=${entityFilter}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch duplicate candidates: HTTP ${res.status}`);
      }
      const data = await res.json();
      setCandidates(data.items || []);
    } catch (err: unknown) {
      // If endpoint returns error or during mock/offline testing, fallback to local state gracefully
      const msg = err instanceof Error ? err.message : 'Failed to fetch duplicate candidates';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [entityFilter]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const handleOpenReview = (candidate: DuplicateCandidateRecord) => {
    setSelectedCandidate(candidate);
    setIsModalOpen(true);
  };

  const handleCloseReview = () => {
    setIsModalOpen(false);
    setSelectedCandidate(null);
  };

  const handleSubmitDecision = async (request: ReviewDuplicateRequest) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/erp-vendors/duplicates/review', {
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

      const responseData: ReviewDuplicateResponse = await res.json();

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
                rationale: request.rationale,
              }
            : c
        )
      );

      setSuccessMessage(
        `Decision '${responseData.decision}' successfully recorded for candidate ${responseData.candidate_id}. Audit record ID: ${responseData.audit_record_id}`
      );
      setTimeout(() => setSuccessMessage(null), 6000);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter candidates locally
  const filteredCandidates = candidates.filter((c) => {
    if (entityFilter !== 'all' && c.entity !== entityFilter) return false;
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="cs-page-container p-6 max-w-7xl mx-auto text-[var(--cs-text,#f8fafc)]">
      <PageTitle
        title="Duplicate candidates"
        subtitle="Deterministic exact duplicate matching and audited human review decisions (ERP2-12 / KIT-10)"
      />

      {/* Banner on V1 Policy */}
      <div className="cs-card bg-[var(--cs-bg-card,#1e293b)] border border-[var(--cs-border,#334155)] rounded-lg p-4 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-sky-400">
              V1 Deterministic Duplicate Policy Invariants
            </h3>
            <p className="text-xs text-[var(--cs-text-muted,#94a3b8)] mt-1">
              • Normalized exact keys only (tax number, email, PO number). Confidence is strictly 1.0.
              <br />
              • Probabilistic fuzzy matching scoring is strictly out of scope.
              <br />
              • No automatic target-side merging: all merges require human operator approval with
              immutable audit logging.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchCandidates}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-[var(--cs-bg-secondary,#0f172a)] hover:bg-[var(--cs-border,#334155)] border border-[var(--cs-border,#334155)] transition-colors"
          >
            Refresh Queue
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="mb-4 p-3 bg-emerald-950/80 border border-emerald-700 text-emerald-200 text-sm rounded">
          {successMessage}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-amber-950/80 border border-amber-700 text-amber-200 text-sm rounded">
          {error}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        {/* Entity Tabs */}
        <div className="flex gap-2" role="tablist" aria-label="Entity filter">
          {(['all', 'vendor', 'purchase_order'] as const).map((ent) => (
            <button
              key={ent}
              type="button"
              role="tab"
              aria-selected={entityFilter === ent}
              onClick={() => setEntityFilter(ent)}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                entityFilter === ent
                  ? 'bg-sky-600 text-white'
                  : 'bg-[var(--cs-bg-secondary,#0f172a)] text-[var(--cs-text-muted,#94a3b8)] hover:text-white border border-[var(--cs-border,#334155)]'
              }`}
            >
              {ent === 'all' ? 'All Entities' : ent === 'vendor' ? 'Vendors' : 'Purchase Orders'}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="status-filter" className="text-[var(--cs-text-muted,#94a3b8)] font-semibold">
            Status:
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-[var(--cs-bg-secondary,#0f172a)] border border-[var(--cs-border,#334155)] rounded px-2 py-1 text-xs text-[var(--cs-text,#f8fafc)] focus:outline-none focus:border-sky-500"
          >
            <option value="all">All States</option>
            <option value="PENDING_REVIEW">Pending Review</option>
            <option value="MERGED">Merged</option>
            <option value="REJECTED">Rejected</option>
            <option value="KEPT_BOTH">Kept Both</option>
          </select>
        </div>
      </div>

      {/* Table / Results */}
      {isLoading ? (
        <SkeletonTable columns={6} rows={5} />
      ) : filteredCandidates.length === 0 ? (
        <EmptyState
          title="No duplicate candidates in queue"
          message="No duplicate candidates match the selected filters. Incoming records with exact key collisions will be routed here for review."
          actionLabel="Refresh Candidates"
          onAction={fetchCandidates}
        />
      ) : (
        <div className="cs-table-card border border-[var(--cs-border,#334155)] rounded-lg overflow-x-auto bg-[var(--cs-bg-card,#1e293b)]">
          <table className="cs-table w-full text-left text-sm" role="region" aria-label="Duplicate Candidates">
            <thead className="bg-[var(--cs-bg-secondary,#0f172a)] border-b border-[var(--cs-border,#334155)] text-xs uppercase text-[var(--cs-text-muted,#94a3b8)] font-semibold">
              <tr>
                <th scope="col" className="p-3">Entity</th>
                <th scope="col" className="p-3">Match Kind</th>
                <th scope="col" className="p-3">Matching Key & Value</th>
                <th scope="col" className="p-3">Incoming vs Existing</th>
                <th scope="col" className="p-3">Status</th>
                <th scope="col" className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cs-border,#334155)]">
              {filteredCandidates.map((candidate) => {
                const incoming = candidate.incoming_record as Record<string, unknown>;
                const existing = candidate.existing_record as Record<string, unknown>;
                const incomingLabel = String(incoming['name'] || incoming['po_number'] || candidate.candidate_id);
                const existingLabel = String(existing['name'] || existing['po_number'] || existing['id'] || '—');

                return (
                  <tr key={candidate.candidate_id} className="hover:bg-[var(--cs-bg-secondary,#0f172a)]/50 transition-colors">
                    <td className="p-3 font-semibold text-xs uppercase text-sky-400">
                      {candidate.entity}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                          candidate.match_kind === 'AMBIGUOUS'
                            ? 'bg-amber-900/60 text-amber-200 border border-amber-600'
                            : 'bg-blue-900/60 text-blue-200 border border-blue-600'
                        }`}
                      >
                        {candidate.match_kind}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="font-mono text-xs font-semibold text-emerald-400">
                        {candidate.matching_key}
                      </div>
                      <div className="text-xs text-[var(--cs-text-muted,#94a3b8)] truncate max-w-xs">
                        &ldquo;{candidate.matching_value}&rdquo;
                      </div>
                    </td>
                    <td className="p-3 text-xs">
                      <div>
                        <span className="text-[var(--cs-text-muted,#94a3b8)]">In:</span>{' '}
                        <span className="font-medium">{incomingLabel}</span>
                      </div>
                      <div>
                        <span className="text-[var(--cs-text-muted,#94a3b8)]">Db:</span>{' '}
                        <span className="text-sky-300 font-medium">{existingLabel}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          candidate.status === 'PENDING_REVIEW'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : candidate.status === 'MERGED'
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : candidate.status === 'KEPT_BOTH'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}
                      >
                        {candidate.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenReview(candidate)}
                        className="px-3 py-1.5 text-xs font-semibold rounded bg-sky-600 hover:bg-sky-500 text-white transition-colors"
                      >
                        {candidate.status === 'PENDING_REVIEW' ? 'Review & Decide' : 'View Decision'}
                      </button>
                    </td>
                  </tr>
                );
              })}
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

export default DuplicateCandidatesPage;
