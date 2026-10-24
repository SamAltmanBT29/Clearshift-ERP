/**
 * ERP-3 Sales Orders & Invoices — Relationship Rules, State Transitions & Read Model Consistency
 *
 * Deterministic domain layer for ERP-3 (Issue #31 / ERP3-06):
 *   - Relationships: validation of required intra-module and cross-module links before commit;
 *     absent optional links produce approved warnings (`ERP3_OPTIONAL_REFERENCE_ABSENT`) instead
 *     of synthetic records.
 *   - Provenance completeness: `source_system` and `source_id` must be supplied as a complete pair.
 *   - Enumerations: strict status (`SalesOrderStatus`, `InvoiceStatus`), payment method (`PaymentMethod`),
 *     and ISO 4217 currency validation inside and outside the HTTP boundary.
 *   - State transitions: forward-only Sales Order status matrix (`Open -> Invoiced -> Closed`) and
 *     Invoice status matrix (`Open -> Paid | Overdue`, `Overdue -> Paid`, `Paid` terminal) with
 *     deterministic failure codes and allowed sets.
 *   - Cross-module safety: read-only reference resolution via `@cs/kernel` `ReferenceResolver` with
 *     failure-safe error wrapping and zero writes to private cross-module tables.
 *   - Read model consistency: guarantees that persisted `SalesOrder`, `Invoice`, and `Payment`
 *     projections agree on status, links, derived line taxes/totals, and aggregate totals
 *     immediately after a write.
 *
 * @module erp3/domain/relationships
 */

import type { ReferenceResolver } from "@cs/kernel";
import {
  ALLOWED_ORDER_STATUS_TRANSITIONS,
  ERP3_INVOICE_STATUSES,
  ERP3_INVOICE_STATUS_TRANSITIONS,
  ERP3_INVOICE_TERMINAL_STATUSES,
  ERP3_OPTIONAL_REFERENCE_ABSENT,
  ERP3_PAYMENT_METHODS,
  ERP3_SALES_ORDER_STATUSES,
  ERP3_SALES_ORDER_TERMINAL_STATUSES,
  calculateLineAmounts,
  deriveInvoiceStatus,
  validateOrderLineTotals,
  type Erp3RelationshipWarning,
  type Invoice,
  type InvoiceStatus,
  type Payment,
  type PaymentMethod,
  type SalesOrder,
  type SalesOrderStatus,
} from "@clearshift/contracts";
import {
  ERP3_DOMAIN_ERROR_CODES,
  Erp3DomainError,
  assertValidCustomerGoldenId,
  assertValidInvoiceDates,
  formatScaledDecimal4Dp,
  parseScaledDecimal4Dp,
} from "./rules.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Relationship Metadata & Catalog
// ─────────────────────────────────────────────────────────────────────────────

export type Erp3RelationshipType = "intra_module" | "cross_module";
export type Erp3RelationshipRequirement = "required" | "optional";
export type Erp3ReferentialAction =
  | "RESTRICT"
  | "CASCADE"
  | "SET_NULL"
  | "NO_ACTION";

export interface Erp3RelationshipDefinition {
  name: string;
  sourceEntity: string;
  targetEntity: string;
  foreignKey: string;
  type: Erp3RelationshipType;
  requirement: Erp3RelationshipRequirement;
  onDelete: Erp3ReferentialAction;
  owningModule: string;
  targetModule: string;
  description: string;
}

