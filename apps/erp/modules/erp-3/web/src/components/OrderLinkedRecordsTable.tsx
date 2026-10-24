/**
 * ERP-3 Sales Orders & Invoices — Sales Order Linked Records Sub-Tables
 *
 * Displays related master records across modules with deep navigation links:
 * - CRM-1 Customer Profile & Identity
 * - ERP-1 Catalog Products & Line Items
 * - ERP-3 Billing Invoices
 * - ERP-4 Accounting & Payments
 *
 * Conforms to Acceptance Criterion 3 for Issue #157 (ERP3-21):
 * - Linked entity sub-tables display related master records with navigation links to owning modules.
 *
 * @module erp3/web/components/OrderLinkedRecordsTable
 */

import React, { useState } from 'react';
import type { SalesOrderLinkedRecords } from '../api/erp-3.js';
import { StatusBadge } from '@cs/ui';

export interface OrderLinkedRecordsTableProps {
  readonly linkedRecords: SalesOrderLinkedRecords | null;
  readonly isLoading?: boolean;
  readonly onNavigateModule?: ((module: string, recordId: string) => void) | undefined;
}

export type LinkedRecordsTab = 'all' | 'customer' | 'products' | 'invoices' | 'payments';

export const OrderLinkedRecordsTable: React.FC<OrderLinkedRecordsTableProps> = ({
  linkedRecords,
  isLoading = false,
  onNavigateModule,
}) => {
  const [activeTab, setActiveTab] = useState<LinkedRecordsTab>('all');

  const customer = linkedRecords?.customer;
  const products = linkedRecords?.products ?? [];
  const invoices = linkedRecords?.invoices ?? [];
  const payments = linkedRecords?.payments ?? [];

  const handleLinkClick = (
    e: React.MouseEvent,
    module: string,
    recordId: string
  ) => {
    if (onNavigateModule) {
      e.preventDefault();
      onNavigateModule(module, recordId);
    }
  };

  const totalCount =
    (customer ? 1 : 0) + products.length + invoices.length + payments.length;

  if (isLoading) {
    return (
      <section className="cs-erp3-linked-section" aria-label="Loading linked records">
        <p className="text-sm text-[var(--cs-text-muted)]">Loading linked master records...</p>
      </section>
    );
  }

  if (totalCount === 0) {
    return (
      <section
        className="cs-erp3-linked-section"
        aria-label="No linked records found"
        data-testid="order-linked-records-section"
      >
        <div className="cs-erp3-empty-state">
          <p className="text-sm font-medium text-[var(--cs-text)]">No linked records found</p>
          <p className="text-xs text-[var(--cs-text-muted)]">
            No master records or downstream transactions have been associated with this sales order.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="cs-erp3-linked-section"
      aria-label="Cross-module linked master records and transactions"
      data-testid="order-linked-records-section"
    >
      <header className="cs-erp3-linked-header">
        <div className="cs-erp3-linked-title-group">
          <span className="cs-erp3-linked-icon" aria-hidden="true">🔗</span>
          <div>
            <h3 className="cs-erp3-linked-title">Linked Entity Records</h3>
            <p className="cs-erp3-linked-subtitle">
              CRM-1 customer master, ERP-1 product catalog, ERP-3 billing invoices, and ERP-4 payments
            </p>
          </div>
        </div>

        {/* Tab Navigation Controls */}
        <div
          className="cs-erp3-linked-tabs"
          role="tablist"
          aria-label="Linked records categories"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            className={`cs-erp3-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Linked Records ({totalCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'customer'}
            className={`cs-erp3-tab-btn ${activeTab === 'customer' ? 'active' : ''}`}
            onClick={() => setActiveTab('customer')}
          >
            CRM-1 Customer ({customer ? 1 : 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'products'}
            className={`cs-erp3-tab-btn ${activeTab === 'products' ? 'active' : ''}`}
            onClick={() => setActiveTab('products')}
          >
            ERP-1 Products ({products.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'invoices'}
            className={`cs-erp3-tab-btn ${activeTab === 'invoices' ? 'active' : ''}`}
            onClick={() => setActiveTab('invoices')}
          >
            Billing Invoices ({invoices.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'payments'}
            className={`cs-erp3-tab-btn ${activeTab === 'payments' ? 'active' : ''}`}
            onClick={() => setActiveTab('payments')}
          >
            ERP-4 Payments ({payments.length})
          </button>
        </div>
      </header>

      {/* 1. CRM-1 Customer Card */}
      {(activeTab === 'all' || activeTab === 'customer') && customer && (
        <div className="cs-erp3-subcard mb-4" data-testid="linked-customer-card">
          <header className="cs-erp3-subcard-header">
            <h4 className="text-sm font-semibold text-[var(--cs-text)]">
              CRM-1 Customer Profile & Identity
            </h4>
            <span className="text-xs text-[var(--cs-text-muted)]">Owning Module: CRM-1 Hub</span>
          </header>
          <div className="p-3 bg-[var(--cs-surface)] rounded border border-[var(--cs-border)] flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--cs-text)]">
                {customer.name || 'Enterprise Customer'}
              </p>
              <p className="text-xs text-[var(--cs-text-muted)]">
                Golden ID: <code className="cs-mono">{customer.goldenId}</code> • Email:{' '}
                {customer.email || '—'} • Tier: {customer.tier || 'Enterprise'}
              </p>
            </div>
            <a
              href={`/crm/customers/${customer.goldenId}`}
              className="cs-erp3-link text-xs font-medium text-[var(--color-primary)] hover:underline"
              onClick={(e) => handleLinkClick(e, 'crm-1', customer.goldenId)}
              aria-label={`View CRM-1 Customer ${customer.goldenId}`}
            >
              View in CRM-1 ↗
            </a>
          </div>
        </div>
      )}

      {/* 2. ERP-1 Catalog Products Sub-Table */}
      {(activeTab === 'all' || activeTab === 'products') && (
        <div className="cs-erp3-subcard mb-4" data-testid="linked-products-card">
          <header className="cs-erp3-subcard-header">
            <h4 className="text-sm font-semibold text-[var(--cs-text)]">
              ERP-1 Catalog Products ({products.length})
            </h4>
            <span className="text-xs text-[var(--cs-text-muted)]">Owning Module: ERP-1 Inventory</span>
          </header>
          {products.length === 0 ? (
            <p className="text-xs text-[var(--cs-text-muted)] p-3">No linked product lines recorded.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="cs-table" aria-label="Linked catalog products">
                <thead>
                  <tr>
                    <th scope="col">Product ID</th>
                    <th scope="col">SKU / Item</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Ordered Qty</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Unit Price</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, idx) => (
                    <tr key={`${p.productId}-${idx}`}>
                      <td className="cs-mono">{p.productId}</td>
                      <td>
                        <span className="font-medium">{p.name || 'Catalog Product'}</span>{' '}
                        <span className="text-xs text-[var(--cs-text-muted)] cs-mono">
                          ({p.sku || 'PRD'})
                        </span>
                      </td>
                      <td className="cs-mono" style={{ textAlign: 'right' }}>
                        {p.quantity}
                      </td>
                      <td className="cs-mono" style={{ textAlign: 'right' }}>
                        ${p.unitPrice} {p.currency}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <a
                          href={`/erp/products/${p.productId}`}
                          className="cs-erp3-link text-xs font-medium text-[var(--color-primary)] hover:underline"
                          onClick={(e) => handleLinkClick(e, 'erp-1', p.productId)}
                          aria-label={`View Product ${p.sku || p.productId}`}
                        >
                          View in Catalog ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 3. ERP-3 Billing Invoices Sub-Table */}
      {(activeTab === 'all' || activeTab === 'invoices') && (
        <div className="cs-erp3-subcard mb-4" data-testid="linked-invoices-card">
          <header className="cs-erp3-subcard-header">
            <h4 className="text-sm font-semibold text-[var(--cs-text)]">
              Billing Invoices ({invoices.length})
            </h4>
            <span className="text-xs text-[var(--cs-text-muted)]">Owning Module: ERP-3 Invoicing</span>
          </header>
          {invoices.length === 0 ? (
            <p className="text-xs text-[var(--cs-text-muted)] p-3">
              No invoices generated yet for this order.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="cs-table" aria-label="Linked billing invoices">
                <thead>
                  <tr>
                    <th scope="col">Invoice Number</th>
                    <th scope="col">Status</th>
                    <th scope="col">Due Date</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Invoice Total</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="cs-mono font-medium">{inv.invoiceNumber}</td>
                      <td>
                        <StatusBadge
                          label={inv.status}
                          variant={
                            inv.status === 'Paid'
                              ? 'success'
                              : inv.status === 'Overdue'
                              ? 'error'
                              : 'info'
                          }
                        />
                      </td>
                      <td>{inv.dueDate}</td>
                      <td className="cs-mono" style={{ textAlign: 'right' }}>
                        ${inv.total} {inv.currency}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <a
                          href={`/erp/invoices/${inv.id}`}
                          className="cs-erp3-link text-xs font-medium text-[var(--color-primary)] hover:underline"
                          onClick={(e) => handleLinkClick(e, 'erp-3', inv.id)}
                          aria-label={`View Invoice ${inv.invoiceNumber}`}
                        >
                          View Invoice ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. ERP-4 Accounting & Payments Sub-Table */}
      {(activeTab === 'all' || activeTab === 'payments') && (
        <div className="cs-erp3-subcard mb-4" data-testid="linked-payments-card">
          <header className="cs-erp3-subcard-header">
            <h4 className="text-sm font-semibold text-[var(--cs-text)]">
              ERP-4 Accounting & Payments ({payments.length})
            </h4>
            <span className="text-xs text-[var(--cs-text-muted)]">Owning Module: ERP-4 Finance</span>
          </header>
          {payments.length === 0 ? (
            <p className="text-xs text-[var(--cs-text-muted)] p-3">
              No payment receipts or general ledger postings recorded.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="cs-table" aria-label="Linked payments">
                <thead>
                  <tr>
                    <th scope="col">Payment Number</th>
                    <th scope="col">Method</th>
                    <th scope="col">Paid At</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Amount</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((pmt) => (
                    <tr key={pmt.id}>
                      <td className="cs-mono font-medium">{pmt.paymentNumber}</td>
                      <td>{pmt.method}</td>
                      <td>{pmt.paidAt}</td>
                      <td className="cs-mono" style={{ textAlign: 'right' }}>
                        ${pmt.amount} {pmt.currency}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <a
                          href={`/erp/payments/${pmt.id}`}
                          className="cs-erp3-link text-xs font-medium text-[var(--color-primary)] hover:underline"
                          onClick={(e) => handleLinkClick(e, 'erp-4', pmt.id)}
                          aria-label={`View Payment ${pmt.paymentNumber}`}
                        >
                          View Receipt ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default OrderLinkedRecordsTable;
