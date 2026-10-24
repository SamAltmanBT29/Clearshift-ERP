import React, { useState } from 'react';
import type { Vendor } from '@clearshift/contracts';
import { updateVendor, ApiError } from '../api/erp-2.js';
import { VendorForm, type VendorFormData } from './forms/VendorForm.js';

export interface VendorEditDrawerProps {
  isOpen: boolean;
  vendor: Vendor;
  canEdit?: boolean;
  onClose: () => void;
  onVendorUpdated: (updated: Vendor) => void;
  onConflict?: (error: ApiError) => void;
}

export const VendorEditDrawer: React.FC<VendorEditDrawerProps> = ({
  isOpen,
  vendor,
  canEdit = true,
  onClose,
  onVendorUpdated,
  onConflict,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (data: VendorFormData) => {
    setIsSubmitting(true);
    setServerError(null);

    try {
      const updated = await updateVendor(vendor.id, {
        name: data.name,
        tax_number: data.tax_number,
        email: data.email,
        phone: data.phone || undefined,
        address_line: data.address_line || undefined,
        city: data.city || undefined,
        country: data.country || undefined,
        bank_details: data.bank_details || undefined,
        currency: data.currency,
      });
      onVendorUpdated(updated);
      onClose();
    } catch (err: any) {
      if (err?.status === 409 || err?.code === 'CONFLICT') {
        if (onConflict) {
          onConflict(err);
        }
        onClose();
        return;
      }
      setServerError(err?.message || 'Failed to update vendor record.');
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="cs-drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-drawer-title"
      data-testid="vendor-edit-drawer"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        className="cs-drawer-content"
        style={{
          width: '100%',
          maxWidth: '560px',
          height: '100%',
          backgroundColor: 'var(--color-bg-surface, #ffffff)',
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2 id="vendor-drawer-title" style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
              Edit Vendor Profile
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              Update allowlisted procurement attributes for <span className="cs-cell-mono">{vendor.name}</span>
            </p>
          </div>
          <button
            type="button"
            className="cs-button cs-button-secondary"
            onClick={onClose}
            aria-label="Close edit drawer"
            style={{ padding: '4px 10px' }}
          >
            ✕
          </button>
        </div>

        {!canEdit && (
          <div
            className="cs-error-box"
            role="alert"
            data-testid="drawer-permission-denied"
            style={{ marginBottom: '16px' }}
          >
            <p className="cs-error-title" style={{ margin: 0, fontWeight: 600 }}>
              Access Denied: Insufficient Permissions
            </p>
            <p className="cs-error-desc" style={{ margin: '4px 0 0', fontSize: '13px' }}>
              Your session lacks the required <code>erp:vendors:write</code> permission to edit vendor records.
            </p>
          </div>
        )}

        {serverError && (
          <div className="cs-error-box" role="alert" style={{ marginBottom: '16px' }}>
            <p className="cs-error-desc" style={{ margin: 0 }}>
              {serverError}
            </p>
          </div>
        )}

        {canEdit && (
          <VendorForm
            initialData={vendor}
            isEdit={true}
            onSubmit={handleSubmit}
            onCancel={onClose}
            isLoading={isSubmitting}
          />
        )}
      </div>
    </div>
  );
};
