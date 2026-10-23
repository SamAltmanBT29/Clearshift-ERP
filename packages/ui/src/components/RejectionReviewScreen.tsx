import React, { useState, useMemo } from 'react';
import {
  RejectedRow,
  ModuleRejectionContext,
  maskRejectedRow,
  resolveFailureExplanation,
  exportRejectedRowsCsv,
  isSensitiveField,
} from '@cs/kit';
import { Alert } from './Alert.js';

export interface RejectionReviewScreenProps {
  context: ModuleRejectionContext;
  rejectedRows: readonly RejectedRow[];
  batchId?: string | undefined;
  title?: string | undefined;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
  onRetryRow?: ((rowId: string) => void) | undefined;
  onRetryAll?: ((rowIds: string[]) => void) | undefined;
  className?: string | undefined;
}

export const RejectionReviewScreen: React.FC<RejectionReviewScreenProps> = ({
  context,
  rejectedRows,
  batchId = 'batch_current',
  title,
  subtitle,
  onBack,
  onRetryRow,
  onRetryAll,
  className = '',
}) => {
  const [selectedErrorCode, setSelectedErrorCode] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inspectedRow, setInspectedRow] = useState<RejectedRow | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Extract unique error codes present in the rejected rows
  const availableErrorCodes = useMemo(() => {
    const set = new Set<string>();
    for (const row of rejectedRows) {
      if (row.errorCode) {
        set.add(row.errorCode);
      }
    }
    return Array.from(set).sort();
  }, [rejectedRows]);

  // Filter rows based on search query and selected error code
  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return rejectedRows.filter((row) => {
      // Error code filter
      if (selectedErrorCode !== 'all' && row.errorCode !== selectedErrorCode) {
        return false;
      }

      // Search query filter
      if (query) {
        const matchesCode = row.errorCode.toLowerCase().includes(query);
        const explanation = resolveFailureExplanation(context, row.errorCode, row.failureReason);
        const matchesExplanation =
          explanation.title.toLowerCase().includes(query) ||
          explanation.explanation.toLowerCase().includes(query);
        const matchesField = row.field ? row.field.toLowerCase().includes(query) : false;

        // Check identifier fields
        let matchesIdentifier = false;
        for (const idCol of context.identifierColumns) {
          const val = row.rawData[idCol.field];
          if (val !== undefined && val !== null) {
            if (String(val).toLowerCase().includes(query)) {
              matchesIdentifier = true;
              break;
            }
          }
        }

        return matchesCode || matchesExplanation || matchesField || matchesIdentifier;
      }

      return true;
    });
  }, [rejectedRows, selectedErrorCode, searchQuery, context]);

  // Handle CSV export of filtered rejected rows
  const handleExportCsv = async () => {
    try {
      setIsExporting(true);
      const csvContent = exportRejectedRowsCsv(filteredRows, context);

      if (typeof window !== 'undefined' && window.document) {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute(
          'download',
          `${context.moduleId}-${context.entity}-rejections-${batchId}.csv`
        );
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleClearFilters = () => {
    setSelectedErrorCode('all');
    setSearchQuery('');
  };

  const displayTitle = title || `${context.moduleName}: Migration Rejection Review`;
  const displaySubtitle =
    subtitle ||
    `Reviewing ${rejectedRows.length} rejected records in batch ${batchId}. All sensitive fields are masked.`;

  return (
    <div
      className={`cs-rejection-review-screen ${className}`}
      data-testid="rejection-review-screen"
      style={{
        padding: '1.5rem',
        maxWidth: '1440px',
        margin: '0 auto',
        color: 'var(--cs-text, #1e293b)',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header bar */}
      <div
        className="cs-rejection-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                data-testid="btn-back-to-import"
                className="cs-btn-back"
                style={{
                  background: 'none',
                  border: '1px solid var(--cs-border, #e2e8f0)',
                  borderRadius: '6px',
                  padding: '0.4rem 0.75rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--cs-text, #1e293b)',
                }}
              >
                ← Back
              </button>
            )}
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                margin: 0,
                letterSpacing: '-0.025em',
              }}
            >
              {displayTitle}
            </h1>
            <span
              className="cs-badge-batch"
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                background: 'rgba(59, 130, 246, 0.1)',
                color: '#2563eb',
                padding: '0.2rem 0.5rem',
                borderRadius: '9999px',
                border: '1px solid rgba(59, 130, 246, 0.2)',
              }}
            >
              Batch: {batchId}
            </span>
          </div>
          <p style={{ margin: 0, color: 'var(--cs-text-muted, #64748b)', fontSize: '0.875rem' }}>
            {displaySubtitle}
          </p>
        </div>

        {/* Action controls */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {onRetryAll && (
            <button
              type="button"
              onClick={() => onRetryAll(filteredRows.map((r) => r.id))}
              disabled={filteredRows.length === 0}
              data-testid="btn-retry-all"
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--cs-border, #e2e8f0)',
                background: 'var(--cs-surface, #ffffff)',
                color: 'var(--cs-text, #1e293b)',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: filteredRows.length === 0 ? 'not-allowed' : 'pointer',
                opacity: filteredRows.length === 0 ? 0.6 : 1,
              }}
            >
              🔄 Retry All Filtered ({filteredRows.length})
            </button>
          )}

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={isExporting || filteredRows.length === 0}
            data-testid="btn-export-rejections"
            aria-label="Export Rejected Rows to CSV"
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              background: '#0284c7',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: isExporting || filteredRows.length === 0 ? 'not-allowed' : 'pointer',
              opacity: isExporting || filteredRows.length === 0 ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>📥</span>
            <span>{isExporting ? 'Exporting...' : `Export Filtered CSV (${filteredRows.length})`}</span>
          </button>
        </div>
      </div>

      {/* Info notice about sensitive field masking */}
      <div style={{ marginBottom: '1.25rem' }}>
        <Alert
          variant="info"
          id="alert-rejections-privacy-notice"
          data-testid="privacy-masking-notice"
          title="Privacy & Data Protection Notice"
        >
          All sensitive financial, bank, and employee fields (such as bank accounts, tax IDs, salaries,
          and credentials) are automatically masked across all review screens and CSV exports in
          compliance with Gate G4 security standards.
        </Alert>
      </div>

      {/* Filter and Search Bar */}
      <div
        className="cs-rejection-filters"
        style={{
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          flexWrap: 'wrap',
          background: 'var(--cs-surface, #f8fafc)',
          padding: '1rem',
          borderRadius: '8px',
          border: '1px solid var(--cs-border, #e2e8f0)',
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ flex: '1 1 250px' }}>
          <label
            htmlFor="rejection-search-input"
            style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem' }}
          >
            Search by Identifier or Reason
          </label>
          <input
            id="rejection-search-input"
            data-testid="input-rejections-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search SKU, name, error code, or message..."
            style={{
              width: '100%',
              padding: '0.45rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--cs-border, #cbd5e1)',
              fontSize: '0.875rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ flex: '0 1 240px' }}>
          <label
            htmlFor="rejection-error-code-select"
            style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem' }}
          >
            Filter by Error Code
          </label>
          <select
            id="rejection-error-code-select"
            data-testid="select-error-code-filter"
            value={selectedErrorCode}
            onChange={(e) => setSelectedErrorCode(e.target.value)}
            style={{
              width: '100%',
              padding: '0.45rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--cs-border, #cbd5e1)',
              fontSize: '0.875rem',
              background: '#ffffff',
            }}
          >
            <option value="all">All Error Codes ({rejectedRows.length})</option>
            {availableErrorCodes.map((code) => {
              const count = rejectedRows.filter((r) => r.errorCode === code).length;
              return (
                <option key={code} value={code}>
                  {code} ({count})
                </option>
              );
            })}
          </select>
        </div>

        {(searchQuery || selectedErrorCode !== 'all') && (
          <div style={{ alignSelf: 'flex-end' }}>
            <button
              type="button"
              onClick={handleClearFilters}
              data-testid="btn-clear-filters"
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--cs-border, #cbd5e1)',
                background: '#ffffff',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: '#64748b',
              }}
            >
              Clear Filters
            </button>
          </div>
        )}

        <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: '0.875rem', color: '#64748b' }}>
          Showing <strong>{filteredRows.length}</strong> of <strong>{rejectedRows.length}</strong> rows
        </div>
      </div>

      {/* Main Rejected Rows Table */}
      {filteredRows.length === 0 ? (
        <div
          data-testid="rejections-empty-state"
          style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            background: 'var(--cs-surface, #f8fafc)',
            borderRadius: '8px',
            border: '1px dashed var(--cs-border, #cbd5e1)',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✨</div>
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.125rem', fontWeight: 600 }}>
            No matching rejected records
          </h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.875rem' }}>
            {rejectedRows.length === 0
              ? 'Zero rows were rejected during this migration batch. All records processed cleanly!'
              : 'No rejections match your active filters. Try clearing your search query or error code filter.'}
          </p>
        </div>
      ) : (
        <div
          className="cs-table-container"
          style={{
            overflowX: 'auto',
            borderRadius: '8px',
            border: '1px solid var(--cs-border, #e2e8f0)',
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '0.875rem',
            }}
          >
            <thead>
              <tr
                style={{
                  background: '#f8fafc',
                  borderBottom: '1px solid var(--cs-border, #e2e8f0)',
                }}
              >
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569', width: '60px' }}>
                  #
                </th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569', minWidth: '160px' }}>
                  Standard Error Code
                </th>

                {/* Module-specific identifier columns */}
                {context.identifierColumns.map((col) => (
                  <th
                    key={col.field}
                    style={{
                      padding: '0.75rem 1rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      minWidth: '130px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span>{col.label}</span>
                      {col.isIdentifier && (
                        <span
                          title="Module Primary Natural Identifier"
                          style={{
                            fontSize: '0.625rem',
                            fontWeight: 700,
                            background: '#dbeafe',
                            color: '#1d4ed8',
                            padding: '0.1rem 0.35rem',
                            borderRadius: '4px',
                            textTransform: 'uppercase',
                          }}
                        >
                          ID
                        </span>
                      )}
                    </div>
                  </th>
                ))}

                {/* Additional context columns */}
                {context.additionalColumns?.map((col) => (
                  <th
                    key={col.field}
                    style={{
                      padding: '0.75rem 1rem',
                      fontWeight: 600,
                      color: '#475569',
                      minWidth: '110px',
                    }}
                  >
                    {col.label}
                  </th>
                ))}

                <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569', minWidth: '280px' }}>
                  Failure Reason & Remediation
                </th>

                <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569', width: '130px' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((rawRow, idx) => {
                // Ensure sensitive fields in rawData are masked before display
                const row = maskRejectedRow(rawRow, context.sensitiveFields);
                const explanation = resolveFailureExplanation(context, row.errorCode, row.failureReason);

                return (
                  <tr
                    key={row.id}
                    data-testid={`rejection-row-${row.id}`}
                    style={{
                      borderBottom: '1px solid var(--cs-border, #f1f5f9)',
                      background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                    }}
                  >
                    {/* Source Row # */}
                    <td style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 500 }}>
                      {row.sourceRow}
                    </td>

                    {/* Standardized Error Code */}
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span
                        data-testid="error-code-badge"
                        style={{
                          display: 'inline-block',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '0.2rem 0.5rem',
                          borderRadius: '6px',
                          background: '#fef2f2',
                          color: '#b91c1c',
                          border: '1px solid #fecaca',
                          fontFamily: 'monospace',
                        }}
                      >
                        {row.errorCode}
                      </span>
                      {row.field && (
                        <div
                          style={{
                            fontSize: '0.7rem',
                            color: '#64748b',
                            marginTop: '0.25rem',
                            fontFamily: 'monospace',
                          }}
                        >
                          Field: {row.field}
                        </div>
                      )}
                    </td>

                    {/* Module Identifier Columns */}
                    {context.identifierColumns.map((col) => {
                      const val = row.rawData[col.field];
                      const formatted = col.format ? col.format(val, row) : (val !== undefined && val !== null ? String(val) : '—');
                      const sensitive = isSensitiveField(col.field, context.sensitiveFields);

                      return (
                        <td
                          key={col.field}
                          data-testid={`cell-identifier-${col.field}`}
                          style={{
                            padding: '0.75rem 1rem',
                            fontWeight: col.isIdentifier ? 600 : 400,
                            color: col.isIdentifier ? '#0f172a' : '#334155',
                          }}
                        >
                          {sensitive ? (
                            <span data-testid="masked-field-badge" style={{ color: '#94a3b8' }}>
                              🔒 {formatted}
                            </span>
                          ) : (
                            formatted
                          )}
                        </td>
                      );
                    })}

                    {/* Additional columns */}
                    {context.additionalColumns?.map((col) => {
                      const val = row.rawData[col.field];
                      const formatted = col.format ? col.format(val, row) : (val !== undefined && val !== null ? String(val) : '—');
                      const sensitive = isSensitiveField(col.field, context.sensitiveFields);

                      return (
                        <td key={col.field} style={{ padding: '0.75rem 1rem', color: '#475569' }}>
                          {sensitive ? (
                            <span data-testid="masked-field-badge" style={{ color: '#94a3b8' }}>
                              🔒 {formatted}
                            </span>
                          ) : (
                            formatted
                          )}
                        </td>
                      );
                    })}

                    {/* Failure Explanation & Resolution */}
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div
                        data-testid="failure-reason-text"
                        style={{ fontWeight: 600, color: '#991b1b', marginBottom: '0.25rem' }}
                      >
                        {explanation.title}
                      </div>
                      <div
                        style={{
                          fontSize: '0.8125rem',
                          color: '#334155',
                          lineHeight: 1.4,
                          marginBottom: '0.35rem',
                        }}
                      >
                        {explanation.explanation}
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {explanation.docReference && (
                          <span
                            data-testid="doc-reference-badge"
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: 600,
                              background: '#f1f5f9',
                              color: '#475569',
                              padding: '0.1rem 0.35rem',
                              borderRadius: '4px',
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            Ref: {explanation.docReference}
                          </span>
                        )}

                        {explanation.resolution && (
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: '#0369a1',
                              fontStyle: 'italic',
                            }}
                          >
                            💡 {explanation.resolution}
                          </span>
                        )}
                      </div>

                      {/* Contextual links */}
                      {context.contextualLinks && context.contextualLinks.length > 0 && (
                        <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.75rem' }}>
                          {context.contextualLinks.map((link) => (
                            <a
                              key={link.label}
                              href={link.getUrl(row)}
                              target={link.openInNewTab ? '_blank' : '_self'}
                              rel={link.openInNewTab ? 'noopener noreferrer' : undefined}
                              data-testid="contextual-link"
                              style={{
                                fontSize: '0.75rem',
                                color: '#2563eb',
                                textDecoration: 'none',
                                fontWeight: 500,
                              }}
                            >
                              🔗 {link.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => setInspectedRow(row)}
                          data-testid={`btn-inspect-row-${row.id}`}
                          aria-label={`Inspect row ${row.sourceRow}`}
                          style={{
                            padding: '0.35rem 0.65rem',
                            borderRadius: '4px',
                            border: '1px solid var(--cs-border, #cbd5e1)',
                            background: '#ffffff',
                            color: '#334155',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          👁️ Inspect
                        </button>

                        {onRetryRow && (
                          <button
                            type="button"
                            onClick={() => onRetryRow(row.id)}
                            data-testid={`btn-retry-row-${row.id}`}
                            aria-label={`Retry row ${row.sourceRow}`}
                            style={{
                              padding: '0.35rem 0.65rem',
                              borderRadius: '4px',
                              border: '1px solid #93c5fd',
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            🔄 Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Row inspection modal / drawer */}
      {inspectedRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspect-dialog-title"
          data-testid="row-inspect-drawer"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '8px',
              maxWidth: '650px',
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h3 id="inspect-dialog-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
                  Row #{inspectedRow.sourceRow} Payload Inspection
                </h3>
                <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '0.2rem' }}>
                  Standard Error Code:{' '}
                  <span style={{ fontWeight: 700, color: '#dc2626', fontFamily: 'monospace' }}>
                    {inspectedRow.errorCode}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectedRow(null)}
                data-testid="btn-close-inspect"
                aria-label="Close Inspection Modal"
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  color: '#64748b',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem' }}>
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '1rem',
                  marginBottom: '1rem',
                }}
              >
                <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: '0.25rem' }}>
                  Failure Reason
                </div>
                <div style={{ fontSize: '0.875rem', color: '#334155' }}>
                  {resolveFailureExplanation(context, inspectedRow.errorCode, inspectedRow.failureReason).explanation}
                </div>
              </div>

              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.875rem', fontWeight: 600, color: '#475569' }}>
                Source Raw Fields (Sensitive Fields Masked)
              </h4>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: '0.5rem',
                  fontFamily: 'monospace',
                  fontSize: '0.8125rem',
                }}
              >
                {Object.entries(inspectedRow.rawData || {}).map(([key, val]) => {
                  const sensitive = isSensitiveField(key, context.sensitiveFields);
                  return (
                    <div
                      key={key}
                      data-testid={`inspect-field-${key}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '0.4rem 0.6rem',
                        background: sensitive ? '#fffbeb' : '#f8fafc',
                        borderRadius: '4px',
                        border: sensitive ? '1px solid #fef3c7' : '1px solid #f1f5f9',
                      }}
                    >
                      <span style={{ color: '#475569', fontWeight: 600 }}>{key}:</span>
                      <span style={{ color: sensitive ? '#b45309' : '#0f172a' }}>
                        {val !== undefined && val !== null ? String(val) : 'null'}
                        {sensitive && (
                          <span
                            data-testid="inspect-masked-indicator"
                            style={{
                              marginLeft: '0.5rem',
                              fontSize: '0.6875rem',
                              background: '#fde68a',
                              color: '#92400e',
                              padding: '0.1rem 0.3rem',
                              borderRadius: '3px',
                            }}
                          >
                            🔒 MASKED
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                padding: '1rem 1.5rem',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                onClick={() => setInspectedRow(null)}
                style={{
                  padding: '0.45rem 1rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
