import React, { useState } from 'react';
import {
  exportProfileCsv,
  exportReconciliationCsv,
  exportRejectsCsv,
} from '../api/migration-kit.js';

export type ReportType = 'profile' | 'reject' | 'reconciliation';

export interface ReportDownloadProps {
  batchId: string;
  reportType: ReportType;
  label?: string | undefined;
  fileName?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  onSuccess?: (() => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
  dataTestId?: string | undefined;
}

/**
 * ReportDownload component (KIT-16)
 *
 * Provides a formula-safe CSV export button for Profiling, Rejection, and Reconciliation reports.
 * Triggers safe browser blob download with inert text encoding for spreadsheet tools.
 */
export const ReportDownload: React.FC<ReportDownloadProps> = ({
  batchId,
  reportType,
  label,
  fileName,
  disabled = false,
  className,
  onSuccess,
  onError,
  dataTestId,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const defaultLabel =
    label ??
    (reportType === 'profile'
      ? 'Export Profile CSV'
      : reportType === 'reject'
        ? 'Export Rejection CSV'
        : 'Export Reconciliation CSV');

  const defaultFileName =
    fileName ?? `${reportType}-report-${batchId}.csv`;

  const handleDownload = async () => {
    if (!batchId || isExporting || disabled) return;

    setIsExporting(true);
    setErrorMessage(null);

    try {
      let csvContent: string;
      if (reportType === 'profile') {
        csvContent = await exportProfileCsv(batchId);
      } else if (reportType === 'reject') {
        csvContent = await exportRejectsCsv(batchId);
      } else if (reportType === 'reconciliation') {
        csvContent = await exportReconciliationCsv(batchId);
      } else {
        throw new Error(`Unsupported report type: ${reportType}`);
      }

      // Generate formula-safe UTF-8 CSV Blob
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', defaultFileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      onSuccess?.();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setErrorMessage(error.message);
      onError?.(error);
    } finally {
      setIsExporting(false);
    }
  };

  const testId = dataTestId ?? `btn-download-${reportType}-csv`;

  return (
    <div className={`report-download-container ${className ?? ''}`.trim()}>
      <button
        type="button"
        data-testid={testId}
        onClick={handleDownload}
        disabled={disabled || isExporting || !batchId}
        aria-busy={isExporting}
        aria-label={defaultLabel}
        className="report-download-btn"
      >
        {isExporting ? 'Generating CSV...' : defaultLabel}
      </button>
      {errorMessage && (
        <span
          role="alert"
          data-testid={`${testId}-error`}
          className="report-download-error"
          style={{ color: '#d32f2f', marginLeft: '8px', fontSize: '0.875rem' }}
        >
          {errorMessage}
        </span>
      )}
    </div>
  );
};
