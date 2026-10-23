/**
 * ERP-2 Vendors & Purchasing — Relationship Rules, State Transitions & Read Model Consistency
 *
 * Deterministic domain layer for ERP-2 (Issue #21 / ERP2-06):
 *   - Relationships: validation of required links before commit; absent optional links
 *     produce approved warnings (ERP2_OPTIONAL_REFERENCE_ABSENT) instead of synthetic records
 *   - Provenance completeness: source_system and source_id must be supplied as a pair
 *   - Enumerations: strict status and currency validation outside and inside HTTP boundary
 *   - State transitions: unidirectional status progression (Draft -> Sent -> Received -> Closed)
 *     with exact failure codes and allowed sets
 *   - Read model consistency: guarantees that persisted entities and their public projections
 *     agree on status, links, line totals, and order sum immediately after write
 *
 * Side-effect free: no I/O, no database connection, no network calls.
 *
 * @module erp2/domain/relationships
 */

import Decimal from 'decimal.js';
import {
  ERP2_DOMAIN_RULES,
  ERP2_OPTIONAL_REFERENCE_ABSENT,
  ERP2_PURCHASE_ORDER_STATUS_TRANSITIONS,
  ERP2_PURCHASE_ORDER_STATUSES,
  ERP2_PURCHASE_ORDER_TERMINAL_STATUSES,
  type Erp2RelationshipWarning,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type Vendor,
} from '@clearshift/contracts';
import { Erp2DomainError } from './rules.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Optional Relationship Handling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles an optional relationship link.
 *
 * If the link is absent, the module returns the approved warning and keeps
 * the value `null` — it never materialises a placeholder or synthetic record.
 */
export function handleOptionalRelationship<T>(
  value: T | null | undefined,
  fieldName: string,
  relationshipName: string
): { value: T | null; warning?: Erp2RelationshipWarning } {
  if (value === null || value === undefined || value === '') {
    return {
      value: null,
      warning: {
        relationship: relationshipName,
        field: fieldName,
        code: ERP2_OPTIONAL_REFERENCE_ABSENT,
        message: `Optional relationship "${relationshipName}" on field "${fieldName}" is absent. No synthetic record was created.`,
      },
    };
  }
  return { value };
}

/**
 * The source identity is a pair: `source_system` and `source_id`.
 * A partial source identity is invalid — it claims provenance without identifying
 * the row, or identifies a row without naming the source system.
 */
export function assertSourceIdentityIsComplete(
  sourceSystem: string | null | undefined,
  sourceId: string | null | undefined
): void {
  const hasSystem = sourceSystem !== null && sourceSystem !== undefined && sourceSystem !== '';
  const hasId = sourceId !== null && sourceId !== undefined && sourceId !== '';

  if (hasSystem !== hasId) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE,
      'source_system and source_id must be supplied together — a partial source identity is not a valid state.',
      hasSystem ? 'source_id' : 'source_system',
      { source_system: sourceSystem, source_id: sourceId }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Enumeration Validations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a status string is a valid PurchaseOrderStatus enumeration.
 */
export function assertValidPurchaseOrderStatus(value: string): asserts value is PurchaseOrderStatus {
  if (!(ERP2_PURCHASE_ORDER_STATUSES as readonly string[]).includes(value)) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.INVALID_PO_STATUS,
      `The purchase order status "${value}" is not one of the approved values [${ERP2_PURCHASE_ORDER_STATUSES.join(', ')}].`,
      'status',
      { allowed: [...ERP2_PURCHASE_ORDER_STATUSES], received: value }
    );
  }
}

/**
 * Validates ISO 4217 3-letter currency code (e.g. USD, EUR, INR).
 */
export function assertValidCurrencyCode(currency: string): void {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.INVALID_CURRENCY_CODE,
      `Currency "${currency}" is invalid. Must be an ISO 4217 3-letter uppercase code.`,
      'currency',
      { currency }
    );
  }
}

/**
 * V1 currency rule: sales orders, purchase orders and their vendors/invoices
 * operate in matching currencies with no FX conversion.
 */