export const ERP3_RELATIONSHIPS: Record<string, Erp3RelationshipDefinition> = {
  ORDER_CUSTOMER: {
    name: "ORDER_CUSTOMER",
    sourceEntity: "erp3_sales_orders",
    targetEntity: "hub_golden_records",
    foreignKey: "customer_golden_id",
    type: "cross_module",
    requirement: "required",
    onDelete: "RESTRICT",
    owningModule: "erp-3",
    targetModule: "crm-1",
    description:
      "Mandatory customer Golden ID (UUID per ADR-003, BR-ERP3-03). Validated via ReferenceResolver.",
  },
  ORDER_LINES: {
    name: "ORDER_LINES",
    sourceEntity: "erp3_sales_orders",
    targetEntity: "erp3_so_lines",
    foreignKey: "order_id",
    type: "intra_module",
    requirement: "required",
    onDelete: "CASCADE",
    owningModule: "erp-3",
    targetModule: "erp-3",
    description:
      "Embedded sales order line items (at least 1 line required per order; SUM(line_total) == total per BR-ERP3-01).",
  },
  ORDER_LINE_PRODUCT: {
    name: "ORDER_LINE_PRODUCT",
    sourceEntity: "erp3_so_lines",
    targetEntity: "erp1_products",
    foreignKey: "product_id",
    type: "cross_module",
    requirement: "required",
    onDelete: "RESTRICT",
    owningModule: "erp-3",
    targetModule: "erp-1",
    description:
      "Logical reference to ERP-1 product UUID. Validated via ReferenceResolver; never mutated by ERP-3.",
  },
  INVOICE_CUSTOMER: {
    name: "INVOICE_CUSTOMER",
    sourceEntity: "erp3_invoices",
    targetEntity: "hub_golden_records",
    foreignKey: "customer_golden_id",
    type: "cross_module",
    requirement: "required",
    onDelete: "RESTRICT",
    owningModule: "erp-3",
    targetModule: "crm-1",
    description:
      "Mandatory customer Golden ID (UUID per ADR-003, BR-ERP3-03). Must match linked sales order customer when order_id is present.",
  },
  INVOICE_ORDER: {
    name: "INVOICE_ORDER",
    sourceEntity: "erp3_invoices",
    targetEntity: "erp3_sales_orders",
    foreignKey: "order_id",
    type: "intra_module",
    requirement: "optional",
    onDelete: "RESTRICT",
    owningModule: "erp-3",
    targetModule: "erp-3",
    description:
      "Optional link to originating sales order (at most one V1 invoice per sales order; standalone migration invoices allowed when null).",
  },
  INVOICE_LINES: {
    name: "INVOICE_LINES",
    sourceEntity: "erp3_invoices",
    targetEntity: "erp3_invoice_lines",
    foreignKey: "invoice_id",
    type: "intra_module",
    requirement: "required",
    onDelete: "CASCADE",
    owningModule: "erp-3",
    targetModule: "erp-3",
    description:
      "Embedded invoice line items (at least 1 line required per invoice; SUM(line_total) == total per BR-ERP3-01).",
  },
  INVOICE_LINE_PRODUCT: {
    name: "INVOICE_LINE_PRODUCT",
    sourceEntity: "erp3_invoice_lines",
    targetEntity: "erp1_products",
    foreignKey: "product_id",
    type: "cross_module",
    requirement: "required",
    onDelete: "RESTRICT",
    owningModule: "erp-3",
    targetModule: "erp-1",
    description:
      "Logical reference to ERP-1 product UUID. Validated via ReferenceResolver; never mutated by ERP-3.",
  },
  PAYMENT_INVOICE: {
    name: "PAYMENT_INVOICE",
    sourceEntity: "erp3_payments",
    targetEntity: "erp3_invoices",
    foreignKey: "invoice_id",
    type: "intra_module",
    requirement: "required",
    onDelete: "RESTRICT",
    owningModule: "erp-3",
    targetModule: "erp-3",
    description:
      "Mandatory link to target invoice (FR-ERP3-03). V1 accepts one full payment equal to invoice.total and transitions invoice to Paid.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Optional Relationship & Provenance Handling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles an optional relationship link (such as `invoice.order_id`).
 *
 * When the link is absent, returns the approved warning (`ERP3_OPTIONAL_REFERENCE_ABSENT`)
 * and keeps the value `null` — never materialising a placeholder or synthetic record.
 */
export function handleOptionalRelationship<T>(
  value: T | null | undefined,
  fieldName: string,
  relationshipName: string,
): { value: T | null; warning?: Erp3RelationshipWarning } {
  if (value === null || value === undefined || value === "") {
    return {
      value: null,
      warning: {
        relationship: relationshipName,
        field: fieldName,
        code: ERP3_OPTIONAL_REFERENCE_ABSENT,
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
  sourceId: string | null | undefined,
): void {
  const hasSystem =
    sourceSystem !== null &&
    sourceSystem !== undefined &&
    sourceSystem.trim() !== "";
  const hasId =
    sourceId !== null && sourceId !== undefined && sourceId.trim() !== "";

  if (hasSystem !== hasId) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.SOURCE_IDENTITY_INCOMPLETE,
      "source_system and source_id must be supplied together — a partial source identity is not a valid state.",
      hasSystem ? "source_id" : "source_system",
      { source_system: sourceSystem ?? null, source_id: sourceId ?? null },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Enumeration & Currency Validations (AC-2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FR-ERP3-05: Validates that a status value is an approved `SalesOrderStatus` (`Open`, `Invoiced`, `Closed`).
 */
export function assertValidSalesOrderStatus(
  value: unknown,
): asserts value is SalesOrderStatus {
  if (
    typeof value !== "string" ||
    !(ERP3_SALES_ORDER_STATUSES as readonly string[]).includes(value)
  ) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_ORDER_STATUS,
      `The sales order status "${String(value)}" is not one of the approved values [${ERP3_SALES_ORDER_STATUSES.join(", ")}].`,
      "status",
      { allowed: [...ERP3_SALES_ORDER_STATUSES], received: value },
    );
  }
}

/**
 * FR-ERP3-02: Validates that a status value is an approved `InvoiceStatus` (`Open`, `Paid`, `Overdue`).
 */
export function assertValidInvoiceStatus(
  value: unknown,
): asserts value is InvoiceStatus {
  if (
    typeof value !== "string" ||
    !(ERP3_INVOICE_STATUSES as readonly string[]).includes(value)
  ) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_INVOICE_STATUS,
      `The invoice status "${String(value)}" is not one of the approved values [${ERP3_INVOICE_STATUSES.join(", ")}].`,
      "status",
      { allowed: [...ERP3_INVOICE_STATUSES], received: value },
    );
  }
}

/**
 * FR-ERP3-03: Validates that a payment method is one of `cash`, `bank`, or `card`.
 */
export function assertValidPaymentMethod(
  value: unknown,
): asserts value is PaymentMethod {
  if (
    typeof value !== "string" ||
    !(ERP3_PAYMENT_METHODS as readonly string[]).includes(value)
  ) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_PAYMENT_METHOD,
      `The payment method "${String(value)}" is not one of the approved values [${ERP3_PAYMENT_METHODS.join(", ")}].`,
      "method",
      { allowed: [...ERP3_PAYMENT_METHODS], received: value },
    );
  }
}

/**
 * SDS §3.2: Validates an ISO 4217 3-letter uppercase currency code (e.g. `USD`, `INR`, `EUR`).
 */
export function assertValidCurrencyCode(
  currency: unknown,
): asserts currency is string {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_CURRENCY_CODE,
      `Currency "${String(currency)}" is invalid. Must be an ISO 4217 3-letter uppercase code.`,
      "currency",
      { currency },
    );
  }
}

