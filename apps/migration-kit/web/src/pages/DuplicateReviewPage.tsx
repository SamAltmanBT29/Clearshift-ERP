import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchDuplicates,
  resolveDuplicate,
  type DuplicateCandidate,
} from '../api/migration-kit.js';
import {
  SkeletonTable,
  EmptyState,
  ErrorState,
  PageTitle,
  StatusBadge,
  Alert,
} from '@cs/ui';

export const DuplicateReviewPage: React.FC = () => {
  const { batchId } = useParams();
  const [dupes, setDupes] = useState<DuplicateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<DuplicateCandidate | null>(null);

  const load = async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      const candidates = await fetchDuplicates(batchId);
      setDupes([...candidates]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load duplicate candidates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [batchId]);

  const handleDecision = async (
    id: string,
    decision: 'merge' | 'keep_both',
    reviewerRole: string = 'editor'
  ) => {
    try {
      setActionSuccess(null);
      await resolveDuplicate(id, decision, {
        reviewerId: 'operator-1',
        reviewerRole,
      });

      setDupes((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                status: decision === 'merge' ? 'merged' : 'keep_both',
                reviewedBy: 'operator-1',
                reviewedAt: new Date().toISOString(),
              }
            : d
        )
      );

      setActionSuccess(
        decision === 'merge'
          ? `Candidate successfully merged into existing target record.`
          : `Candidate marked to keep both (load as separate target record).`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit review decision');
    }
  };

  if (loading) {
    return (
      <div data-testid="duplicates-loading" style={{ padding: '24px' }}>
        <SkeletonTable columns={5} rows={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px' }}>
        <ErrorState
          title="Unable to load duplicate candidates"
          message={error}
          onRetry={load}
        />
      </div>
    );
  }

  if (dupes.length === 0) {
    return (
      <div style={{ padding: '24px' }}>
        <EmptyState
          title="No duplicate candidates"
          message="Zero duplicate candidates require human review for this batch."
        />

      </div>
    );
  }

  const pendingCount = dupes.filter((d) => !d.status || d.status === 'pending_review').length;

  return (
    <div data-testid="duplicate-review-page" style={{ padding: '24px' }}>
      <PageTitle
        title="Exact Duplicate Candidate Review"
        subtitle={`Batch: ${batchId} · ${pendingCount} pending review`}
      />

      {actionSuccess && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="success" title="Decision Recorded">
            {actionSuccess}
          </Alert>
        </div>
      )}

      <div
        style={{
          background: 'var(--cs-bg-card, #ffffff)',
          border: '1px solid var(--cs-border, #e2e8f0)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <table
          data-testid="duplicate-table"
          style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}
        >
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--cs-border, #e2e8f0)',
                background: 'var(--cs-bg-subtle, #f8fafc)',
              }}
            >
              <th style={{ padding: '12px 16px' }}>Source Row</th>
              <th style={{ padding: '12px 16px' }}>Matching Rule & Key</th>
              <th style={{ padding: '12px 16px' }}>Existing Target ID</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {dupes.map((d) => {
              const isPending = !d.status || d.status === 'pending_review';
              return (
                <tr
                  key={d.id}
                  data-testid={`duplicate-${d.id}`}
                  style={{
                    borderBottom: '1px solid var(--cs-border, #e2e8f0)',
                    background: isPending ? 'transparent' : 'var(--cs-bg-subtle, #f8fafc)',
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>Row {d.sourceRow}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 500 }}>{d.key}</div>
                    <div style={{ fontSize: '12px', color: 'var(--cs-text-muted, #64748b)' }}>
                      {d.rule ?? 'RULE_DUP_EMAIL_EXACT'}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '13px' }}>
                    {d.existingId}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {d.status === 'merged' && (
                      <StatusBadge variant="info" label="Merged" />
                    )}
                    {d.status === 'keep_both' && (
                      <StatusBadge variant="success" label="Keep Both" />
                    )}
                    {isPending && (
                      <StatusBadge variant="warning" label="Pending Review" />
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    {isPending ? (
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        <button
                          data-testid={`btn-merge-${d.id}`}
                          onClick={() => handleDecision(d.id, 'merge')}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--cs-primary, #2563eb)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 500,
                          }}
                        >
                          Merge
                        </button>
                        <button
                          data-testid={`btn-keep-both-${d.id}`}
                          onClick={() => handleDecision(d.id, 'keep_both')}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--cs-bg, #ffffff)',
                            border: '1px solid var(--cs-border, #cbd5e1)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 500,
                          }}
                        >
                          Keep both
                        </button>
                        {/* Backward-compat testid */}
                        <button
                          data-testid={`btn-skip-${d.id}`}
                          onClick={() => handleDecision(d.id, 'keep_both')}
                          style={{ display: 'none' }}
                        >
                          Skip
                        </button>
                      </div>
                    ) : (
                      <span
                        style={{
                          fontSize: '12px',
                          color: 'var(--cs-text-muted, #64748b)',
                        }}
                      >
                        Reviewed by {d.reviewedBy ?? 'operator'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

};

export default DuplicateReviewPage;