export function assertVendorCurrencyConsistency(
  vendorCurrency: string,
  poCurrency: string
): void {
  if (vendorCurrency.toUpperCase() !== poCurrency.toUpperCase()) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.CURRENCY_MISMATCH,
      `Purchase order currency (${poCurrency}) does not match vendor default currency (${vendorCurrency}). FX conversion is not supported in V1.`,
      'currency',
      { vendorCurrency, poCurrency }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Purchase Order State Transition Matrix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enforces the strict V1 purchase order state transitions:
 *   Draft -> Sent -> Received -> Closed
 *
 * - Setting the identical status is a valid no-op.
 * - Closed is terminal: no further transitions are allowed.
 * - Skipping states or backward transitions are forbidden.
 */
export function assertPurchaseOrderStatusTransition(
  current: PurchaseOrderStatus,
  next: PurchaseOrderStatus
): void {
  if (current === next) {
    return;
  }

  const allowed = ERP2_PURCHASE_ORDER_STATUS_TRANSITIONS[current] ?? [];

  if (!allowed.includes(next)) {
    const isTerminal = (ERP2_PURCHASE_ORDER_TERMINAL_STATUSES as readonly string[]).includes(current);
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.INVALID_STATUS_TRANSITION,
      isTerminal
        ? `A purchase order in terminal status "${current}" cannot transition to "${next}". Allowed transitions from "${current}": none.`
        : `Cannot transition purchase order from '${current}' to '${next}'. Allowed forward flow is Draft -> Sent -> Received -> Closed.`,
      'status',
      {
        current_status: current,
        requested_status: next,
        allowed: [...allowed],
        terminal: isTerminal,
      }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Read Model Consistency Assertions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asserts that a Vendor record adheres to read model consistency.
 */
export function assertVendorReadConsistency(vendor: Vendor): void {
  if (!vendor.id || !vendor.name || !vendor.tax_number || !vendor.email) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'Vendor read model is missing mandatory fields.',
      'vendor'
    );
  }

  if (vendor.bank_masked !== null && !/^XXXX-XXXX-\d{4}$/.test(vendor.bank_masked)) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      `Vendor bank details are not correctly masked in read projection: "${vendor.bank_masked}".`,
      'bank_masked'
    );
  }

  assertValidCurrencyCode(vendor.currency);
  assertSourceIdentityIsComplete(vendor.source_system, vendor.source_id);
}

/**
 * Asserts that a PurchaseOrder record and its lines adhere to read model consistency:
 * - Line totals exactly equal round(quantity * price, 2)
 * - Order total exactly equals sum of line totals
 * - Valid status and currency
 */
export function assertPurchaseOrderReadConsistency(po: PurchaseOrder): void {
  if (!po.id || !po.po_number || !po.vendor_id || !po.order_date || !po.currency) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'Purchase order read model is missing mandatory fields.',
      'purchase_order'
    );
  }

  assertValidPurchaseOrderStatus(po.status);
  assertValidCurrencyCode(po.currency);

  if (!po.lines || po.lines.length === 0) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'Purchase order read model must contain at least one line.',
      'lines'
    );
  }

  let calculatedSum = new Decimal(0);

  for (let i = 0; i < po.lines.length; i++) {
    const line = po.lines[i]!;
    if (!line.id || !line.po_id || !line.product_id) {
      throw new Erp2DomainError(
        ERP2_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
        `Purchase order line ${i + 1} is missing mandatory references.`,
        `lines.${i}`
      );
    }

    const qty = new Decimal(line.quantity);
    const price = new Decimal(line.price);
    const expectedLineTotal = qty.times(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

    if (line.line_total !== expectedLineTotal) {
      throw new Erp2DomainError(
        ERP2_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
        `Purchase order line ${i + 1} line_total (${line.line_total}) does not match computed quantity * price (${expectedLineTotal}).`,
        `lines.${i}.line_total`,
        { line_total: line.line_total, expected: expectedLineTotal }
      );
    }

    calculatedSum = calculatedSum.plus(new Decimal(line.line_total));
  }

  const expectedTotal = calculatedSum.toFixed(2);
  if (po.total !== expectedTotal) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      `Purchase order total (${po.total}) does not match sum of line totals (${expectedTotal}).`,
      'total',
      { total: po.total, expectedTotal }
    );
  }
}