/**
 * V1 currency rule: sales orders, invoices, and payments operate in matching currencies
 * with no FX conversion.
 */
export function assertOrderInvoiceCurrencyConsistency(
  orderCurrency: string,
  invoiceCurrency: string,
): void {
  assertValidCurrencyCode(orderCurrency);
  assertValidCurrencyCode(invoiceCurrency);

  if (orderCurrency !== invoiceCurrency) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.CURRENCY_MISMATCH,
      `Invoice currency (${invoiceCurrency}) does not match linked sales order currency (${orderCurrency}). FX conversion is not supported in V1.`,
      "currency",
      {
        order_currency: orderCurrency,
        invoice_currency: invoiceCurrency,
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. State Transition Matrices (AC-3)
// ─────────────────────────────────────────────────────────────────────────────

export interface SalesOrderTransitionOptions {
  /**
   * When true, transitioning from a status to the identical status (`current === next`)
   * is treated as a valid no-op. Defaults to `false` (strictly forward transitions only).
   */
  allowSameStatusNoop?: boolean;
  /**
   * Controls whether direct `Open -> Closed` is permitted per `ALLOWED_ORDER_STATUS_TRANSITIONS`.
   * Defaults to `true`.
   */
  allowDirectOpenToClosed?: boolean;
}

/**
 * FR-ERP3-05: Enforces the forward-only Sales Order state transition matrix:
 *   - `Open -> Invoiced` (and `Open -> Closed` when `allowDirectOpenToClosed !== false`)
 *   - `Invoiced -> Closed`
 *   - `Closed -> []` (terminal)
 */
export function assertSalesOrderStatusTransition(
  current: SalesOrderStatus,
  next: SalesOrderStatus,
  options: SalesOrderTransitionOptions = {},
): void {
  assertValidSalesOrderStatus(current);
  assertValidSalesOrderStatus(next);

  if (options.allowSameStatusNoop && current === next) {
    return;
  }

  const allowDirectOpenToClosed = options.allowDirectOpenToClosed ?? true;
  const baseAllowed = ALLOWED_ORDER_STATUS_TRANSITIONS[current] ?? [];
  const allowed =
    current === "Open" && !allowDirectOpenToClosed
      ? baseAllowed.filter((s) => s !== "Closed")
      : baseAllowed;

  if (!allowed.includes(next)) {
    const isTerminal = (
      ERP3_SALES_ORDER_TERMINAL_STATUSES as readonly string[]
    ).includes(current);
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_ORDER_STATUS_TRANSITION,
      isTerminal
        ? `A sales order in terminal status "${current}" cannot transition to "${next}". Allowed transitions from "${current}": none.`
        : `Cannot transition sales order from '${current}' to '${next}'. Allowed transitions from '${current}': [${allowed.join(", ") || "none"}].`,
      "status",
      {
        currentStatus: current,
        targetStatus: next,
        current_status: current,
        requested_status: next,
        allowed: [...allowed],
        terminal: isTerminal,
      },
    );
  }
}

export interface InvoiceTransitionOptions {
  /**
   * When true, transitioning from a status to the identical status (`current === next`)
   * is treated as a valid no-op. Defaults to `false`.
   */
  allowSameStatusNoop?: boolean;
}

/**
 * FR-ERP3-02 & FR-ERP3-04: Enforces the Invoice state transition matrix:
 *   - `Open -> Paid | Overdue`
 *   - `Overdue -> Paid`
 *   - `Paid -> []` (terminal; V1 has no payment reversal or credit notes)
 */
export function assertInvoiceStatusTransition(
  current: InvoiceStatus,
  next: InvoiceStatus,
  options: InvoiceTransitionOptions = {},
): void {
  assertValidInvoiceStatus(current);
  assertValidInvoiceStatus(next);

  if (options.allowSameStatusNoop && current === next) {
    return;
  }

  const allowed = ERP3_INVOICE_STATUS_TRANSITIONS[current] ?? [];

  if (!allowed.includes(next)) {
    const isTerminal = (
      ERP3_INVOICE_TERMINAL_STATUSES as readonly string[]
    ).includes(current);
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_INVOICE_STATUS_TRANSITION,
      isTerminal
        ? `An invoice in terminal status "${current}" cannot transition to "${next}". Allowed transitions from "${current}": none.`
        : `Cannot transition invoice from '${current}' to '${next}'. Allowed transitions from '${current}': [${allowed.join(", ") || "none"}].`,
      "status",
      {
        current_status: current,
        requested_status: next,
        allowed: [...allowed],
        terminal: isTerminal,
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Cross-Module Reference Validation (Decision C7 / AC-1 / AC-5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates cross-module references via the `ReferenceResolver` port without direct
 * cross-schema database writes or private table queries.
 *
 * - If the reference is absent and optional -> returns `{ valid: true, warning }`.
 * - If the reference is absent and required -> throws `MISSING_REQUIRED_REFERENCE` (or override).
 * - If `entityType === "customer"` -> validates UUID format per ADR-003 / BR-ERP3-03.
 * - If `resolver` is provided -> verifies existence via `resolver.exists(entityType, id)`.
 * - External resolver errors are caught and converted into a stable `Erp3DomainError`
 *   so failures never leak raw exceptions or leave partial state.
 */
export async function validateCrossModuleReference(
  resolver: ReferenceResolver | undefined,
  entityType: "customer" | "product" | string,
  referenceId: string | null | undefined,
  isRequired: boolean,
  fieldName: string,
  errorOverrideCode?: string,
): Promise<{ valid: boolean; warning?: Erp3RelationshipWarning | undefined }> {
  const optionalHandling = handleOptionalRelationship(
    referenceId,
    fieldName,
    entityType,
  );

  if (!optionalHandling.value) {
    if (isRequired) {
      const missingCode =
        entityType === "customer"
          ? ERP3_DOMAIN_ERROR_CODES.MISSING_CUSTOMER_GOLDEN_ID
          : (errorOverrideCode ??
            ERP3_DOMAIN_ERROR_CODES.MISSING_REQUIRED_REFERENCE);
      throw new Erp3DomainError(
        missingCode,
        `Required cross-module reference "${fieldName}" for entity "${entityType}" is missing.`,
        fieldName,
        { entity_type: entityType },
      );
    }
    return {
      valid: true,
      ...(optionalHandling.warning !== undefined && {
        warning: optionalHandling.warning,
      }),
    };
  }

  if (entityType === "customer") {
    assertValidCustomerGoldenId(optionalHandling.value);
  }

  if (!resolver) {
    return { valid: true };
  }

  let exists = false;
  try {
    exists = await resolver.exists(entityType, optionalHandling.value);
  } catch (err) {
    if (err instanceof Erp3DomainError) {
      throw err;
    }
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_REFERENCE,
      `Cross-module reference check failed for ${entityType} "${optionalHandling.value}": ${err instanceof Error ? err.message : "Unknown error"}`,
      fieldName,
      {
        entity_type: entityType,
        reference_id: optionalHandling.value,
      },
    );
  }

  if (!exists) {
    const notFoundCode =
      errorOverrideCode ??
      (entityType === "customer"
        ? ERP3_DOMAIN_ERROR_CODES.CUSTOMER_NOT_FOUND
        : entityType === "product"
          ? ERP3_DOMAIN_ERROR_CODES.PRODUCT_NOT_FOUND
          : ERP3_DOMAIN_ERROR_CODES.INVALID_REFERENCE);

    throw new Erp3DomainError(
      notFoundCode,
      entityType === "customer"
        ? `Customer Golden ID '${optionalHandling.value}' was not found in Hub / CRM-1 (BR-ERP3-03).`
        : entityType === "product"
          ? `Referenced ERP-1 product ID '${optionalHandling.value}' on field '${fieldName}' was not found.`
          : `Referenced ${entityType} '${optionalHandling.value}' on field '${fieldName}' does not exist in the owning module.`,
      fieldName,
      {
        entity_type: entityType,
        reference_id: optionalHandling.value,
        ...(entityType === "customer"
          ? { customer_golden_id: optionalHandling.value }
          : {}),
        ...(entityType === "product"
          ? { product_id: optionalHandling.value }
          : {}),
      },
    );
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Read-Model Consistency Assertions (AC-4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asserts that a `SalesOrder` read projection agrees on mandatory fields, customer
 * Golden ID UUID, status, currency, provenance pair, line taxes/totals, and aggregate
 * order total (`BR-ERP3-01`, `BR-ERP3-02`, `BR-ERP3-03`).
 */
export function assertSalesOrderReadConsistency(order: SalesOrder): void {
  if (
    !order.id ||
    !order.order_number ||
    !order.customer_golden_id ||
    !order.order_date ||
    !order.currency ||
    !order.total
  ) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
      "Sales order read model is missing mandatory fields.",
      "sales_order",
    );
  }

  assertValidCustomerGoldenId(order.customer_golden_id);
  assertValidSalesOrderStatus(order.status);
  assertValidCurrencyCode(order.currency);
  assertSourceIdentityIsComplete(order.source_system, order.source_id);

  if (!order.lines || order.lines.length === 0) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
      "Sales order read model must contain at least one line item.",
      "lines",
    );
  }

  for (let i = 0; i < order.lines.length; i++) {
    const line = order.lines[i]!;
    if (!line.id || !line.order_id || !line.product_id) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Sales order line ${i + 1} is missing mandatory identifiers.`,
        `lines.${i}`,
      );
    }

    if (line.order_id !== order.id) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Sales order line ${i + 1} order_id (${line.order_id}) does not match parent order.id (${order.id}).`,
        `lines.${i}.order_id`,
        { line_order_id: line.order_id, order_id: order.id },
      );
    }

    const qtyScaled = parseScaledDecimal4Dp(line.quantity);
    if (qtyScaled <= 0n) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Sales order line ${i + 1} has non-positive quantity (${line.quantity}).`,
        `lines.${i}.quantity`,
      );
    }

    const expected = calculateLineAmounts(
      line.quantity,
      line.price,
      line.tax_rate,
    );

    if (line.tax_amount !== expected.tax_amount) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Sales order line ${i + 1} tax_amount (${line.tax_amount}) does not match computed tax (${expected.tax_amount}).`,
        `lines.${i}.tax_amount`,
        { tax_amount: line.tax_amount, expected: expected.tax_amount },
      );
    }

    if (line.line_total !== expected.line_total) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Sales order line ${i + 1} line_total (${line.line_total}) does not match computed total (${expected.line_total}).`,
        `lines.${i}.line_total`,
        { line_total: line.line_total, expected: expected.line_total },
      );
    }
  }

  if (!validateOrderLineTotals(order.lines, order.total)) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
      `Sales order total (${order.total}) does not equal the sum of its line totals (BR-ERP3-01).`,
      "total",
      { total: order.total },
    );
  }
}

/**
 * Asserts that an `Invoice` read projection (and optional associated `Payment` records)
 * agrees on mandatory fields, `due_date >= invoice_date`, status, currency, provenance
 * pair, line taxes/totals, aggregate invoice total, and derived payment/overdue status.
 */
export function assertInvoiceReadConsistency(
  invoice: Invoice,
  payments?: ReadonlyArray<Payment>,
  nowUtcDateString?: string,
): void {
  if (
    !invoice.id ||
    !invoice.invoice_number ||
    !invoice.customer_golden_id ||
    !invoice.invoice_date ||
    !invoice.due_date ||
    !invoice.currency ||
    !invoice.total
  ) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
      "Invoice read model is missing mandatory fields.",
      "invoice",
    );
  }

  assertValidCustomerGoldenId(invoice.customer_golden_id);
  assertValidInvoiceDates(invoice.invoice_date, invoice.due_date);
  assertValidInvoiceStatus(invoice.status);
  assertValidCurrencyCode(invoice.currency);
  assertSourceIdentityIsComplete(invoice.source_system, invoice.source_id);

  if (!invoice.lines || invoice.lines.length === 0) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
      "Invoice read model must contain at least one line item.",
      "lines",
    );
  }

  for (let i = 0; i < invoice.lines.length; i++) {
    const line = invoice.lines[i]!;
    if (!line.id || !line.invoice_id || !line.product_id) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Invoice line ${i + 1} is missing mandatory identifiers.`,
        `lines.${i}`,
      );
    }

    if (line.invoice_id !== invoice.id) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Invoice line ${i + 1} invoice_id (${line.invoice_id}) does not match parent invoice.id (${invoice.id}).`,
        `lines.${i}.invoice_id`,
        { line_invoice_id: line.invoice_id, invoice_id: invoice.id },
      );
    }

    const qtyScaled = parseScaledDecimal4Dp(line.quantity);
    if (qtyScaled <= 0n) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Invoice line ${i + 1} has non-positive quantity (${line.quantity}).`,
        `lines.${i}.quantity`,
      );
    }

    const expected = calculateLineAmounts(
      line.quantity,
      line.price,
      line.tax_rate,
    );

    if (line.tax_amount !== expected.tax_amount) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Invoice line ${i + 1} tax_amount (${line.tax_amount}) does not match computed tax (${expected.tax_amount}).`,
        `lines.${i}.tax_amount`,
        { tax_amount: line.tax_amount, expected: expected.tax_amount },
      );
    }

    if (line.line_total !== expected.line_total) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Invoice line ${i + 1} line_total (${line.line_total}) does not match computed total (${expected.line_total}).`,
        `lines.${i}.line_total`,
        { line_total: line.line_total, expected: expected.line_total },
      );
    }
  }

  if (!validateOrderLineTotals(invoice.lines, invoice.total)) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
      `Invoice total (${invoice.total}) does not equal the sum of its line totals (BR-ERP3-01).`,
      "total",
      { total: invoice.total },
    );
  }

  if (payments) {
    let paidScaled = 0n;
    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i]!;
      if (payment.invoice_id !== invoice.id) {
        throw new Erp3DomainError(
          ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
          `Payment ${payment.id} invoice_id (${payment.invoice_id}) does not match invoice.id (${invoice.id}).`,
          `payments.${i}.invoice_id`,
        );
      }
      paidScaled += parseScaledDecimal4Dp(payment.amount);
    }

    const totalScaled = parseScaledDecimal4Dp(invoice.total);
    if (paidScaled > totalScaled) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Sum of payments (${formatScaledDecimal4Dp(paidScaled)}) exceeds invoice total (${invoice.total}).`,
        "payments",
      );
    }

    const expectedStatus = deriveInvoiceStatus(
      invoice.total,
      formatScaledDecimal4Dp(paidScaled),
      invoice.due_date,
      nowUtcDateString,
    );

    if (invoice.status !== expectedStatus) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Invoice status (${invoice.status}) does not match derived status (${expectedStatus}).`,
        "status",
        { status: invoice.status, expected_status: expectedStatus },
      );
    }
  }
}

