import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchRejects, exportRejectsCsv, type RejectRow } from '../api/migration-kit.js';
import { SkeletonTable, EmptyState, ErrorState } from '@cs/ui';

export const RejectListPage: React.FC = () => {
  const { batchId } = useParams();
  const [rows, setRows] = useState<RejectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRejects(batchId, page, 25);
      setRows([...res.rows]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rejects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [batchId, page]);

  const handleExport = async () => {
    if (!batchId) return;
    const csv = await exportRejectsCsv(batchId);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `rejects-${batchId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) return <div data-testid="rejects-loading"><SkeletonTable columns={3} rows={4} /></div>;
  if (error) return <ErrorState title="Unable to load rejects" message={error} onRetry={load} />;
  if (rows.length === 0) return <EmptyState title="No rejected rows" />;

  return (
    <div data-testid="reject-list-page">
      <h1>Reject List</h1>
      <button data-testid="btn-export-rejects" onClick={handleExport}>Export CSV</button>
      <table data-testid="rejects-table">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} data-testid={`reject-row-${r.sourceRow}`}>
              <td>{r.sourceRow}</td>
              <td>{r.reason}</td>
              <td>{r.ruleId}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button data-testid="btn-next-page" onClick={() => setPage((p) => p + 1)}>Next</button>
    </div>
  );
};