import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchMapping, saveMapping, type MappingRule } from '../api/migration-kit.js';
import { SkeletonTable, EmptyState, ErrorState } from '@cs/ui';

export const MappingRulesPage: React.FC = () => {
  const { batchId } = useParams();
  const [rules, setRules] = useState<MappingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      setRules([...(await fetchMapping(batchId))]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mapping');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [batchId]);

  const handleSave = async () => {
    if (!batchId) return;
    await saveMapping(batchId, rules);
  };

  if (loading) return <div data-testid="mapping-loading"><SkeletonTable columns={4} rows={4} /></div>;
  if (error) return <ErrorState title="Unable to load mapping" message={error} onRetry={load} />;
  if (rules.length === 0) return <EmptyState title="No mapping rules" />;

  return (
    <div data-testid="mapping-rules-page">
      <h1>Mapping & Rules</h1>
      <table data-testid="mapping-table">
        <tbody>
          {rules.map((r) => (
            <tr key={r.targetField} data-testid={`mapping-row-${r.targetField}`}>
              <td>{r.targetField}</td>
              <td>{r.sourceColumn ?? 'unmapped'}</td>
              <td>{r.required ? 'required' : 'optional'}</td>
              <td>{r.compatible ? 'compatible' : 'incompatible'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button data-testid="btn-save-mapping" onClick={handleSave}>Save Mapping</button>
    </div>
  );
};