/**
 * Asserts that a `Payment` read projection (and optional target `Invoice`) agrees on
 * mandatory fields, positive 4-dp amount, valid `PaymentMethod`, and V1 full-settlement
 * alignment (`payment.amount === invoice.total` and `invoice.status === "Paid"`).
 */
export function assertPaymentReadConsistency(
  payment: Payment,
  invoice?: Invoice,
): void {
  if (!payment.id || !payment.invoice_id || !payment.amount || !payment.paid_at) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
      "Payment read model is missing mandatory fields.",
      "payment",
    );
  }

  assertValidPaymentMethod(payment.method);

  const amountScaled = parseScaledDecimal4Dp(payment.amount);
  if (amountScaled <= 0n) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
      `Payment amount (${payment.amount}) must be strictly greater than zero.`,
      "amount",
    );
  }

  if (invoice) {
    if (payment.invoice_id !== invoice.id) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Payment invoice_id (${payment.invoice_id}) does not match target invoice.id (${invoice.id}).`,
        "invoice_id",
      );
    }

    const invoiceTotalScaled = parseScaledDecimal4Dp(invoice.total);
    if (amountScaled !== invoiceTotalScaled) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `V1 payment amount (${payment.amount}) does not equal target invoice total (${invoice.total}).`,
        "amount",
        { payment_amount: payment.amount, invoice_total: invoice.total },
      );
    }

    if (invoice.status !== "Paid") {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Target invoice (${invoice.id}) must have status "Paid" after full payment settlement, found "${invoice.status}".`,
        "status",
        { invoice_status: invoice.status },
      );
    }
  }
}
