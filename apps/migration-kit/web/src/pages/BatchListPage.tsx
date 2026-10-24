import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBatches, type MigrationBatch } from '../api/migration-kit.js';
import { SkeletonTable, EmptyState, ErrorState } from '@cs/ui';

export const BatchListPage: React.FC = () => {
  const [batches, setBatches] = useState<MigrationBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setBatches(await fetchBatches());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load batches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div data-testid="batch-list-loading" aria-label="Loading batches">
        <SkeletonTable columns={6} rows={5} />
      </div>
    );
  }
  if (error) {
    return <ErrorState title="Unable to load batches" message={error} onRetry={load} />;
  }
  if (batches.length === 0) {
    return <EmptyState title="No migration batches" message="Create a new batch to begin." />;
  }

  return (
    <div data-testid="batch-list-page" className="cs-page-container">
      <h1>Migration Batches</h1>
      <table data-testid="batch-list-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Module</th>
            <th>Entity</th>
            <th>Status</th>
            <th>Rows</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} data-testid={`batch-row-${b.id}`}>
              <td><Link to={`/kit/batches/${b.id}`}>{b.id}</Link></td>
              <td>{b.name}</td>
              <td>{b.module}</td>
              <td>{b.entity}</td>
              <td>{b.status}</td>
              <td>{b.sourceRowCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link to="/kit/batches/new" data-testid="btn-new-batch">New Batch</Link>
    </div>
  );
};