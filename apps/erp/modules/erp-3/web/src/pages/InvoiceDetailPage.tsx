import React, { useState, useEffect, useCallback } from 'react';
import type { Invoice, Payment, CreatePaymentInput } from '@clearshift/contracts';
import { fetchInvoiceById, fetchPayments, createPayment } from '../api/erp-3.js';
import { StatusBadge, SkeletonTable, ErrorState } from '../components/StateViews.js';
import { PaymentModal } from '../components/forms/PaymentModal.js';

export interface InvoiceDetailPageProps {
  invoiceId: string;
  initialInvoice?: Invoice | null;
  onBack: () => void;
  onViewOrder?: (orderId: string) => void;
}

export const InvoiceDetailPage: React.FC<InvoiceDetailPageProps> = ({
  invoiceId,
  initialInvoice = null,
  onBack,
  onViewOrder,
}) => {
  const [invoice, setInvoice] = useState<Invoice | null>(initialInvoice);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(!initialInvoice);
  const [error, setError] = useState<string | null>(null);

  // Payment modal state
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [paymentApiError, setPaymentApiError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [inv, paymentsRes] = await Promise.all([
        fetchInvoiceById(invoiceId),
        fetchPayments({ invoiceId, page: 1, pageSize: 50 }).catch(() => ({ items: [] })),
      ]);
      setInvoice(inv);
      setPayments(paymentsRes.items || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch invoice details.');
    } finally {
      setIsLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRecordPayment = async (data: CreatePaymentInput) => {
    setIsSubmittingPayment(true);
    setPaymentApiError(null);
    try {
      await createPayment(data);
      setIsPaymentModalOpen(false);
      // Reload invoice and payments to show updated status (e.g. Paid)
      await loadData();
    } catch (err: any) {
      setPaymentApiError(err?.message || 'Failed to record payment on the server.');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cs-module-root">
        <nav className="cs-back-nav">
          <button type="button" className="cs-btn-back" onClick={onBack} aria-label="Back to invoices">
            ← Back to Sales Orders & Invoices
          </button>
        </nav>
        <header className="cs-page-header">
          <h1 className="cs-page-title">Loading Invoice...</h1>
        </header>
        <SkeletonTable columns={5} rows={4} />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="cs-module-root">
        <nav className="cs-back-nav">
          <button type="button" className="cs-btn-back" onClick={onBack} aria-label="Back to invoices">
            ← Back to Sales Orders & Invoices
          </button>
        </nav>
        <ErrorState
          title="Failed to Load Invoice"
          message={error || 'Invoice could not be located.'}
          onRetry={loadData}
        />
      </div>
    );
  }

  const remainingCents = Math.max(
    0,
    Math.round(parseFloat(invoice.total || '0') * 100) - Math.round(parseFloat(invoice.paidAmount || '0') * 100)
  );
  const remainingAmount = (remainingCents / 100).toFixed(2);
  const isFullyPaid = invoice.status === 'paid' || remainingCents === 0;

  return (
    <div className="cs-module-root">
      <nav className="cs-back-nav" aria-label="Invoice detail navigation">
        <button
          type="button"
          className="cs-btn-back"
          onClick={onBack}
          aria-label="Back to Sales Orders & Invoices list"
        >
          ← Back to Sales Orders & Invoices
        </button>
      </nav>

      {/* Invoice Header */}
      <header className="cs-detail-header">
        <div className="cs-detail-title-group">
          <div className="cs-detail-title-row">
            <h1 className="cs-page-title">Invoice {invoice.invoiceNumber}</h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="cs-page-description">
            Internal ID: <span className="cs-mono">{invoice.id}</span> • Issued on {invoice.invoiceDate}
          </p>
        </div>

        {/* Workflow Actions */}
        <div className="cs-detail-actions">
          {!isFullyPaid && (
            <button
              type="button"
              className="cs-btn-primary"
              onClick={() => {
                setPaymentApiError(null);
                setIsPaymentModalOpen(true);
              }}
              aria-label={`Record payment for invoice ${invoice.invoiceNumber}`}
            >
              Record Payment
            </button>
          )}
          {onViewOrder && invoice.orderId && (
            <button
              type="button"
              className="cs-btn-secondary"
              onClick={() => onViewOrder(invoice.orderId)}
              aria-label={`View linked sales order ${invoice.orderId}`}
            >
              View Sales Order
            </button>
          )}
        </div>
      </header>

      <div className="cs-detail-layout">
        {/* Info metadata cards */}
        <div className="cs-detail-meta-grid">
          <div className="cs-meta-card">
            <span className="cs-meta-label">Customer Golden ID</span>
            <span className="cs-meta-value cs-mono" style={{ fontWeight: 600 }}>
              {invoice.customerGoldenId}
            </span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Due Date</span>
            <span
              className={`cs-meta-value ${invoice.status === 'overdue' ? 'cs-text-danger' : ''}`}
              style={{ fontWeight: 600 }}
            >
              {invoice.dueDate} {invoice.status === 'overdue' && '⚠️ Overdue'}
            </span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Total Amount</span>
            <span className="cs-meta-value cs-mono" style={{ fontWeight: 700 }}>
              ${invoice.total} {invoice.currencyCode}
            </span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Balance Due</span>
            <span
              className="cs-meta-value cs-mono"
              style={{
                fontWeight: 700,
                color: isFullyPaid ? 'var(--color-success)' : 'var(--color-primary)',
              }}
            >
              ${remainingAmount} {invoice.currencyCode}
            </span>
          </div>
        </div>

        {invoice.notes && (
          <div className="cs-meta-notes-card">
            <strong>Payment Terms & Notes:</strong>
            <p>{invoice.notes}</p>
          </div>
        )}

        {/* Payments History Table */}
        <section className="cs-table-card" style={{ marginTop: '24px' }}>
          <header className="cs-table-header-title">
            <h2 className="cs-section-heading">Payment History ({payments.length})</h2>
          </header>

          <div style={{ overflowX: 'auto' }}>
            <table className="cs-table" aria-label="Invoice payment records">
              <thead>
                <tr>
                  <th scope="col">Payment ID</th>
                  <th scope="col">Date</th>
                  <th scope="col">Method</th>
                  <th scope="col">Reference / Memo</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Amount</th>
                  <th scope="col" style={{ textAlign: 'center' }}>Settlement</th>
                </tr>
              </thead>
              <tbody>
                {payments.length > 0 ? (
                  payments.map((p) => (
                    <tr key={p.id}>
                      <td className="cs-mono">{p.id}</td>
                      <td>{p.paidAt}</td>
                      <td style={{ textTransform: 'capitalize' }}>{p.method}</td>
                      <td>{p.reference || '—'}</td>
                      <td className="cs-mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                        ${p.amount} {p.currencyCode}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="cs-badge cs-badge-paid">Paid</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px' }}>
                      No payments recorded yet. Click "Record Payment" above to record settlement.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Payment Recording Modal */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        invoice={invoice}
        onClose={() => setIsPaymentModalOpen(false)}
        onSubmit={handleRecordPayment}
        isLoading={isSubmittingPayment}
        apiError={paymentApiError}
      />
    </div>
  );
};
