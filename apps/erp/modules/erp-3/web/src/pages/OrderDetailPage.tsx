import React, { useState, useEffect, useCallback } from 'react';
import type { SalesOrder, SalesOrderStatus } from '@clearshift/contracts';
import { fetchSalesOrderById, updateSalesOrderStatus } from '../api/erp-3.js';
import { StatusBadge, SkeletonTable, ErrorState } from '../components/StateViews.js';
import { ConfirmActionDialog } from '../components/forms/ConfirmActionDialog.js';

export interface OrderDetailPageProps {
  orderId: string;
  initialOrder?: SalesOrder | null;
  onBack: () => void;
  onCreateInvoice?: (order: SalesOrder) => void;
}

export const OrderDetailPage: React.FC<OrderDetailPageProps> = ({
  orderId,
  initialOrder = null,
  onBack,
  onCreateInvoice,
}) => {
  const [order, setOrder] = useState<SalesOrder | null>(initialOrder);
  const [isLoading, setIsLoading] = useState(!initialOrder);
  const [error, setError] = useState<string | null>(null);

  // Status transition state (isolated PATCH /sales-orders/{id} workflow)
  const [pendingStatus, setPendingStatus] = useState<SalesOrderStatus | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const loadOrder = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchSalesOrderById(orderId);
      setOrder(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch sales order details.');
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (!initialOrder) {
      loadOrder();
    }
  }, [initialOrder, loadOrder]);

  const handleConfirmStatusChange = async () => {
    if (!pendingStatus || !order) return;
    setIsTransitioning(true);
    setTransitionError(null);
    try {
      const updated = await updateSalesOrderStatus(order.id, { status: pendingStatus });
      setOrder(updated);
      setPendingStatus(null);
    } catch (err: any) {
      setTransitionError(err?.message || 'Failed to update order status.');
    } finally {
      setIsTransitioning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cs-module-root">
        <nav className="cs-back-nav">
          <button type="button" className="cs-btn-back" onClick={onBack} aria-label="Back to orders">
            ← Back to Sales Orders & Invoices
          </button>
        </nav>
        <header className="cs-page-header">
          <h1 className="cs-page-title">Loading Sales Order...</h1>
        </header>
        <SkeletonTable columns={6} rows={4} />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="cs-module-root">
        <nav className="cs-back-nav">
          <button type="button" className="cs-btn-back" onClick={onBack} aria-label="Back to orders">
            ← Back to Sales Orders & Invoices
          </button>
        </nav>
        <ErrorState
          title="Failed to Load Sales Order"
          message={error || 'Sales order could not be located.'}
          onRetry={loadOrder}
        />
      </div>
    );
  }

  const totalNum = parseFloat(order.total || '0');
  const taxTotalNum =
    order.lines && order.lines.length > 0
      ? order.lines.reduce((acc, l) => acc + parseFloat(l.tax_amount || '0'), 0)
      : 0;
  const lineTotalSum =
    order.lines && order.lines.length > 0
      ? order.lines.reduce((acc, l) => acc + parseFloat(l.line_total || '0'), 0)
      : totalNum;
  const subtotalNum = Math.max(0, lineTotalSum - taxTotalNum);

  return (
    <div className="cs-module-root">
      <nav className="cs-back-nav" aria-label="Order detail navigation">
        <button
          type="button"
          className="cs-btn-back"
          onClick={onBack}
          aria-label="Back to Sales Orders & Invoices list"
        >
          ← Back to Sales Orders & Invoices
        </button>
      </nav>

      {transitionError && (
        <div className="cs-form-error-banner" role="alert" style={{ marginBottom: '16px' }}>
          <span className="cs-error-icon" aria-hidden="true">⚠️</span>
          <div>
            <strong>Status update failed:</strong>
            <p>{transitionError}</p>
          </div>
        </div>
      )}

      {/* Order Header */}
      <header className="cs-detail-header">
        <div className="cs-detail-title-group">
          <div className="cs-detail-title-row">
            <h1 className="cs-page-title">Sales Order {order.order_number}</h1>
            <StatusBadge status={order.status} />
          </div>
          <p className="cs-page-description">
            Internal ID: <span className="cs-mono">{order.id}</span> • Created on {order.order_date}
          </p>
        </div>

        {/* Workflow Actions */}
        <div className="cs-detail-actions">
          {order.status === 'Open' && (
            <>
              <button
                type="button"
                className="cs-btn-secondary"
                onClick={() => setPendingStatus('Invoiced')}
                disabled={isTransitioning}
                aria-label="Mark order as invoiced"
              >
                Mark Invoiced
              </button>
              <button
                type="button"
                className="cs-btn-danger"
                onClick={() => setPendingStatus('Closed')}
                disabled={isTransitioning}
                aria-label="Close sales order"
              >
                Close Order
              </button>
            </>
          )}

          {order.status === 'Invoiced' && (
            <button
              type="button"
              className="cs-btn-danger"
              onClick={() => setPendingStatus('Closed')}
              disabled={isTransitioning}
              aria-label="Close sales order"
            >
              Close Order
            </button>
          )}

          {order.status !== 'Closed' && onCreateInvoice && (
            <button
              type="button"
              className="cs-btn-primary"
              onClick={() => onCreateInvoice(order)}
              aria-label={`Generate invoice for order ${order.order_number}`}
            >
              Generate Invoice
            </button>
          )}
        </div>
      </header>

      <main className="cs-detail-layout">
        {/* Info metadata cards */}
        <div className="cs-detail-meta-grid">
          <div className="cs-meta-card">
            <span className="cs-meta-label">Customer Golden ID</span>
            <span className="cs-meta-value cs-mono" style={{ fontWeight: 600 }}>
              {order.customer_golden_id}
            </span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Order Date</span>
            <span className="cs-meta-value">{order.order_date}</span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Currency</span>
            <span className="cs-meta-value">{order.currency}</span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Total Amount</span>
            <span className="cs-meta-value cs-mono" style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
              ${totalNum.toFixed(2)} {order.currency}
            </span>
          </div>
        </div>

        {/* Lines Table */}
        <section className="cs-table-card" style={{ marginTop: '24px' }}>
          <header className="cs-table-header-title">
            <h2 className="cs-section-heading">Order Line Items ({order.lines?.length || 0})</h2>
          </header>

          <div style={{ overflowX: 'auto' }}>
            <table className="cs-table" aria-label="Order line items details">
              <thead>
                <tr>
                  <th scope="col">Product ID</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Quantity</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Unit Price</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Tax Rate</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Tax Amount</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {order.lines && order.lines.length > 0 ? (
                  order.lines.map((line, idx) => (
                    <tr key={line.id || idx}>
                      <td className="cs-mono">{line.product_id}</td>
                      <td className="cs-mono" style={{ textAlign: 'right' }}>
                        {parseFloat(line.quantity)}
                      </td>
                      <td className="cs-mono" style={{ textAlign: 'right' }}>
                        ${parseFloat(line.price).toFixed(2)} {order.currency}
                      </td>
                      <td className="cs-mono" style={{ textAlign: 'right' }}>
                        {parseFloat(line.tax_rate).toFixed(0)}%
                      </td>
                      <td className="cs-mono" style={{ textAlign: 'right' }}>
                        ${parseFloat(line.tax_amount).toFixed(2)} {order.currency}
                      </td>
                      <td className="cs-mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                        ${parseFloat(line.line_total).toFixed(2)} {order.currency}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px' }}>
                      No line items recorded for this order.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals Summary */}
          <div className="cs-totals-summary-card">
            <div className="cs-totals-row">
              <span>Subtotal:</span>
              <span className="cs-mono">${subtotalNum.toFixed(2)} {order.currency}</span>
            </div>
            <div className="cs-totals-row">
              <span>Tax Total (BR-ERP3-02):</span>
              <span className="cs-mono">${taxTotalNum.toFixed(2)} {order.currency}</span>
            </div>
            <div className="cs-totals-row cs-totals-final">
              <strong>Order Total (BR-ERP3-01):</strong>
              <strong className="cs-mono">${totalNum.toFixed(2)} {order.currency}</strong>
            </div>
          </div>
        </section>
      </main>

      {/* Confirmation Dialog for Irreversible Status Transitions */}
      <ConfirmActionDialog
        isOpen={!!pendingStatus}
        title={pendingStatus === 'Closed' ? 'Close Sales Order?' : `Mark Order as ${pendingStatus}?`}
        message={
          pendingStatus === 'Closed'
            ? 'Closing this sales order is an irreversible action. No further lines or invoices can be attached once closed.'
            : `Are you sure you want to transition this order status to "${pendingStatus}"?`
        }
        confirmLabel={pendingStatus === 'Closed' ? 'Yes, Close Order' : 'Yes, Update Status'}
        cancelLabel="Cancel"
        isDestructive={pendingStatus === 'Closed'}
        isLoading={isTransitioning}
        onConfirm={handleConfirmStatusChange}
        onCancel={() => setPendingStatus(null)}
      />
    </div>
  );
};
