import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchProfile, type ProfileReport } from '../api/migration-kit.js';
import { SkeletonTable, EmptyState, ErrorState } from '@cs/ui';

export const ProfileReportPage: React.FC = () => {
  const { batchId } = useParams();
  const [report, setReport] = useState<ProfileReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchProfile(batchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [batchId]);

  if (loading) return <div data-testid="profile-loading"><SkeletonTable columns={4} rows={4} /></div>;
  if (error || !report) return <ErrorState title="Unable to load profile" message={error || 'No report'} onRetry={load} />;
  if (report.columns.length === 0) return <EmptyState title="No columns" />;

  return (
    <div data-testid="profile-report-page">
      <h1>Profile Report</h1>
      <p data-testid="total-rows">Total rows: {report.totalRows}</p>
      <p data-testid="duplicate-count">Duplicates: {report.duplicateCount}</p>
      <table data-testid="profile-columns">
        <tbody>
          {report.columns.map((c) => (
            <tr key={c.name} data-testid={`column-${c.name}`}>
              <td>{c.name}</td>
              <td>{c.inferredType}</td>
              <td>{c.emptyCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};