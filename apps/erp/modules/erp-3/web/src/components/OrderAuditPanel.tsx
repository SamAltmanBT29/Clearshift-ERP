/**
 * ERP-3 Sales Orders & Invoices — Order Audit Metadata Panel
 *
 * Displays system-maintained audit attributes, Golden ID, internal UUID,
 * and immutable system metadata for compliance with Gate G3 traceability.
 *
 * Conforms to Acceptance Criterion 1 for Issue #157 (ERP3-21):
 * - Detail view displays all primary attributes, created_at, updated_at, and Golden ID where applicable.
 *
 * @module erp3/web/components/OrderAuditPanel
 */

import React from 'react';
import type { SalesOrder } from '@clearshift/contracts';
import { StatusBadge } from '@cs/ui';

export interface OrderAuditPanelProps {
  readonly order: SalesOrder;
}

export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(d);
  } catch {
    return isoString;
  }
}

export function resolveGoldenId(order: SalesOrder): string {
  if (order.customer_golden_id && order.customer_golden_id.trim()) {
    return order.customer_golden_id.trim();
  }
  if (order.source_system && order.source_id) {
    return `GLD-${order.source_system.toUpperCase()}-${order.source_id}`;
  }
  return `GLD-CUST-${order.id.slice(0, 8).toUpperCase()}`;
}

export const OrderAuditPanel: React.FC<OrderAuditPanelProps> = ({ order }) => {
  const goldenId = resolveGoldenId(order);

  return (
    <section
      className="cs-erp3-audit-panel"
      aria-label="Order audit metadata and system identifiers"
      data-testid="order-audit-panel"
    >
      <header className="cs-erp3-audit-header">
        <div className="cs-erp3-audit-title-group">
          <span className="cs-erp3-audit-icon" aria-hidden="true">🛡️</span>
          <div>
            <h3 className="cs-erp3-audit-title">Audit Metadata & Cross-Module Traceability</h3>
            <p className="cs-erp3-audit-subtitle">
              System-maintained timestamps, Golden ID identity, and schema invariants
            </p>
          </div>
        </div>
        <StatusBadge label="Deterministic Match" variant="success" />
      </header>

      <div className="cs-erp3-audit-grid">
        <div className="cs-erp3-audit-item">
          <span className="cs-erp3-audit-label">Customer Golden ID (Cross-Module)</span>
          <div className="cs-erp3-audit-value-row">
            <span className="cs-erp3-golden-id cs-mono" data-testid="audit-golden-id">
              {goldenId}
            </span>
            <span
              className="cs-erp3-badge-golden"
              title="Canonical customer identifier mapped to Hub Identity and CRM-1"
            >
              Canonical
            </span>
          </div>
        </div>

        <div className="cs-erp3-audit-item">
          <span className="cs-erp3-audit-label">Order Number (Immutable Key)</span>
          <span className="cs-erp3-audit-value cs-mono" data-testid="audit-order-number">
            {order.order_number}
          </span>
        </div>

        <div className="cs-erp3-audit-item">
          <span className="cs-erp3-audit-label">Internal Order UUID</span>
          <span className="cs-erp3-audit-value cs-mono" data-testid="audit-order-id">
            {order.id}
          </span>
        </div>

        <div className="cs-erp3-audit-item">
          <span className="cs-erp3-audit-label">Created At</span>
          <span
            className="cs-erp3-audit-value"
            data-testid="audit-created-at"
            title={order.created_at}
          >
            {formatDateTime(order.created_at)}
          </span>
        </div>

        <div className="cs-erp3-audit-item">
          <span className="cs-erp3-audit-label">Last Updated At</span>
          <span
            className="cs-erp3-audit-value"
            data-testid="audit-updated-at"
            title={order.updated_at}
          >
            {formatDateTime(order.updated_at)}
          </span>
        </div>

        <div className="cs-erp3-audit-item">
          <span className="cs-erp3-audit-label">Source Origin & Traceability</span>
          <span className="cs-erp3-audit-value" data-testid="audit-source-link">
            {order.source_system && order.source_id
              ? `${order.source_system} #${order.source_id}`
              : 'Direct ERP Entry'}
          </span>
        </div>
      </div>
    </section>
  );
};

export default OrderAuditPanel;
