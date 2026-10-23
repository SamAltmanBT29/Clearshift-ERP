/**
 * ERP-3 Sales Orders and Invoices — Payments List Page
 *
 * Paginated read table for settled payments (Master Architecture Spec §3.1 /erp3/payments).
 *
 * @module erp3/web/pages/PaymentsListPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Payment } from '@clearshift/contracts';
import { PageTitle } from '@cs/ui';
import { fetchPayments, type PaymentsFilterQuery } from '../api/erp-3.js';
import { SkeletonTable, EmptyState, ErrorState } from '../components/StateViews.js';

export const PaymentsListPage: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPayments = useCallback(async (query: PaymentsFilterQuery) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchPayments(query);
      setPayments(response.items);
      setTotal(response.total);
      setTotalPages(response.totalPages);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch payments from server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPayments({ page, pageSize });
  }, [loadPayments, page, pageSize]);

  return (
    <div className="cs-module-root">
      <header className="cs-page-header">
        <PageTitle
          title="Payments"
          subtitle="Recorded settlement transactions and payment histories across invoices."
        />
      </header>

      {isLoading && <SkeletonTable rows={5} columns={6} />}

      {!isLoading && error && (
        <ErrorState
          title="Failed to Load Payments"
          message={error}
          onRetry={() => loadPayments({ page, pageSize })}
        />
      )}

      {!isLoading && !error && payments.length === 0 && (
        <EmptyState
          title="No Payments Found"
          message="There are no payment settlement transactions recorded yet."
        />
      )}

      {!isLoading && !error && payments.length > 0 && (
        <div className="cs-table-card">
          <table className="cs-table" aria-label="Payments Table">
            <thead>
              <tr>
                <th scope="col">Payment ID</th>
                <th scope="col">Invoice ID</th>
                <th scope="col">Amount</th>
                <th scope="col">Method</th>
                <th scope="col">Reference</th>
                <th scope="col">Paid At</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="cs-cell-mono font-bold">{p.id}</td>
                  <td className="cs-cell-mono">{p.invoice_id || (p as any).invoiceId}</td>
                  <td className="cs-cell-numeric font-bold">{p.amount}</td>
                  <td>
                    <span className="cs-badge cs-badge-open">{p.method || 'standard'}</span>
                  </td>
                  <td className="cs-cell-muted">{(p as any).reference || '—'}</td>
                  <td className="cs-cell-muted">
                    {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <nav className="cs-pagination" aria-label="Payments pagination">
              <span className="cs-pagination-info">
                Page {page} of {totalPages} ({total} payments)
              </span>
              <div className="cs-pagination-buttons">
                <button
                  type="button"
                  className="cs-btn-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="cs-btn-secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </div>
      )}
    </div>
  );
};

export default PaymentsListPage;
