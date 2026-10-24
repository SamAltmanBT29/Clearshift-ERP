/**
 * ERP-2 Vendors & Purchasing — Purchase Order Creation Modal
 *
 * Provides an accessible modal dialog containing the purchase order creation form,
 * line item management, live decimal total computation, double-submission prevention,
 * and server validation error mapping conforming to SDS §4.3 & §4.9.
 *
 * Conforms to Acceptance Criteria for Issue #136 (ERP2-20):
 * - AC1: Form validates required fields, decimal ranges, and product line items before submission.
 * - AC2: Client submission button disables during inflight request to prevent double-submit.
 * - AC3: Server validation errors (400) map directly to corresponding input fields with error text.
 * - AC4: Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * @module erp2/web/components/forms/PurchaseOrderCreateModal
 */

import React, { useState, useEffect } from 'react';
import type { PurchaseOrder, CreatePurchaseOrderRequest } from '@clearshift/contracts';
import { Dialog } from '@cs/ui';
import { PurchaseOrderForm } from './PurchaseOrderForm.js';
import { createPurchaseOrder } from '../../api/erp-2.js';

export interface PurchaseOrderCreateModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly initialVendorId?: string | undefined;
  readonly onOrderCreated?: ((order: PurchaseOrder) => void) | undefined;
  /** Optional custom submit implementation for mocking / isolated testing */
  readonly onSubmitOrder?: ((data: CreatePurchaseOrderRequest) => Promise<PurchaseOrder>) | undefined;
  readonly className?: string | undefined;
}

export const PurchaseOrderCreateModal: React.FC<PurchaseOrderCreateModalProps> = ({
  isOpen,
  onClose,
  initialVendorId = '',
  onOrderCreated,
  onSubmitOrder = createPurchaseOrder,
  className = '',
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: CreatePurchaseOrderRequest) => {
    setIsSubmitting(true);
    try {
      const created = await onSubmitOrder(data);
      if (onOrderCreated) {
        onOrderCreated(created);
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
      title="Create Purchase Order"
      description="Issue a new purchase order to a registered vendor with product-linked line items (ERP-2)."
      className={`cs-erp2-create-modal cs-erp2-po-create-modal ${className}`.trim()}
    >
      <div className="cs-erp2-modal-body" data-testid="po-create-modal">

        <PurchaseOrderForm
          initialVendorId={initialVendorId}
          onSubmit={handleSubmit}
          onCancel={onClose}
          isLoading={isSubmitting}
        />
      </div>
    </Dialog>
  );
};

export default PurchaseOrderCreateModal;
