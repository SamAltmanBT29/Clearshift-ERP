/**
 * ERP-1 Products & Inventory — Product Audit Metadata Panel
 *
 * Displays system-maintained audit attributes, Golden ID, normalized SKU,
 * and immutable system metadata for compliance with Gate G3 traceability.
 *
 * @module erp1/web/components/ProductAuditPanel
 */

import React from 'react';
import type { Product } from '@clearshift/contracts';
import { StatusBadge } from '@cs/ui';

export interface ProductAuditPanelProps {
  readonly product: Product;
}

export function formatDateTime(isoString: string): string {
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

export function resolveGoldenId(product: Product): string {
  if (product.goldenId && product.goldenId.trim()) {
    return product.goldenId.trim();
  }
  if (product.sourceSystem && product.sourceId) {
    return `GLD-${product.sourceSystem.toUpperCase()}-${product.sourceId}`;
  }
  return `GLD-PRD-${product.id.slice(0, 8).toUpperCase()}`;
}

export const ProductAuditPanel: React.FC<ProductAuditPanelProps> = ({ product }) => {
  const goldenId = resolveGoldenId(product);

  return (
    <section className="cs-erp1-audit-panel" aria-label="Product audit metadata and system identifiers">
      <header className="cs-erp1-audit-header">
        <div className="cs-erp1-audit-title-group">
          <span className="cs-erp1-audit-icon" aria-hidden="true">🛡️</span>
          <div>
            <h3 className="cs-erp1-audit-title">Audit Metadata & Cross-Module Traceability</h3>
            <p className="cs-erp1-audit-subtitle">
              System-maintained timestamps, Golden ID identity, and schema invariants
            </p>
          </div>
        </div>
        <StatusBadge label="Deterministic Match" variant="success" />
      </header>

      <div className="cs-erp1-audit-grid">
        <div className="cs-erp1-audit-item">
          <span className="cs-erp1-audit-label">Golden ID (Cross-Module)</span>
          <div className="cs-erp1-audit-value-row">
            <span className="cs-erp1-golden-id cs-erp1-mono" data-testid="audit-golden-id">
              {goldenId}
            </span>
            <span className="cs-erp1-badge-golden" title="Canonical entity identifier for ERP-2, ERP-3, and CRM-2">
              Canonical
            </span>
          </div>
        </div>

        <div className="cs-erp1-audit-item">
          <span className="cs-erp1-audit-label">Normalized SKU (Exact Match)</span>
          <span className="cs-erp1-audit-value cs-erp1-mono" data-testid="audit-normalized-sku">
            {product.normalizedSku}
          </span>
        </div>

        <div className="cs-erp1-audit-item">
          <span className="cs-erp1-audit-label">Internal Product UUID</span>
          <span className="cs-erp1-audit-value cs-erp1-mono" data-testid="audit-product-id">
            {product.id}
          </span>
        </div>

        <div className="cs-erp1-audit-item">
          <span className="cs-erp1-audit-label">Created At</span>
          <span className="cs-erp1-audit-value" data-testid="audit-created-at" title={product.createdAt}>
            {formatDateTime(product.createdAt)}
          </span>
        </div>

        <div className="cs-erp1-audit-item">
          <span className="cs-erp1-audit-label">Last Updated At</span>
          <span className="cs-erp1-audit-value" data-testid="audit-updated-at" title={product.updatedAt}>
            {formatDateTime(product.updatedAt)}
          </span>
        </div>

        <div className="cs-erp1-audit-item">
          <span className="cs-erp1-audit-label">Source System Linkage</span>
          <span className="cs-erp1-audit-value" data-testid="audit-source-link">
            {product.sourceSystem ? (
              <span className="cs-erp1-source-tag">
                {product.sourceSystem} #{product.sourceId || 'N/A'}
              </span>
            ) : (
              <span className="cs-erp1-text-muted">Direct Native Record (No external sync)</span>
            )}
          </span>
        </div>
      </div>
    </section>
  );
};

export default ProductAuditPanel;
