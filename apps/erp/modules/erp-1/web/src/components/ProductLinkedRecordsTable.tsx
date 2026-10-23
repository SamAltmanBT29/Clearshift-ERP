/**
 * ERP-1 Products & Inventory — Product Linked Records Sub-Tables
 *
 * Displays related master records across modules with deep navigation links:
 * - ERP-1 Warehouse Inventory & Stock Levels
 * - ERP-2 Purchasing (Purchase Order Lines & Vendors)
 * - ERP-3 Sales & Invoicing (Sales Order Lines & Customer Golden IDs)
 *
 * @module erp1/web/components/ProductLinkedRecordsTable
 */

import React, { useState } from 'react';
import type {
  ProductLinkedRecords,
  ProductWarehouseStockLinkedRecord,
  ProductPurchaseLineLinkedRecord,
  ProductSalesLineLinkedRecord,
} from '@clearshift/contracts';
import { StatusBadge } from '@cs/ui';

export interface ProductLinkedRecordsTableProps {
  readonly linkedRecords: ProductLinkedRecords | null;
  readonly isLoading?: boolean;
  readonly onNavigateModule?: ((module: 'erp2' | 'erp3' | 'erp1', recordId: string) => void) | undefined;
}

type TabType = 'all' | 'stock' | 'purchasing' | 'sales';

