import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchRunResult, type RunResult } from '../api/migration-kit.js';
import { SkeletonTable, EmptyState, ErrorState } from '@cs/ui';

export const RunResultPage: React.FC = () => {
  const { batchId } = useParams();
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchRunResult(batchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run result');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [batchId]);

  if (loading) return <div data-testid="run-result-loading"><SkeletonTable columns={4} rows={4} /></div>;
  if (error || !result) return <ErrorState title="Unable to load run result" message={error || 'No result'} onRetry={load} />;

  return (
    <div data-testid="run-result-page">
      <h1>Run Result</h1>
      <p data-testid="loaded-count">Loaded: {result.loaded}</p>
      <p data-testid="rejected-count">Rejected: {result.rejected}</p>
      <p data-testid="merged-count">Merged: {result.merged}</p>
      <p data-testid="skipped-count">Skipped: {result.skipped}</p>
      <p data-testid="source-count">Source: {result.source}</p>
      <p data-testid="unaccounted-count">Unaccounted: {result.unaccounted}</p>
    </div>
  );
};