import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchDuplicates, resolveDuplicate, type DuplicateCandidate } from '../api/migration-kit.js';
import { SkeletonTable, EmptyState, ErrorState } from '@cs/ui';

export const DuplicateReviewPage: React.FC = () => {
  const { batchId } = useParams();
  const [dupes, setDupes] = useState<DuplicateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      setDupes([...(await fetchDuplicates(batchId))]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load duplicates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [batchId]);

  if (loading) return <div data-testid="duplicates-loading"><SkeletonTable columns={4} rows={4} /></div>;
  if (error) return <ErrorState title="Unable to load duplicates" message={error} onRetry={load} />;
  if (dupes.length === 0) return <EmptyState title="No duplicate candidates" />;

  return (
    <div data-testid="duplicate-review-page">
      <h1>Duplicate Review</h1>
      <table data-testid="duplicate-table">
        <tbody>
          {dupes.map((d) => (
            <tr key={d.id} data-testid={`duplicate-${d.id}`}>
              <td>{d.sourceRow}</td>
              <td>{d.key}</td>
              <td>{d.existingId}</td>
              <td>
                <button data-testid={`btn-merge-${d.id}`} onClick={() => resolveDuplicate(d.id, 'merge')}>Merge</button>
                <button data-testid={`btn-skip-${d.id}`} onClick={() => resolveDuplicate(d.id, 'skip')}>Skip</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};