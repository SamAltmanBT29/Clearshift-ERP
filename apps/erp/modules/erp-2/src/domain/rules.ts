/**
 * ERP-2 Vendors & Purchasing — Pure Domain Rules
 *
 * Side-effect free domain invariants for ERP-2:
 *   - FR-ERP2-02, FR-ERP2-06: Bank details masking (XXXX-XXXX-7890)
 *   - FR-ERP2-04: Strict unidirectional status transitions (Draft -> Sent -> Received -> Closed)
 *   - FR-ERP2-05: Server-side decimal calculation for line totals and order totals
 *   - BR-ERP2-01: Line quantity > 0 and price >= 0 validations
 *
 * @module erp2/domain/rules
 */

import Decimal from 'decimal.js';
import type { PurchaseOrderStatus } from '@clearshift/contracts';

export class Erp2DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'Erp2DomainError';
  }
}

/**
 * FR-ERP2-02, FR-ERP2-06: Masks sensitive bank account details.
 * Format is always XXXX-XXXX-7890 where 7890 is the last 4 digits.
 */
export function maskBankDetails(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\D/g, '');
  if (cleaned.length < 4) {
    // If fewer than 4 digits, pad with trailing chars
    const last = raw.slice(-4);
    return `XXXX-XXXX-${last.padStart(4, '0')}`;
  }
  const last4 = cleaned.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

/**
 * Validates bank details input format.
 */
export function assertValidBankDetails(bankDetails?: string | null): void {
  if (bankDetails === undefined || bankDetails === null) return;
  if (typeof bankDetails !== 'string' || bankDetails.trim().length < 4) {
    throw new Erp2DomainError(
      'INVALID_BANK_DETAILS',
      'Bank details must contain at least 4 characters',
      'bank_details'
    );
  }
}

/**
 * Allowed unidirectional transitions:
 * Draft -> Sent -> Received -> Closed
 */
export const ALLOWED_PO_STATUS_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  Draft: ['Sent'],
  Sent: ['Received'],
  Received: ['Closed'],
  Closed: [],
};

/**
 * FR-ERP2-04: Validates purchase order status transition.
 * Reversing or skipping states is rejected with INVALID_STATUS_TRANSITION.
 */
export function assertValidPoStatusTransition(
  currentStatus: PurchaseOrderStatus,
  targetStatus: PurchaseOrderStatus
): void {
  const allowed = ALLOWED_PO_STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new Erp2DomainError(
      'INVALID_STATUS_TRANSITION',
      `Cannot transition purchase order from '${currentStatus}' to '${targetStatus}'. Allowed forward flow is Draft -> Sent -> Received -> Closed.`,
      'status',
      { currentStatus, targetStatus, allowed }
    );
  }
}

export interface RawPoLineInput {
  product_id: string;
  quantity: string | number;
  price: string | number;
}

export interface CalculatedPoLine {
  product_id: string;
  quantity: string;
  price: string;
  line_total: string;
}

/**
 * FR-ERP2-05: Recomputes line totals and overall PO total using Decimal arithmetic.
 */
export function calculatePoLinesAndTotal(lines: RawPoLineInput[]): {
  lines: CalculatedPoLine[];
  total: string;
} {
  if (!lines || lines.length === 0) {
    throw new Erp2DomainError(
      'EMPTY_ORDER_LINES',
      'A purchase order must contain at least one line',
      'lines'
    );
  }

  let totalDecimal = new Decimal(0);

  const calculatedLines: CalculatedPoLine[] = lines.map((line, index) => {
    let qty: Decimal;
    let price: Decimal;

    try {
      qty = new Decimal(line.quantity);
    } catch {
      throw new Erp2DomainError(
        'INVALID_QUANTITY',
        `Line ${index + 1} quantity is invalid: ${line.quantity}`,
        `lines.${index}.quantity`
      );
    }

    try {
      price = new Decimal(line.price);
    } catch {
      throw new Erp2DomainError(
        'INVALID_PRICE',
        `Line ${index + 1} price is invalid: ${line.price}`,
        `lines.${index}.price`
      );
    }

    if (qty.lessThanOrEqualTo(0)) {
      throw new Erp2DomainError(
        'QUANTITY_MUST_BE_POSITIVE',
        `Line ${index + 1} quantity must be greater than 0`,
        `lines.${index}.quantity`
      );
    }

    if (price.lessThan(0)) {
      throw new Erp2DomainError(
        'PRICE_MUST_BE_NON_NEGATIVE',
        `Line ${index + 1} price must be greater than or equal to 0`,
        `lines.${index}.price`
      );
    }

    const lineTotal = qty.times(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    totalDecimal = totalDecimal.plus(lineTotal);

    return {
      product_id: line.product_id,
      quantity: qty.toFixed(2),
      price: price.toFixed(2),
      line_total: lineTotal.toFixed(2),
    };
  });

  return {
    lines: calculatedLines,
    total: totalDecimal.toFixed(2),
  };
}
