import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchReconciliation, type ReconciliationReport } from '../api/migration-kit.js';
import { SkeletonTable, EmptyState, ErrorState } from '@cs/ui';

export const ReconciliationPage: React.FC = () => {
  const { batchId } = useParams();
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchReconciliation(batchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reconciliation');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [batchId]);

  if (loading) return <div data-testid="reconciliation-loading"><SkeletonTable columns={4} rows={4} /></div>;
  if (error || !report) return <ErrorState title="Unable to load reconciliation" message={error || 'No report'} onRetry={load} />;

  return (
    <div data-testid="reconciliation-page">
      <h1>Reconciliation</h1>
      <p data-testid="recon-ok">{report.ok ? 'OK' : 'NOT OK'}</p>
      <p data-testid="recon-equation">
        {report.source} = {report.loaded} + {report.rejected} + {report.merged} + {report.skipped}
      </p>
    </div>
  );
};