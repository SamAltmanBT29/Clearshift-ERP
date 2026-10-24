import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { PurchaseOrder } from '@clearshift/contracts';
import { fetchPurchaseOrders } from '../api/erp-2.js';
import { StatusBadge, SkeletonTable, ErrorState } from './StateViews.js';

export interface VendorLinkedOrdersTableProps {
  vendorId: string;
  vendorName: string;
  currency?: string;
}

export const VendorLinkedOrdersTable: React.FC<VendorLinkedOrdersTableProps> = ({
  vendorId,
  vendorName,
  currency = 'USD',
}) => {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetchPurchaseOrders({ vendor_id: vendorId, page: 1, pageSize: 20 });
      setOrders(res.items || []);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load linked purchase orders.');
    } finally {
      setIsLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  return (
    <div className="cs-card cs-erp2-linked-orders-panel" data-testid="vendor-linked-orders-panel" style={{ marginTop: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h3 className="cs-section-subtitle" style={{ margin: 0 }}>
            Linked Purchase Orders ({orders.length})
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>
            Procurement orders placed with {vendorName}
          </p>
        </div>
        <Link
          to={`/erp2/purchase-orders/new?vendor_id=${vendorId}`}
          className="cs-button cs-button-secondary"
          role="button"
          data-testid="create-po-linked-btn"
          aria-label={`Create new purchase order for ${vendorName}`}
        >
          + New Purchase Order
        </Link>
      </div>

      {isLoading && <SkeletonTable columns={5} rows={3} />}

      {loadError && (
        <ErrorState
          title="Failed to Load Linked Orders"
          message={loadError}
          onRetry={loadOrders}
        />
      )}

      {!isLoading && !loadError && orders.length === 0 && (
        <div
          data-testid="linked-orders-empty"
          style={{
            padding: '32px 16px',
            textAlign: 'center',
            backgroundColor: 'var(--color-bg-subtle, #f9fafb)',
            borderRadius: 'var(--radius-md, 6px)',
            border: '1px dashed var(--color-border-subtle, #e5e7eb)',
          }}
        >
          <p style={{ margin: 0, fontWeight: 500, color: 'var(--color-text-primary)' }}>
            No purchase orders linked to this vendor yet.
          </p>
          <p style={{ margin: '6px 0 16px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
            Create a purchase order to start procurement with this vendor.
          </p>
          <Link
            to={`/erp2/purchase-orders/new?vendor_id=${vendorId}`}
            className="cs-button cs-button-primary"
            role="button"
          >
            Create First Purchase Order
          </Link>
        </div>
      )}

      {!isLoading && !loadError && orders.length > 0 && (
        <div className="cs-table-card">
          <table className="cs-table" data-testid="linked-orders-table">
            <thead>
              <tr>
                <th scope="col">PO Number</th>
                <th scope="col">Order Date</th>
                <th scope="col">Status</th>
                <th scope="col">Lines</th>
                <th scope="col" className="cs-cell-number">Total Amount</th>
                <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id}>
                  <td>
                    <Link
                      to={`/erp2/purchase-orders/${po.id}`}
                      className="cs-cell-mono"
                      style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'underline' }}
                      aria-label={`View order ${po.po_number}`}
                    >
                      {po.po_number}
                    </Link>
                  </td>
                  <td>{po.order_date}</td>
                  <td>
                    <StatusBadge status={po.status} />
                  </td>
                  <td>{po.lines?.length || 0} line item(s)</td>
                  <td className="cs-cell-number">
                    <strong>
                      {po.currency}{' '}
                      {Number(po.total).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link
                      to={`/erp2/purchase-orders/${po.id}`}
                      className="cs-button cs-button-secondary"
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                      role="button"
                    >
                      View Details →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cross-Module Linked Records Banner (ERP-4 Finance & Bills) */}
      <div
        className="cs-cross-module-panel"
        data-testid="cross-module-erp4-panel"
        style={{
          marginTop: '16px',
          padding: '12px 16px',
          backgroundColor: 'var(--color-bg-subtle, #f9fafb)',
          border: '1px solid var(--color-border-subtle, #e5e7eb)',
          borderRadius: 'var(--radius-md, 6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="cs-badge" style={{ backgroundColor: '#e0e7ff', color: '#3730a3', fontSize: '11px', fontWeight: 600 }}>
            ERP-4 Finance
          </span>
          <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            Downstream Accounting & Vendor Bills for <strong>{vendorName}</strong>
          </span>
        </div>
        <Link
          to={`/erp4/bills?vendor_id=${vendorId}`}
          className="cs-cross-module-link"
          style={{ fontSize: '13px', color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'underline' }}
          aria-label={`View vendor bills for ${vendorName} in ERP-4`}
        >
          View Matched Bills in ERP-4 →
        </Link>
      </div>
    </div>
  );
};