export const ProductLinkedRecordsTable: React.FC<ProductLinkedRecordsTableProps> = ({
  linkedRecords,
  isLoading = false,
  onNavigateModule,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('all');

  const stockLevels = linkedRecords?.stockLevels ?? [];
  const purchaseOrders = linkedRecords?.purchaseOrders ?? [];
  const salesOrders = linkedRecords?.salesOrders ?? [];

  const handleLinkClick = (
    e: React.MouseEvent,
    module: 'erp2' | 'erp3' | 'erp1',
    recordId: string,
    href: string
  ) => {
    if (onNavigateModule) {
      e.preventDefault();
      onNavigateModule(module, recordId);
    }
  };

  return (
    <section
      className="cs-erp1-linked-section"
      aria-label="Cross-module linked master records and transactions"
    >
      <header className="cs-erp1-linked-header">
        <div className="cs-erp1-linked-title-group">
          <span className="cs-erp1-linked-icon" aria-hidden="true">🔗</span>
          <div>
            <h3 className="cs-erp1-linked-title">Linked Entity Records</h3>
            <p className="cs-erp1-linked-subtitle">
              Inventory warehouse stocks, ERP-2 purchase lines, and ERP-3 sales orders
            </p>
          </div>
        </div>

        {/* Tab Navigation Controls */}
        <div className="cs-erp1-linked-tabs" role="tablist" aria-label="Linked records categories">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            className={`cs-erp1-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Linked Records ({stockLevels.length + purchaseOrders.length + salesOrders.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'stock'}
            className={`cs-erp1-tab-btn ${activeTab === 'stock' ? 'active' : ''}`}
            onClick={() => setActiveTab('stock')}
          >
            Warehouse Stock ({stockLevels.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'purchasing'}
            className={`cs-erp1-tab-btn ${activeTab === 'purchasing' ? 'active' : ''}`}
            onClick={() => setActiveTab('purchasing')}
          >
            ERP-2 Purchasing ({purchaseOrders.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sales'}
            className={`cs-erp1-tab-btn ${activeTab === 'sales' ? 'active' : ''}`}
            onClick={() => setActiveTab('sales')}
          >
            ERP-3 Sales ({salesOrders.length})
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="cs-erp1-linked-loading" role="status" aria-busy="true">
          <div className="cs-erp1-skeleton-row" style={{ height: '36px', marginBottom: '8px' }} />
          <div className="cs-erp1-skeleton-row" style={{ height: '48px', marginBottom: '8px' }} />
          <div className="cs-erp1-skeleton-row" style={{ height: '48px' }} />
          <span className="cs-erp1-sr-only">Loading linked records...</span>
        </div>
      ) : (
        <div className="cs-erp1-linked-content">
          {/* 1. Warehouse Stock Sub-Table */}
          {(activeTab === 'all' || activeTab === 'stock') && (
            <div className="cs-erp1-subtable-card" data-testid="linked-stock-card">
              <div className="cs-erp1-subtable-header">
                <h4 className="cs-erp1-subtable-title">
                  Warehouse Stock Levels (ERP-1 Inventory)
                </h4>
                <span className="cs-erp1-badge-count">{stockLevels.length} location(s)</span>
              </div>
              <div className="cs-erp1-table-responsive">
                <table className="cs-erp1-table" aria-label="Warehouse stock levels">
                  <thead>
                    <tr>
                      <th scope="col">Warehouse Code</th>
                      <th scope="col">Warehouse Name</th>
                      <th scope="col" className="cs-erp1-th-right">Quantity on Hand</th>
                      <th scope="col">Unit</th>
                      <th scope="col">Last Movement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockLevels.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="cs-erp1-empty-state-cell text-center py-4">
                          No warehouse stock recorded for this product (BR-ERP1-02).
                        </td>
                      </tr>
                    ) : (
                      stockLevels.map((stock: ProductWarehouseStockLinkedRecord) => (
                        <tr key={stock.warehouseId}>
                          <td>
                            <code className="cs-erp1-sku-code">{stock.warehouseCode}</code>
                          </td>
                          <td>
                            <span className="cs-erp1-product-name">{stock.warehouseName}</span>
                          </td>
                          <td className="cs-erp1-cell-right">
                            <span className="cs-erp1-price-amount cs-erp1-mono">
                              {Number(stock.quantity).toFixed(2)}
                            </span>
                          </td>
                          <td>
                            <span className="cs-erp1-unit-pill">{stock.unitOfMeasure}</span>
                          </td>
                          <td>
                            <span className="cs-erp1-text-muted" title={stock.updatedAt}>
                              {new Date(stock.updatedAt).toLocaleDateString()}
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

          {/* 2. ERP-2 Purchasing Sub-Table */}
          {(activeTab === 'all' || activeTab === 'purchasing') && (
            <div className="cs-erp1-subtable-card" data-testid="linked-purchasing-card">
              <div className="cs-erp1-subtable-header">
                <h4 className="cs-erp1-subtable-title">
                  Purchase Order Lines (ERP-2 Purchasing)
                </h4>
                <span className="cs-erp1-badge-count">{purchaseOrders.length} order(s)</span>
              </div>
              <div className="cs-erp1-table-responsive">
                <table className="cs-erp1-table" aria-label="Linked purchase order lines">
                  <thead>
                    <tr>
                      <th scope="col">PO Number</th>
                      <th scope="col">Vendor / Supplier</th>
                      <th scope="col">Order Date</th>
                      <th scope="col" className="cs-erp1-th-right">Quantity</th>
                      <th scope="col" className="cs-erp1-th-right">Unit Price</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseOrders.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="cs-erp1-empty-state-cell text-center py-4">
                          No purchase orders linked to this product.
                        </td>
                      </tr>
                    ) : (
                      purchaseOrders.map((po: ProductPurchaseLineLinkedRecord) => {
                        const href = `/erp2/purchase-orders/${po.purchaseOrderId}`;
                        return (
                          <tr key={po.id}>
                            <td>
                              <a
                                href={href}
                                className="cs-erp1-module-link cs-erp1-mono"
                                onClick={(e) => handleLinkClick(e, 'erp2', po.purchaseOrderId, href)}
                                aria-label={`View Purchase Order ${po.poNumber}`}
                              >
                                {po.poNumber} ↗
                              </a>
                            </td>
                            <td>
                              <span className="cs-erp1-vendor-name">{po.vendorName}</span>
                            </td>
                            <td>{po.orderDate}</td>
                            <td className="cs-erp1-cell-right cs-erp1-mono">{po.quantity}</td>
                            <td className="cs-erp1-cell-right cs-erp1-mono">
                              ${Number(po.unitPrice).toFixed(2)} {po.currency}
                            </td>
                            <td>
                              <StatusBadge
                                label={po.status.toUpperCase()}
                                variant={po.status === 'received' ? 'success' : 'neutral'}
                              />
                            </td>
                            <td>
                              <a
                                href={href}
                                className="cs-erp1-link-btn"
                                onClick={(e) => handleLinkClick(e, 'erp2', po.purchaseOrderId, href)}
                              >
                                View PO
                              </a>
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

          {/* 3. ERP-3 Sales & Invoicing Sub-Table */}
          {(activeTab === 'all' || activeTab === 'sales') && (
            <div className="cs-erp1-subtable-card" data-testid="linked-sales-card">
              <div className="cs-erp1-subtable-header">
                <h4 className="cs-erp1-subtable-title">
                  Sales Order & Invoice Lines (ERP-3 Sales)
                </h4>
                <span className="cs-erp1-badge-count">{salesOrders.length} order(s)</span>
              </div>
              <div className="cs-erp1-table-responsive">
                <table className="cs-erp1-table" aria-label="Linked sales order lines">
                  <thead>
                    <tr>
                      <th scope="col">Order Number</th>
                      <th scope="col">Customer Golden ID</th>
                      <th scope="col">Order Date</th>
                      <th scope="col" className="cs-erp1-th-right">Quantity</th>
                      <th scope="col" className="cs-erp1-th-right">Unit Price</th>
                      <th scope="col" className="cs-erp1-th-right">Line Total</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesOrders.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="cs-erp1-empty-state-cell text-center py-4">
                          No sales orders or invoices linked to this product.
                        </td>
                      </tr>
                    ) : (
                      salesOrders.map((so: ProductSalesLineLinkedRecord) => {
                        const href = `/erp3/orders/${so.orderId}`;
                        return (
                          <tr key={so.id}>
                            <td>
                              <a
                                href={href}
                                className="cs-erp1-module-link cs-erp1-mono"
                                onClick={(e) => handleLinkClick(e, 'erp3', so.orderId, href)}
                                aria-label={`View Sales Order ${so.orderNumber}`}
                              >
                                {so.orderNumber} ↗
                              </a>
                            </td>
                            <td>
                              <span className="cs-erp1-golden-id cs-erp1-mono" title="Customer Golden ID">
                                {so.customerGoldenId}
                              </span>
                            </td>
                            <td>{so.orderDate}</td>
                            <td className="cs-erp1-cell-right cs-erp1-mono">{so.quantity}</td>
                            <td className="cs-erp1-cell-right cs-erp1-mono">
                              ${Number(so.unitPrice).toFixed(2)}
                            </td>
                            <td className="cs-erp1-cell-right cs-erp1-mono" style={{ fontWeight: 600 }}>
                              ${Number(so.lineTotal).toFixed(2)} {so.currency}
                            </td>
                            <td>
                              <StatusBadge
                                label={so.status.toUpperCase()}
                                variant={so.status === 'invoiced' ? 'success' : 'neutral'}
                              />
                            </td>
                            <td>
                              <a
                                href={href}
                                className="cs-erp1-link-btn"
                                onClick={(e) => handleLinkClick(e, 'erp3', so.orderId, href)}
                              >
                                View Order
                              </a>
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
        </div>
      )}
    </section>
  );
};

export default ProductLinkedRecordsTable;
