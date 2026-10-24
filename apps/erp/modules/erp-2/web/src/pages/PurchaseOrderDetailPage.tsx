import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PageTitle } from '@cs/ui';
import type { PurchaseOrder, PurchaseOrderStatus } from '@clearshift/contracts';
import { fetchPurchaseOrderById, updatePurchaseOrderStatus } from '../api/erp-2.js';
import { ErrorState, SkeletonTable, StatusBadge } from '../components/StateViews.js';
import { ConfirmActionDialog } from '../components/forms/ConfirmActionDialog.js';

export const PurchaseOrderDetailPage: React.FC = () => {
  const { purchaseOrderId } = useParams<{ purchaseOrderId: string }>();

  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Status transition confirmation dialog state
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    nextStatus: PurchaseOrderStatus;
    title: string;
    message: string;
  }>({
    isOpen: false,
    nextStatus: 'Draft',
    title: '',
    message: '',
  });

  const loadOrder = useCallback(async (id: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchPurchaseOrderById(id);
      setOrder(data);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load purchase order from server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (purchaseOrderId) {
      loadOrder(purchaseOrderId);
    } else {
      setLoadError('No purchase order ID specified in route.');
      setIsLoading(false);
    }
  }, [purchaseOrderId, loadOrder]);

  const handleOpenTransitionDialog = (nextStatus: PurchaseOrderStatus) => {
    let title = '';
    let message = '';

    if (nextStatus === 'Sent') {
      title = 'Send Purchase Order to Vendor?';
      message = 'This will advance the order status from Draft to Sent. Once sent, lines cannot be modified. Confirm to proceed?';
    } else if (nextStatus === 'Received') {
      title = 'Mark Purchase Order as Received?';
      message = 'This confirms receipt of goods from the vendor (Received). In V1, goods receipts are recorded in ERP-2 without modifying warehouse inventory. Confirm to proceed?';
    } else if (nextStatus === 'Closed') {
      title = 'Close Purchase Order?';
      message = 'This will mark the purchase order as Closed. This is a terminal state in V1 and no further transitions are permitted. Confirm to proceed?';
    }

    setDialogState({
      isOpen: true,
      nextStatus,
      title,
      message,
    });
  };

  const handleConfirmTransition = async () => {
    if (!purchaseOrderId || !dialogState.nextStatus) return;
    setIsUpdatingStatus(true);
    setStatusError(null);
    try {
      const updated = await updatePurchaseOrderStatus(purchaseOrderId, {
        status: dialogState.nextStatus,
      });
      setOrder(updated);
      setDialogState((prev) => ({ ...prev, isOpen: false }));
    } catch (err: any) {
      setStatusError(err?.message || 'Failed to update purchase order status.');
      setDialogState((prev) => ({ ...prev, isOpen: false }));
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cs-page-container">
        <PageTitle title="Purchase Order" subtitle="Loading record from API..." />
        <SkeletonTable columns={4} rows={4} />
      </div>
    );
  }

  if (loadError || !order) {
    return (
      <div className="cs-page-container">
        <PageTitle
          title="Purchase Order"
          actions={
            <Link to="/erp2/purchase-orders" className="cs-button cs-button-secondary" role="button">
              ← Back to Purchase Orders
            </Link>
          }
        />
        <ErrorState
          title="Failed to Load Purchase Order"
          message={loadError || 'Purchase order record not found.'}
          onRetry={purchaseOrderId ? () => loadOrder(purchaseOrderId) : undefined}
        />
      </div>
    );
  }

  return (
    <div className="cs-page-container">
      <PageTitle
        title={`Purchase Order ${order.po_number}`}
        subtitle={`Order date: ${order.order_date} · Currency: ${order.currency}`}
        actions={
          <div className="flex gap-2">
            {order.status === 'Draft' && (
              <button
                type="button"
                className="cs-button cs-button-primary"
                onClick={() => handleOpenTransitionDialog('Sent')}
                disabled={isUpdatingStatus}
                aria-label="Send order to vendor"
              >
                Send to Vendor
              </button>
            )}
            {order.status === 'Sent' && (
              <button
                type="button"
                className="cs-button cs-button-primary"
                onClick={() => handleOpenTransitionDialog('Received')}
                disabled={isUpdatingStatus}
                aria-label="Mark order as received"
              >
                Mark as Received
              </button>
            )}
            {order.status === 'Received' && (
              <button
                type="button"
                className="cs-button cs-button-secondary"
                onClick={() => handleOpenTransitionDialog('Closed')}
                disabled={isUpdatingStatus}
                aria-label="Close purchase order"
              >
                Close Order
              </button>
            )}
            <Link
              to="/erp2/purchase-orders"
              className="cs-button cs-button-secondary"
              role="button"
              aria-label="Back to purchase orders list"
            >
              ← Back to Orders
            </Link>
          </div>
        }
      />

      {statusError && (
        <div className="cs-error-box" role="alert">
          <p className="cs-error-desc" style={{ margin: 0 }}>
            {statusError}
          </p>
        </div>
      )}

      {/* Header Summary Card */}
      <div className="cs-card">
        <h3 className="cs-section-subtitle" style={{ marginTop: 0, marginBottom: '16px' }}>
          Order Header
        </h3>

        <div className="cs-detail-grid">
          <div className="cs-detail-item">
            <span className="cs-detail-label">PO Number</span>
            <span className="cs-detail-value cs-cell-mono">
              <strong>{order.po_number}</strong>
            </span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Status</span>
            <span className="cs-detail-value">
              <StatusBadge status={order.status} />
            </span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Order Date</span>
            <span className="cs-detail-value">{order.order_date}</span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Vendor Reference</span>
            <span className="cs-detail-value">
              <Link
                to={`/erp2/vendors/${order.vendor_id}`}
                className="cs-cell-mono"
                style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
                aria-label="View vendor record"
              >
                {order.vendor_id}
              </Link>
            </span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Currency</span>
            <span className="cs-detail-value cs-cell-mono">{order.currency}</span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Total (Server-Computed)</span>
            <span className="cs-detail-value" style={{ fontSize: '18px', fontWeight: 700 }}>
              {order.currency}{' '}
              {Number(order.total).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Purchase Order Lines Table */}
      <div className="cs-card">
        <h3 className="cs-section-subtitle" style={{ marginTop: 0, marginBottom: '12px' }}>
          Line Items ({order.lines?.length || 0})
        </h3>

        <div className="cs-table-card">
          <table className="cs-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">ERP-1 Product UUID</th>
                <th scope="col" className="cs-cell-number">Quantity</th>
                <th scope="col" className="cs-cell-number">Unit Price</th>
                <th scope="col" className="cs-cell-number">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines?.map((line, idx) => (
                <tr key={line.id || idx}>
                  <td>{idx + 1}</td>
                  <td className="cs-cell-mono">{line.product_id}</td>
                  <td className="cs-cell-number">{Number(line.quantity).toFixed(2)}</td>
                  <td className="cs-cell-number">
                    {order.currency} {Number(line.price).toFixed(2)}
                  </td>
                  <td className="cs-cell-number">
                    <strong>
                      {order.currency} {Number(line.line_total).toFixed(2)}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Irreversible Action Confirmation Modal */}
      <ConfirmActionDialog
        isOpen={dialogState.isOpen}
        title={dialogState.title}
        message={dialogState.message}
        confirmLabel="Confirm Transition"
        cancelLabel="Cancel"
        isLoading={isUpdatingStatus}
        onConfirm={handleConfirmTransition}
        onCancel={() => setDialogState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default PurchaseOrderDetailPage;
