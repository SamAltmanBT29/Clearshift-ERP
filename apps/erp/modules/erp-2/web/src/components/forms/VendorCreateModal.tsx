/**
 * ERP-2 Vendors & Purchasing — Vendor Creation Modal
 *
 * Provides an accessible modal dialog containing the vendor creation form,
 * real-time client-side field validation, double-submission prevention, and server
 * validation error mapping conforming to SDS §4.3 & §4.9.
 *
 * Conforms to Acceptance Criteria for Issue #136 (ERP2-20):
 * - AC1: Form validates required fields, email format, phone numbers, and decimal ranges before submission.
 * - AC2: Client submission button disables during inflight request to prevent double-submit.
 * - AC3: Server validation errors (400) map directly to corresponding input fields with error text.
 * - AC4: Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * @module erp2/web/components/forms/VendorCreateModal
 */

import React, { useState, useEffect } from 'react';
import type { Vendor } from '@clearshift/contracts';
import { Dialog } from '@cs/ui';
import { VendorForm, type VendorFormData } from './VendorForm.js';
import { createVendor } from '../../api/erp-2.js';

export interface VendorCreateModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onVendorCreated?: ((vendor: Vendor) => void) | undefined;
  readonly initialData?: Partial<Vendor> | undefined;
  /** Optional custom submit implementation for mocking / isolated testing */
  readonly onSubmitVendor?: ((data: VendorFormData) => Promise<Vendor>) | undefined;
  readonly className?: string | undefined;
}

export const VendorCreateModal: React.FC<VendorCreateModalProps> = ({
  isOpen,
  onClose,
  onVendorCreated,
  initialData,
  onSubmitVendor = createVendor,
  className = '',
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: VendorFormData) => {
    setIsSubmitting(true);
    try {
      const created = await onSubmitVendor({
        ...data,
        currency: data.currency || 'USD',
      });
      if (onVendorCreated) {
        onVendorCreated(created);
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Vendor"
      description="Register a new vendor master profile with masked banking coordinates (ERP-2)."
      className={`cs-erp2-create-modal ${className}`.trim()}
    >
      <div className="cs-erp2-modal-body" data-testid="vendor-create-modal">

        <VendorForm
          isEdit={false}
          initialData={initialData}
          onSubmit={handleSubmit}
          onCancel={onClose}
          isLoading={isSubmitting}
        />
      </div>
    </Dialog>
  );
};

export default VendorCreateModal;
