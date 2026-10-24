import React from 'react';
import type { Vendor } from '@clearshift/contracts';

export interface VendorAuditPanelProps {
  vendor: Vendor;
}

/**
 * Resolves the canonical Golden ID for an ERP-2 Vendor.
 * If an explicit golden_id attribute is present, uses it.
 * Otherwise deterministically derives from source_id or internal UUID.
 */
export function resolveVendorGoldenId(vendor: Vendor): string {
  if ((vendor as any).golden_id && typeof (vendor as any).golden_id === 'string' && (vendor as any).golden_id.trim()) {
    return (vendor as any).golden_id.trim();
  }
  if (vendor.source_id && vendor.source_id.trim()) {
    const cleanId = vendor.source_id.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return `GID-VENDOR-${cleanId}`;
  }
  const cleanId = vendor.id.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `GID-VENDOR-${cleanId}`;
}

export const VendorAuditPanel: React.FC<VendorAuditPanelProps> = ({ vendor }) => {
  const goldenId = resolveVendorGoldenId(vendor);
  const createdDate = vendor.created_at ? new Date(vendor.created_at).toLocaleString() : '—';
  const updatedDate = vendor.updated_at ? new Date(vendor.updated_at).toLocaleString() : '—';

  return (
    <div className="cs-card cs-erp2-audit-panel" data-testid="vendor-audit-panel" style={{ marginTop: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h3 className="cs-section-subtitle" style={{ margin: 0 }}>
            Audit Metadata & Canonical Identity
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>
            System-maintained timestamps, Golden ID identity, and data protection status
          </p>
        </div>
        <span className="cs-badge cs-badge-golden" data-testid="golden-id-badge" style={{ fontSize: '12px' }}>
          Golden Master
        </span>
      </div>

      <div className="cs-detail-grid">
        <div className="cs-detail-item">
          <span className="cs-detail-label">Golden ID (Cross-Module)</span>
          <span className="cs-detail-value" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="cs-cell-mono cs-golden-id" data-testid="audit-golden-id" style={{ fontWeight: 600 }}>
              {goldenId}
            </span>
          </span>
        </div>

        <div className="cs-detail-item">
          <span className="cs-detail-label">Internal Record UUID</span>
          <span className="cs-detail-value cs-cell-mono" data-testid="audit-record-id">
            {vendor.id}
          </span>
        </div>

        <div className="cs-detail-item">
          <span className="cs-detail-label">Created At</span>
          <span className="cs-detail-value" data-testid="audit-created-at">
            {createdDate}
          </span>
        </div>

        <div className="cs-detail-item">
          <span className="cs-detail-label">Last Updated At</span>
          <span className="cs-detail-value" data-testid="audit-updated-at">
            {updatedDate}
          </span>
        </div>

        <div className="cs-detail-item">
          <span className="cs-detail-label">Source System</span>
          <span className="cs-detail-value cs-cell-mono" data-testid="audit-source-system">
            {vendor.source_system || 'ClearShift Master'}
          </span>
        </div>

        <div className="cs-detail-item">
          <span className="cs-detail-label">Source Record ID</span>
          <span className="cs-detail-value cs-cell-mono" data-testid="audit-source-id">
            {vendor.source_id || '—'}
          </span>
        </div>

        <div className="cs-detail-item" style={{ gridColumn: 'span 2' }}>
          <span className="cs-detail-label">Data Protection & Masking</span>
          <span className="cs-detail-value" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="cs-badge cs-badge-active" style={{ fontSize: '11px' }}>
              PCI/GDPR Compliant
            </span>
            <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
              Bank details masked server-side ({vendor.bank_masked || 'No banking details recorded'})
            </span>
          </span>
        </div>
      </div>
    </div>
  );
};
