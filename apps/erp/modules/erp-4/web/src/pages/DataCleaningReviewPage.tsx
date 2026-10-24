/**
 * ERP-4 Finance & Accounting — Data Cleaning & Field Audit Review Page (ERP4-27 / KIT-04)
 *
 * Dedicated UI screen for inspecting cleaned migration data, field-level audit trail,
 * rule toggle execution (FR-CL-05), and formula-safe CSV audit export.
 *
 * @module erp4/web/pages/DataCleaningReviewPage
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { DatasetCleanResult, FieldChangeAudit, RowCleanResult } from '@cs/kit';
import { V1_CLEANING_RULES } from '@cs/kit';
import { fetchCleanedData, downloadCleanAuditCsv } from '../api/erp-4.js';

export interface DataCleaningReviewPageProps {
  initialReport?: DatasetCleanResult | null;
  onBack?: () => void;
  onProceedToMapping?: () => void;
}

export const DataCleaningReviewPage: React.FC<DataCleaningReviewPageProps> = ({
  initialReport,
  onBack,
  onProceedToMapping,
}) => {
  const [report, setReport] = useState<DatasetCleanResult | null>(initialReport ?? null);
  const [loading, setLoading] = useState<boolean>(!initialReport);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'audits' | 'rows' | 'rules'>('audits');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [enabledRules, setEnabledRules] = useState<Set<string>>(
    new Set(initialReport?.enabledRuleIds ?? V1_CLEANING_RULES.map((r) => r.ruleId))
  );

  useEffect(() => {
    if (!initialReport) {
      loadData();
    }
  }, [initialReport]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCleanedData();
      setReport(data);
      if (data?.enabledRuleIds) {
        setEnabledRules(new Set(data.enabledRuleIds));
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load cleaning report');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const csv = await downloadCleanAuditCsv();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'erp4-field-clean-audit.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const toggleRule = (ruleId: string) => {
    const next = new Set(enabledRules);
    if (next.has(ruleId)) {
      next.delete(ruleId);
    } else {
      next.add(ruleId);
    }
    setEnabledRules(next);
  };

  // Filtered audits
  const filteredAudits = useMemo(() => {
    if (!report?.audits) return [];
    return report.audits.filter((audit) => {
      const matchesSearch =
        !searchFilter ||
        String(audit.sourceRow).toLowerCase().includes(searchFilter.toLowerCase()) ||
        audit.fieldName.toLowerCase().includes(searchFilter.toLowerCase()) ||
        audit.ruleId.toLowerCase().includes(searchFilter.toLowerCase()) ||
        audit.originalValue.toLowerCase().includes(searchFilter.toLowerCase()) ||
        audit.cleanedValue.toLowerCase().includes(searchFilter.toLowerCase());
      return matchesSearch;
    });
  }, [report, searchFilter]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    if (!report?.rows) return [];
    return report.rows.filter((row) => {
      const matchesStatus = statusFilter === 'all' || row.outcome === statusFilter;
      const matchesSearch =
        !searchFilter ||
        String(row.sourceRow).toLowerCase().includes(searchFilter.toLowerCase()) ||
        JSON.stringify(row.cleanedData).toLowerCase().includes(searchFilter.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [report, statusFilter, searchFilter]);

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-600" data-testid="cleaning-loading-state">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4" />
        <p>Executing canonical cleaning rules and computing field-level audit trail...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 text-red-700 rounded-lg border border-red-200" data-testid="cleaning-error-state">
        <h3 className="font-semibold text-lg mb-2">Failed to load data cleaning report</h3>
        <p className="text-sm mb-4">{error}</p>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6" data-testid="data-cleaning-review-page">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                data-testid="back-button"
                className="text-slate-500 hover:text-slate-800 transition text-sm flex items-center gap-1 font-medium"
              >
                ← Back
              </button>
            )}
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Data Cleaning & Normalization Audit
            </h1>
            <span className="bg-indigo-100 text-indigo-800 text-xs font-semibold px-2.5 py-0.5 rounded border border-indigo-200">
              KIT-04 / Step 3
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Standard cleaners (whitespace trimming, proper case, email, date coercion, decimal stripping) with per-field change auditing (SDS §3.4 & §4.4).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCsv}
            data-testid="export-audit-csv-btn"
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-md text-sm font-medium hover:bg-slate-50 shadow-sm transition flex items-center gap-2"
          >
            <span>📥</span> Download Audit CSV (Safe)
          </button>
          {onProceedToMapping && (
            <button
              onClick={onProceedToMapping}
              data-testid="proceed-to-mapping-btn"
              className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 shadow-sm transition"
            >
              Proceed to Mapping (Step 4) →
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Rows Processed</p>
          <p className="text-2xl font-bold text-slate-900 mt-1" data-testid="kpi-total-rows">
            {report?.totalRows ?? 0}
          </p>
          <p className="text-xs text-slate-400 mt-1">Immutable source data preserved</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Cleaned Rows</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1" data-testid="kpi-cleaned-count">
            {report?.cleanedCount ?? 0}
          </p>
          <p className="text-xs text-slate-400 mt-1">Transformed to clean domain shape</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Field Change Audits</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1" data-testid="kpi-audit-count">
            {report?.auditCount ?? 0}
          </p>
          <p className="text-xs text-slate-400 mt-1">Per-field old → new trace records</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Rejected Rows</p>
          <p className="text-2xl font-bold text-amber-600 mt-1" data-testid="kpi-rejected-count">
            {report?.rejectedCount ?? 0}
          </p>
          <p className="text-xs text-slate-400 mt-1">Required field anomalies rejected</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-8" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('audits')}
            data-testid="tab-audits"
            className={`py-3 px-1 border-b-2 font-medium text-sm transition ${
              activeTab === 'audits'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Field-Level Change Audit Log ({report?.auditCount ?? 0})
          </button>
          <button
            onClick={() => setActiveTab('rows')}
            data-testid="tab-rows"
            className={`py-3 px-1 border-b-2 font-medium text-sm transition ${
              activeTab === 'rows'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Transformed Row Previews ({report?.totalRows ?? 0})
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            data-testid="tab-rules"
            className={`py-3 px-1 border-b-2 font-medium text-sm transition ${
              activeTab === 'rules'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            V1 Rule Configuration ({V1_CLEANING_RULES.length})
          </button>
        </nav>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
        <div className="w-full sm:w-72">
          <input
            type="text"
            placeholder="Search by row, field, or value..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            data-testid="cleaning-search-input"
            className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {activeTab === 'rows' && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-xs font-medium text-slate-500">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              data-testid="status-filter-select"
              className="text-sm bg-white border border-slate-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Outcomes</option>
              <option value="cleaned">Cleaned</option>
              <option value="new">New (Unmodified)</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        )}
      </div>

      {/* Tab 1: Field Change Audit Table */}
      {activeTab === 'audits' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm" data-testid="audits-table-container">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Source Row</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Field Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Original Value</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Cleaned Value</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Rule ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAudits.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No field modification audits matching the criteria.
                    </td>
                  </tr>
                ) : (
                  filteredAudits.map((audit: FieldChangeAudit, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50 transition" data-testid={`audit-row-${idx}`}>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{audit.sourceRow}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{audit.fieldName}</td>
                      <td className="px-4 py-2.5 text-red-700 bg-red-50/50 font-mono text-xs max-w-xs truncate">
                        "{audit.originalValue}"
                      </td>
                      <td className="px-4 py-2.5 text-emerald-700 bg-emerald-50/50 font-mono text-xs max-w-xs truncate">
                        "{audit.cleanedValue}"
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
                          {audit.ruleId}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Row Previews Table */}
      {activeTab === 'rows' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm" data-testid="rows-table-container">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Source Row</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Outcome</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Record Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Audits</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Preview (Code / Name / Amount)</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Rejections / Reasons</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No rows matching current filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row: RowCleanResult, idx: number) => {
                    const badgeClass =
                      row.outcome === 'cleaned'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        : row.outcome === 'rejected'
                        ? 'bg-amber-100 text-amber-800 border-amber-200'
                        : 'bg-slate-100 text-slate-800 border-slate-200';

                    return (
                      <tr key={idx} className="hover:bg-slate-50 transition" data-testid={`data-row-${idx}`}>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{row.sourceRow}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold border ${badgeClass}`}>
                            {row.outcome.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 capitalize">
                          {String(row.cleanedData['record_type'] || '—')}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 font-mono">
                          {row.audits.length > 0 ? `${row.audits.length} change(s)` : '0'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-800">
                          {String(row.cleanedData['code'] || row.cleanedData['entry_number'] || '—')}{' '}
                          {row.cleanedData['name'] ? `(${String(row.cleanedData['name'])})` : ''}{' '}
                          {row.cleanedData['balance_amount'] ? `[Amt: ${String(row.cleanedData['balance_amount'])}]` : ''}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-amber-700">
                          {row.rejections.length > 0 ? (
                            <span className="font-medium">
                              {row.rejections.map((r) => r.reasonCode).join(', ')}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Rule Configuration (FR-CL-05) */}
      {activeTab === 'rules' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4" data-testid="rules-container">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-base font-semibold text-slate-900">V1 Cleaning Rule Registry</h3>
            <p className="text-xs text-slate-500">
              Per FR-CL-05, operators can selectively toggle cleaning rules for batch execution.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {V1_CLEANING_RULES.map((rule) => {
              const isEnabled = enabledRules.has(rule.ruleId);
              return (
                <div
                  key={rule.ruleId}
                  className={`p-4 rounded-lg border transition flex items-start gap-3 ${
                    isEnabled ? 'bg-slate-50 border-slate-300' : 'bg-slate-100/50 border-slate-200 opacity-60'
                  }`}
                  data-testid={`rule-card-${rule.ruleId}`}
                >
                  <input
                    type="checkbox"
                    id={`toggle-${rule.ruleId}`}
                    checked={isEnabled}
                    onChange={() => toggleRule(rule.ruleId)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <label
                      htmlFor={`toggle-${rule.ruleId}`}
                      className="text-sm font-semibold text-slate-800 cursor-pointer flex items-center gap-2"
                    >
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-white border border-slate-200">
                        {rule.ruleId}
                      </span>
                      {rule.name}
                    </label>
                    <p className="text-xs text-slate-500 mt-1">{rule.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
