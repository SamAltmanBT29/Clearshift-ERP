// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportDownload } from '../src/components/ReportDownload.js';
import * as api from '../src/api/migration-kit.js';

describe('ReportDownload Component (KIT-16)', () => {
  let createObjectURLSpy: any;
  let revokeObjectURLSpy: any;

  beforeEach(() => {
    createObjectURLSpy = vi.fn().mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = vi.fn();
    window.URL.createObjectURL = createObjectURLSpy;
    window.URL.revokeObjectURL = revokeObjectURLSpy;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders default button labels based on reportType', () => {
    const { rerender } = render(<ReportDownload batchId="b-01" reportType="profile" />);
    expect(screen.getByTestId('btn-download-profile-csv').textContent).toContain('Export Profile CSV');

    rerender(<ReportDownload batchId="b-01" reportType="reject" />);
    expect(screen.getByTestId('btn-download-reject-csv').textContent).toContain('Export Rejection CSV');

    rerender(<ReportDownload batchId="b-01" reportType="reconciliation" />);
    expect(screen.getByTestId('btn-download-reconciliation-csv').textContent).toContain('Export Reconciliation CSV');
  });

  it('renders custom label and custom testId', () => {
    render(
      <ReportDownload
        batchId="b-01"
        reportType="reject"
        label="Download Custom Rejects"
        dataTestId="custom-reject-btn"
      />
    );
    const btn = screen.getByTestId('custom-reject-btn');
    expect(btn.textContent).toContain('Download Custom Rejects');
  });

  it('triggers profile report download and cleans up blob url', async () => {
    const exportProfileSpy = vi.spyOn(api, 'exportProfileCsv').mockResolvedValue(
      '# Profile Report\ncolumn_name,inferred_type\nsku,string\n'
    );
    const onSuccess = vi.fn();

    render(
      <ReportDownload
        batchId="b-01"
        reportType="profile"
        fileName="profile-custom.csv"
        onSuccess={onSuccess}
      />
    );

    const btn = screen.getByTestId('btn-download-profile-csv');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(exportProfileSpy).toHaveBeenCalledWith('b-01');
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('triggers rejection report download and cleans up blob url', async () => {
    const exportRejectsSpy = vi.spyOn(api, 'exportRejectsCsv').mockResolvedValue(
      '# Rejection Report\nsource_row,entity,reason_code,safe_message\n1,products,RULE_1,Error\n'
    );

    render(<ReportDownload batchId="b-02" reportType="reject" />);
    const btn = screen.getByTestId('btn-download-reject-csv');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(exportRejectsSpy).toHaveBeenCalledWith('b-02');
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalled();
    });
  });

  it('triggers reconciliation report download and cleans up blob url', async () => {
    const exportReconSpy = vi.spyOn(api, 'exportReconciliationCsv').mockResolvedValue(
      '# Reconciliation Report\nmetric,count,notes\nsource_count,100,Total\n'
    );

    render(<ReportDownload batchId="b-03" reportType="reconciliation" />);
    const btn = screen.getByTestId('btn-download-reconciliation-csv');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(exportReconSpy).toHaveBeenCalledWith('b-03');
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalled();
    });
  });

  it('displays error message when report generation fails', async () => {
    vi.spyOn(api, 'exportProfileCsv').mockRejectedValue(new Error('Network failure'));
    const onError = vi.fn();

    render(
      <ReportDownload
        batchId="b-fail"
        reportType="profile"
        onError={onError}
      />
    );

    const btn = screen.getByTestId('btn-download-profile-csv');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Network failure');
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  it('respects disabled prop and avoids triggering download', () => {
    const exportProfileSpy = vi.spyOn(api, 'exportProfileCsv');

    render(<ReportDownload batchId="b-01" reportType="profile" disabled={true} />);
    const btn = screen.getByTestId('btn-download-profile-csv') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    fireEvent.click(btn);
    expect(exportProfileSpy).not.toHaveBeenCalled();
  });
});
