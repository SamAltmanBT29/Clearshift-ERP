import React, { useState, useEffect, useCallback } from 'react';
import type { SalesOrder, SalesOrderStatus } from '@clearshift/contracts';
import {
  fetchSalesOrderById,
  updateSalesOrderStatus,
  updateSalesOrder,
  fetchSalesOrderLinkedRecords,
  type SalesOrderLinkedRecords,
} from '../api/erp-3.js';
import { StatusBadge, SkeletonTable, ErrorState } from '../components/StateViews.js';
import { ConfirmActionDialog } from '../components/forms/ConfirmActionDialog.js';
import { OrderAuditPanel } from '../components/OrderAuditPanel.js';
import { OrderLinkedRecordsTable } from '../components/OrderLinkedRecordsTable.js';
import { OrderEditDrawer } from '../components/forms/OrderEditDrawer.js';

export interface OrderDetailPageProps {
  orderId: string;
  initialOrder?: SalesOrder | null;
  userPermissions?: string[];
  onBack: () => void;
  onOrderUpdated?: (order: SalesOrder) => void;
  onCreateInvoice?: (order: SalesOrder) => void;
  onNavigateModule?: (module: string, recordId: string) => void;
}

export const OrderDetailPage: React.FC<OrderDetailPageProps> = ({
  orderId,
  initialOrder = null,
  userPermissions = ['orders:read', 'orders:write'],
  onBack,
  onOrderUpdated,
  onCreateInvoice,
  onNavigateModule,
}) => {
  const [order, setOrder] = useState<SalesOrder | null>(initialOrder);
  const [isLoading, setIsLoading] = useState(!initialOrder);
  const [error, setError] = useState<string | null>(null);

  // Status transition state (isolated PATCH /sales-orders/{id} workflow)
  const [pendingStatus, setPendingStatus] = useState<SalesOrderStatus | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Inline editing state (AC2)
  const [isInlineEditing, setIsInlineEditing] = useState(false);
  const [inlineForm, setInlineForm] = useState<{
    order_date: string;
    currency: string;
    customer_email: string;
    customer_phone: string;
    notes: string;
  }>({
    order_date: '',
    currency: 'USD',
    customer_email: '',
    customer_phone: '',
    notes: '',
  });
  const [isInlineSaving, setIsInlineSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Drawer edit state (AC2)
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);

  // Linked records state (AC3)
  const [linkedRecords, setLinkedRecords] = useState<SalesOrderLinkedRecords | null>(null);
  const [isLinkedLoading, setIsLinkedLoading] = useState(false);

  // Conflict state (AC4)
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Toast alert notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Permission checking
  const hasWritePermission =
    userPermissions.includes('orders:write') || userPermissions.includes('orders:manage');
  const isEditable = hasWritePermission && order?.status === 'Open';

  const loadLinked = useCallback(async (id: string) => {
    setIsLinkedLoading(true);
    try {
      const data = await fetchSalesOrderLinkedRecords(id);
      setLinkedRecords(data);
    } catch {
      // Graceful fallback for linked records
      setLinkedRecords(null);
    } finally {
      setIsLinkedLoading(false);
    }
  }, []);

  const loadOrder = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchSalesOrderById(orderId);
      setOrder(data);
      loadLinked(data.id);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch sales order details.');
    } finally {
      setIsLoading(false);
    }
  }, [orderId, loadLinked]);

  useEffect(() => {
    if (!initialOrder) {
      loadOrder();
    } else {
      loadLinked(initialOrder.id);
    }
  }, [initialOrder, loadOrder, loadLinked]);

  useEffect(() => {
    if (order) {
      setInlineForm({
        order_date: order.order_date || '',
        currency: order.currency || 'USD',
        customer_email: (order as any).customer_email || '',
        customer_phone: (order as any).customer_phone || '',
        notes: (order as any).notes || '',
      });
    }
  }, [order]);

  const handleConfirmStatusChange = async () => {
    if (!pendingStatus || !order) return;
    setIsTransitioning(true);
    setTransitionError(null);
    try {
      const updated = await updateSalesOrderStatus(order.id, { status: pendingStatus });
      setOrder(updated);
      setPendingStatus(null);
      setToastMessage(`Order status updated to ${pendingStatus}.`);
      onOrderUpdated?.(updated);
    } catch (err: any) {
      setTransitionError(err?.message || 'Failed to update order status.');
    } finally {
      setIsTransitioning(false);
    }
  };

  const handleStartInlineEdit = () => {
    if (!isEditable) return;
    setInlineError(null);
    setConflictError(null);
    setIsInlineEditing(true);
  };

  const handleCancelInlineEdit = () => {
    setIsInlineEditing(false);
    setInlineError(null);
    if (order) {
      setInlineForm({
        order_date: order.order_date || '',
        currency: order.currency || 'USD',
        customer_email: (order as any).customer_email || '',
        customer_phone: (order as any).customer_phone || '',
        notes: (order as any).notes || '',
      });
    }
  };

  const handleSaveInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || !hasWritePermission || order.status !== 'Open') return;

    setIsInlineSaving(true);
    setInlineError(null);
    setConflictError(null);

    try {
      const ifMatch =
        (order as any).version != null
          ? String((order as any).version)
          : order.updated_at || undefined;

      const updated = await updateSalesOrder(
        order.id,
        {
          order_date: inlineForm.order_date,
          currency: inlineForm.currency,
          customer_email: inlineForm.customer_email || undefined,
          customer_phone: inlineForm.customer_phone || undefined,
          notes: inlineForm.notes || undefined,
        },
        ifMatch ? { ifMatch } : undefined
      );

      setOrder(updated);
      setIsInlineEditing(false);
      setToastMessage('Sales order updated successfully.');
      onOrderUpdated?.(updated);
    } catch (err: any) {
      const status = err?.status || err?.statusCode;
      const msg = err?.message || '';
      if (status === 409 || msg.includes('409') || msg.toLowerCase().includes('conflict')) {
        setConflictError(
          err?.message ||
            'Concurrent modification conflict: this order was modified by another user or session. Please refresh and re-apply changes.'
        );
      } else {
        setInlineError(err?.message || 'Failed to update sales order.');
      }
    } finally {
      setIsInlineSaving(false);
    }
  };

  const handleDrawerSaved = (updated: SalesOrder) => {
    setOrder(updated);
    setIsEditDrawerOpen(false);
    setToastMessage('Sales order updated successfully.');
    onOrderUpdated?.(updated);
  };

  const handleConflictRefresh = async () => {
    setConflictError(null);
    setIsInlineEditing(false);
    await loadOrder();
    setToastMessage('Latest order data refreshed successfully.');
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
  const createdAtFormatted = order.created_at || '2026-03-01T10:00:00Z';
  const updatedAtFormatted = order.updated_at || '2026-03-01T10:00:00Z';

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

      {/* Toast Alert */}
      {toastMessage && (
        <div data-testid="detail-toast-alert" role="status" className="cs-erp3-toast">
          <span>{toastMessage}</span>
          <button
            type="button"
            className="cs-erp3-toast-close"
            onClick={() => setToastMessage(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}

      {/* Concurrent Conflict Banner (AC4) */}
      {conflictError && (
        <div data-testid="concurrent-conflict-banner" role="alert" className="cs-erp3-conflict-banner">
          <div className="cs-erp3-conflict-content">
            <span className="cs-erp3-conflict-icon" aria-hidden="true">
              ⚠️
            </span>
            <div>
              <strong className="cs-erp3-conflict-title">Concurrent Modification Conflict (409)</strong>
              <p className="cs-erp3-conflict-text">{conflictError}</p>
            </div>
          </div>
          <button
            type="button"
            data-testid="conflict-refresh-btn"
            className="cs-btn-primary"
            onClick={handleConflictRefresh}
          >
            Refresh & Re-apply Changes
          </button>
        </div>
      )}

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
          {/* Edit Actions (AC2) */}
          <button
            type="button"
            data-testid="enable-inline-edit-btn"
            className="cs-btn-secondary"
            onClick={handleStartInlineEdit}
            disabled={!hasWritePermission || order.status !== 'Open'}
            title={
              !hasWritePermission
                ? 'Insufficient permissions (orders:write required)'
                : order.status !== 'Open'
                ? 'Only Open orders can be modified'
                : 'Inline edit allowlisted fields'
            }
            aria-label="Inline edit sales order"
          >
            Inline Edit
          </button>

          <button
            type="button"
            data-testid="open-edit-drawer-btn"
            className="cs-btn-secondary"
            onClick={() => setIsEditDrawerOpen(true)}
            disabled={!hasWritePermission || order.status !== 'Open'}
            title={
              !hasWritePermission
                ? 'Insufficient permissions (orders:write required)'
                : order.status !== 'Open'
                ? 'Only Open orders can be modified'
                : 'Open drawer to edit allowlisted fields'
            }
            aria-label="Open sales order edit drawer"
          >
            Edit in Drawer
          </button>

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

      {/* Inline Edit Form (AC2) */}
      {isInlineEditing && (
        <section className="cs-table-card cs-erp3-inline-card" style={{ marginBottom: '24px' }}>
          <header className="cs-table-header-title">
            <h2 className="cs-section-heading">Inline Edit Sales Order</h2>
            <p className="cs-page-description">
              Allowlisted fields can be updated directly. Order number and Golden ID are immutable.
            </p>
          </header>

          {inlineError && (
            <div className="cs-form-error-banner" role="alert" style={{ marginBottom: '16px' }}>
              <span className="cs-error-icon" aria-hidden="true">⚠️</span>
              <div>
                <strong>Update failed:</strong>
                <p>{inlineError}</p>
              </div>
            </div>
          )}

          <form data-testid="inline-edit-form" onSubmit={handleSaveInline} className="cs-erp3-inline-form">
            <div className="cs-erp3-form-grid">
              <div className="cs-form-field">
                <label className="cs-field-label" htmlFor="inline-order-number">
                  Order Number (Immutable)
                </label>
                <input
                  id="inline-order-number"
                  type="text"
                  className="cs-input cs-mono"
                  value={order.order_number}
                  disabled
                  readOnly
                />
              </div>

              <div className="cs-form-field">
                <label className="cs-field-label" htmlFor="inline-order-date">
                  Order Date <span className="cs-required">*</span>
                </label>
                <input
                  id="inline-order-date"
                  name="order_date"
                  data-testid="inline-order-date-input"
                  type="date"
                  className="cs-input"
                  value={inlineForm.order_date}
                  onChange={(e) => setInlineForm((prev) => ({ ...prev, order_date: e.target.value }))}
                  required
                />
              </div>

              <div className="cs-form-field">
                <label className="cs-field-label" htmlFor="inline-currency">
                  Currency <span className="cs-required">*</span>
                </label>
                <select
                  id="inline-currency"
                  name="currency"
                  data-testid="inline-currency-input"
                  className="cs-select"
                  value={inlineForm.currency}
                  onChange={(e) => setInlineForm((prev) => ({ ...prev, currency: e.target.value }))}
                  required
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="CAD">CAD</option>
                  <option value="AUD">AUD</option>
                </select>
              </div>

              <div className="cs-form-field">
                <label className="cs-field-label" htmlFor="inline-customer-email">
                  Customer Email
                </label>
                <input
                  id="inline-customer-email"
                  name="customer_email"
                  data-testid="inline-email-input"
                  type="email"
                  className="cs-input"
                  value={inlineForm.customer_email}
                  onChange={(e) =>
                    setInlineForm((prev) => ({ ...prev, customer_email: e.target.value }))
                  }
                />
              </div>

              <div className="cs-form-field">
                <label className="cs-field-label" htmlFor="inline-customer-phone">
                  Customer Phone
                </label>
                <input
                  id="inline-customer-phone"
                  name="customer_phone"
                  data-testid="inline-phone-input"
                  type="tel"
                  className="cs-input"
                  value={inlineForm.customer_phone}
                  onChange={(e) =>
                    setInlineForm((prev) => ({ ...prev, customer_phone: e.target.value }))
                  }
                />
              </div>

              <div className="cs-form-field" style={{ gridColumn: '1 / -1' }}>
                <label className="cs-field-label" htmlFor="inline-notes">
                  Notes
                </label>
                <textarea
                  id="inline-notes"
                  name="notes"
                  data-testid="inline-notes-input"
                  className="cs-textarea"
                  rows={2}
                  value={inlineForm.notes}
                  onChange={(e) => setInlineForm((prev) => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="cs-erp3-inline-actions">
              <button
                type="button"
                data-testid="inline-cancel-btn"
                className="cs-btn-secondary"
                onClick={handleCancelInlineEdit}
                disabled={isInlineSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="inline-save-btn"
                className="cs-btn-primary"
                disabled={isInlineSaving}
                aria-busy={isInlineSaving}
              >
                {isInlineSaving ? 'Saving Changes...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="cs-detail-layout">
        {/* Info metadata cards (AC1) */}
        <div className="cs-detail-meta-grid" data-testid="order-primary-attributes-grid">
          <div className="cs-meta-card">
            <span className="cs-meta-label">Order Number</span>
            <span data-testid="attr-order-number" className="cs-meta-value cs-mono" style={{ fontWeight: 600 }}>
              {order.order_number}
            </span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Customer Golden ID</span>
            <span data-testid="attr-customer-gid" className="cs-meta-value cs-mono" style={{ fontWeight: 600 }}>
              {order.customer_golden_id}
            </span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Order Date</span>
            <span data-testid="attr-order-date" className="cs-meta-value">{order.order_date}</span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Currency</span>
            <span data-testid="attr-currency" className="cs-meta-value">{order.currency}</span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Total Amount</span>
            <span data-testid="attr-total" className="cs-meta-value cs-mono" style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
              ${totalNum.toFixed(2)} {order.currency}
            </span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Lifecycle Status</span>
            <span data-testid="attr-status" className="cs-meta-value">
              <StatusBadge status={order.status} />
            </span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Created At</span>
            <span data-testid="attr-created-at" className="cs-meta-value cs-mono">
              {createdAtFormatted}
            </span>
          </div>

          <div className="cs-meta-card">
            <span className="cs-meta-label">Updated At</span>
            <span data-testid="attr-updated-at" className="cs-meta-value cs-mono">
              {updatedAtFormatted}
            </span>
          </div>
        </div>

        {/* Audit & Golden ID Panel (AC1) */}
        <OrderAuditPanel order={order} />

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

        {/* Linked Records Sub-tables (AC3) */}
        <section data-testid="order-linked-records-section" style={{ marginTop: '24px' }}>
          <OrderLinkedRecordsTable
            linkedRecords={linkedRecords}
            isLoading={isLinkedLoading}
            onNavigateModule={onNavigateModule}
          />
        </section>
      </div>

      {/* Drawer Form (AC2) */}
      <OrderEditDrawer
        isOpen={isEditDrawerOpen}
        order={order}
        onClose={() => setIsEditDrawerOpen(false)}
        onSaved={handleDrawerSaved}
        canEdit={hasWritePermission}
      />

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
