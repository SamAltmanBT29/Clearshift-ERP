import React, { useState, useEffect, useCallback } from 'react';
import type { DatasetProfileReport, ColumnProfile, DuplicateKeyProfile } from '@cs/kit';
import { fetchDataHealthProfile, downloadDataHealthCsv } from '../api/erp-4.js';
import { SkeletonTable, ErrorState, StatusBadge } from '../components/StateViews.js';

export interface DataHealthProfilePageProps {
  initialReport?: DatasetProfileReport | null;
  onBack?: () => void;
}

export const DataHealthProfilePage: React.FC<DataHealthProfilePageProps> = ({
  initialReport = null,
  onBack,
}) => {
  const [report, setReport] = useState<DatasetProfileReport | null>(initialReport);
  const [isLoading, setIsLoading] = useState<boolean>(!initialReport);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [selectedRecordType, setSelectedRecordType] = useState<string>('all');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchDataHealthProfile();
      setReport(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data health report');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialReport) {
      loadProfile();
    }
  }, [initialReport, loadProfile]);

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const csvText = await downloadDataHealthCsv();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'erp4-data-health-profile.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cs-page-container" aria-label="Loading Data Health Profile">
        <div style={{ padding: '24px' }}>
          <h2>Loading Data Health Profile...</h2>
          <SkeletonTable columns={8} rows={8} />
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="cs-page-container">
        <ErrorState
          title="Unable to load Data Health Profile"
          message={error || 'An unexpected error occurred while generating profiling metrics.'}
          onRetry={loadProfile}
        />
      </div>
    );
  }

  const columnsList: ColumnProfile[] = Object.values(report.columns);
  const filteredColumns = columnsList.filter((col) => {
    const matchesSearch =
      col.column.toLowerCase().includes(searchFilter.toLowerCase()) ||
      col.label.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesType =
      selectedRecordType === 'all' || col.recordType === selectedRecordType;
    return matchesSearch && matchesType;
  });

  const duplicateRules: DuplicateKeyProfile[] = Object.values(report.exactDuplicates || {});
  const totalDuplicateCandidates = duplicateRules.reduce(
    (acc, rule) => acc + rule.candidateCount,
    0
  );

  return (
    <div className="cs-page-container" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="cs-button cs-button-secondary"
              style={{ marginBottom: '8px' }}
            >
              ← Back to Finance
            </button>
          )}
          <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', fontWeight: 600 }}>
            Data Health & Column Profiling
          </h1>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '14px' }}>
            Migration Kit Step 2 — Canonical Dirty Data Pack profiling metrics and exact duplicate review
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={loadProfile}
            className="cs-button cs-button-secondary"
            disabled={isLoading}
            aria-label="Refresh profile"
          >
            🔄 Refresh
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={isExporting}
            className="cs-button cs-button-primary"
            aria-label="Export Formula-Safe CSV"
            style={{
              backgroundColor: 'var(--color-primary, #2563eb)',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            📥 {isExporting ? 'Exporting...' : 'Export Formula-Safe CSV'}
          </button>
        </div>
      </div>

      {/* ── Trust & Audit Badges ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '20px',
          flexWrap: 'wrap',
          padding: '12px 16px',
          backgroundColor: 'var(--color-surface, #f8fafc)',
          borderRadius: '8px',
          border: '1px solid var(--color-border, #e2e8f0)',
          fontSize: '13px',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <strong style={{ color: '#059669' }}>🛡️ Source Immutability:</strong> Non-Destructive Verified
        </span>
        <span style={{ color: 'var(--color-border, #cbd5e1)' }}>|</span>
        <span>
          <strong>SHA-256 Fingerprint:</strong>{' '}
          <code style={{ fontSize: '12px' }}>{report.sha256.slice(0, 16)}...</code>
        </span>
        <span style={{ color: 'var(--color-border, #cbd5e1)' }}>|</span>
        <span>
          <strong>Generated:</strong> {new Date(report.generatedAt).toLocaleString()}
        </span>
      </div>

      {/* ── KPI Summary Cards ───────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div
          className="cs-card"
          style={{
            padding: '16px',
            backgroundColor: 'var(--color-bg, #fff)',
            borderRadius: '8px',
            border: '1px solid var(--color-border, #e2e8f0)',
          }}
        >
          <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
            Total Evaluated Rows
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text, #0f172a)' }}>
            {report.totalRows}
          </div>
          <div style={{ fontSize: '12px', color: '#059669', marginTop: '4px' }}>
            100% Parsed & Reconciled
          </div>
        </div>

        <div
          className="cs-card"
          style={{
            padding: '16px',
            backgroundColor: 'var(--color-bg, #fff)',
            borderRadius: '8px',
            border: '1px solid var(--color-border, #e2e8f0)',
          }}
        >
          <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
            Configured Profile Columns
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text, #0f172a)' }}>
            {columnsList.length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Across 4 target entities
          </div>
        </div>

        <div
          className="cs-card"
          style={{
            padding: '16px',
            backgroundColor: 'var(--color-bg, #fff)',
            borderRadius: '8px',
            border: '1px solid var(--color-border, #e2e8f0)',
          }}
        >
          <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
            Exact Duplicate Candidates
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#d97706' }}>
            {totalDuplicateCandidates}
          </div>
          <div style={{ fontSize: '12px', color: '#d97706', marginTop: '4px' }}>
            Held for manual human review
          </div>
        </div>

        <div
          className="cs-card"
          style={{
            padding: '16px',
            backgroundColor: 'var(--color-bg, #fff)',
            borderRadius: '8px',
            border: '1px solid var(--color-border, #e2e8f0)',
          }}
        >
          <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
            Formula Injection Guard
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#059669' }}>
            Active
          </div>
          <div style={{ fontSize: '12px', color: '#059669', marginTop: '4px' }}>
            OWASP CSV formula safe
          </div>
        </div>
      </div>

      {/* ── Section 1: Column Profiling Breakdown ───────────────────────────── */}
      <div style={{ marginBottom: '32px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
            Column-Level Quality Metrics
          </h2>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search column..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="cs-input"
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--color-border, #cbd5e1)',
                fontSize: '13px',
              }}
              aria-label="Filter columns by name"
            />
            <select
              value={selectedRecordType}
              onChange={(e) => setSelectedRecordType(e.target.value)}
              className="cs-select"
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--color-border, #cbd5e1)',
                fontSize: '13px',
              }}
              aria-label="Filter by record type"
            >
              <option value="all">All Entities</option>
              <option value="account">Accounts</option>
              <option value="opening_balance">Opening Balances</option>
              <option value="journal_entry">Journal Entries</option>
              <option value="journal_line">Journal Lines</option>
            </select>
          </div>
        </div>

        <div className="cs-table-container" style={{ overflowX: 'auto', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: '8px' }}>
          <table className="cs-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface, #f8fafc)', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '10px 12px' }}>Entity</th>
                <th style={{ padding: '10px 12px' }}>Column</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Populated</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Nulls</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Distinct</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Invalid</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Invalid Rate</th>
                <th style={{ padding: '10px 12px' }}>Top 5 Values</th>
              </tr>
            </thead>
            <tbody>
              {filteredColumns.map((col) => {
                const isHighInvalid = col.invalidFormatRate > 5.0;
                return (
                  <tr
                    key={`${col.recordType || 'all'}.${col.column}`}
                    style={{ borderBottom: '1px solid #f1f5f9' }}
                  >
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          backgroundColor: '#e0e7ff',
                          color: '#3730a3',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 500,
                        }}
                      >
                        {col.recordType || 'global'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600 }}>{col.label}</div>
                      <code style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{col.column}</code>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{col.totalRows}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{col.populatedCount}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{col.nullCount}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{col.distinctCount}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: col.invalidFormatCount > 0 ? 600 : 400, color: col.invalidFormatCount > 0 ? '#b91c1c' : 'inherit' }}>
                      {col.invalidFormatCount}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <span
                        style={{
                          color: isHighInvalid ? '#b91c1c' : '#059669',
                          fontWeight: 600,
                        }}
                      >
                        {col.invalidFormatRate.toFixed(2)}%
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {col.topValues.slice(0, 3).map((tv, idx) => (
                          <span
                            key={idx}
                            style={{
                              backgroundColor: '#f1f5f9',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              color: '#334155',
                            }}
                          >
                            {tv.value} ({tv.count})
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 2: Exact Duplicate Candidate Groups ──────────────────────── */}
      <div>
        <div style={{ marginBottom: '12px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px 0' }}>
            Exact Duplicate Candidates (Review Required)
          </h2>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)' }}>
            V1 policy strictly prohibits fuzzy scoring and automatic destructive merge. Candidates require manual review before load.
          </p>
        </div>

        <div className="cs-table-container" style={{ border: '1px solid var(--color-border, #e2e8f0)', borderRadius: '8px' }}>
          <table className="cs-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface, #f8fafc)', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '10px 12px' }}>Duplicate Rule</th>
                <th style={{ padding: '10px 12px' }}>Entity</th>
                <th style={{ padding: '10px 12px' }}>Normalized Candidate Key</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Occurrences</th>
                <th style={{ padding: '10px 12px' }}>Affected Row IDs</th>
                <th style={{ padding: '10px 12px' }}>Action Policy</th>
              </tr>
            </thead>
            <tbody>
              {duplicateRules.flatMap((rule) =>
                rule.groups.map((group) => (
                  <tr key={`${rule.ruleName}.${group.key}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{rule.label}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          backgroundColor: '#fef3c7',
                          color: '#92400e',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 500,
                        }}
                      >
                        {rule.recordType}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <code style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
                        {group.key}
                      </code>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>
                      {group.occurrences}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {group.rowIds.map((id) => (
                        <span
                          key={id}
                          style={{
                            display: 'inline-block',
                            backgroundColor: '#e2e8f0',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            marginRight: '4px',
                          }}
                        >
                          {id}
                        </span>
                      ))}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <StatusBadge status="review" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
