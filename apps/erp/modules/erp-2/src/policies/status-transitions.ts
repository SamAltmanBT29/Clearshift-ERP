/**
 * ERP-2 Purchase Order Lifecycle State Machine Policy
 *
 * Implements:
 *   - FR-ERP2-04: Allowed purchase-order status flow is Draft -> Sent -> Received -> Closed.
 *   - Backwards transitions and cancellation are not supported in V1.
 *   - Changing PO status to Received does not change inventory because goods receipts are V2.
 *
 * @module erp2/policies/status-transitions
 */

import type { PurchaseOrderStatus } from '@clearshift/contracts';

export const ALLOWED_STATUS_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  Draft: ['Sent'],
  Sent: ['Received'],
  Received: ['Closed'],
  Closed: [], // Terminal state in V1
};

export interface StatusTransitionResult {
  valid: boolean;
  message?: string;
}

export function validateStatusTransition(
  currentStatus: PurchaseOrderStatus,
  targetStatus: PurchaseOrderStatus
): StatusTransitionResult {
  if (currentStatus === targetStatus) {
    return {
      valid: false,
      message: `Purchase order is already in status '${currentStatus}'.`,
    };
  }

  const allowedNext = ALLOWED_STATUS_TRANSITIONS[currentStatus] ?? [];

  if (!allowedNext.includes(targetStatus)) {
    return {
      valid: false,
      message: `Invalid status transition from '${currentStatus}' to '${targetStatus}'. Allowed transitions: ${
        allowedNext.length > 0 ? allowedNext.join(', ') : 'none (terminal state)'
      }. Backwards transitions and cancellations are not permitted in V1.`,
    };
  }

  return { valid: true };
}
