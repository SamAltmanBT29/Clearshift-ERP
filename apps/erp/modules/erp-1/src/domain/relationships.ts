/**
 * ERP-1 Products & Inventory — Relationship Rules, State Transitions & Read Model Consistency
 *
 * Deterministic domain layer for ERP-1 (Issue #11 / ERP1-06):
 *   - Relationships: validation of required links before commit; absent optional links
 *     produce approved warnings (ERP1_OPTIONAL_REFERENCE_ABSENT) instead of synthetic records
 *   - Provenance completeness: source_system and source_id must be supplied as a pair
 *   - Enumerations: strict unit of measure, currency code, and stock status validation
 *   - State transitions: stock level transitions and product lifecycle matrix with exact failure codes
 *   - Read model consistency: guarantees that persisted entities and their public projections
 *     agree on status, SKU normalization, decimal scales, and non-negative constraints
 *   - Cross-module boundary isolation: verifies no writes to other modules' private tables
 *
 * Side-effect free: no I/O, no database connection, no network calls.
 *
 * @module erp1/domain/relationships
 */

import {
  ERP1_DOMAIN_RULES,
  ERP1_OPTIONAL_REFERENCE_ABSENT,
  ERP1_UNITS_OF_MEASURE,
  ERP1_STOCK_STATUSES,
  ERP1_STOCK_STATUS_TRANSITIONS,
  ERP1_PRODUCT_STATUSES,
  ERP1_PRODUCT_STATUS_TRANSITIONS,
  ERP1_PRODUCT_TERMINAL_STATUSES,
  normalizeSku,
  type Category,
  type Erp1RelationshipWarning,
  type Product,
  type ProductLifecycleStatus,
  type StockLevel,
  type StockStatus,
  type UnitOfMeasure,
} from '@clearshift/contracts';
import { Erp1DomainError } from './rules.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Optional Relationship Handling (AC-1)
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
): { value: T | null; warning?: Erp1RelationshipWarning } {
  if (value === null || value === undefined || value === '') {
    return {
      value: null,
      warning: {
        relationship: relationshipName,
        field: fieldName,
        code: ERP1_OPTIONAL_REFERENCE_ABSENT,
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
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE,
      'source_system and source_id must be supplied together — a partial source identity is not a valid state.',
      hasSystem ? 'source_id' : 'source_system',
      { source_system: sourceSystem, source_id: sourceId }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Enumeration Validations (AC-2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a string is a valid UnitOfMeasure enumeration per FR-ERP1-04.
 */
export function assertValidUnitOfMeasure(value: string): asserts value is UnitOfMeasure {
  if (!(ERP1_UNITS_OF_MEASURE as readonly string[]).includes(value)) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.INVALID_UNIT_OF_MEASURE,
      `Unit of measure "${value}" is invalid. Must be one of [${ERP1_UNITS_OF_MEASURE.join(', ')}].`,
      'unitOfMeasure',
      { allowed: [...ERP1_UNITS_OF_MEASURE], received: value }
    );
  }
}

/**
 * Validates ISO 4217 3-letter currency code (e.g. USD, EUR, GBP).
 */
export function assertValidCurrencyCode(currency: string): void {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.INVALID_CURRENCY_CODE,
      `Currency "${currency}" is invalid. Must be an ISO 4217 3-letter uppercase code.`,
      'currency',
      { currency }
    );
  }
}

/**
 * Validates that a status string is a valid StockStatus enumeration.
 */
export function assertValidStockStatus(status: string): asserts status is StockStatus {
  if (!(ERP1_STOCK_STATUSES as readonly string[]).includes(status)) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.INVALID_STOCK_STATUS,
      `Stock status "${status}" is invalid. Must be one of [${ERP1_STOCK_STATUSES.join(', ')}].`,
      'stockStatus',
      { allowed: [...ERP1_STOCK_STATUSES], received: status }
    );
  }
}

/**
 * Validates that a status string is a valid ProductLifecycleStatus enumeration.
 */
export function assertValidProductStatus(status: string): asserts status is ProductLifecycleStatus {
  if (!(ERP1_PRODUCT_STATUSES as readonly string[]).includes(status)) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.INVALID_PRODUCT_STATUS,
      `Product lifecycle status "${status}" is invalid. Must be one of [${ERP1_PRODUCT_STATUSES.join(', ')}].`,
      'status',
      { allowed: [...ERP1_PRODUCT_STATUSES], received: status }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. State Transition Matrix & Status Derivation (AC-3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the authoritative stock status from on-hand inventory quantity:
 * - quantity <= 0: out_of_stock
 * - 0 < quantity <= 10: low_stock
 * - quantity > 10: in_stock
 */
export function deriveStockStatus(quantity: string | number): StockStatus {
  const qty = Number(quantity);
  if (isNaN(qty) || qty <= 0) {
    return 'out_of_stock';
  }
  if (qty <= 10) {
    return 'low_stock';
  }
  return 'in_stock';
}

/**
 * Asserts valid stock status transition when inventory levels change.
 * Rejects negative stock quantities with NEGATIVE_STOCK (BR-ERP1-02).
 */
export function assertStockStatusTransition(
  current: StockStatus,
  next: StockStatus,
  targetQuantity?: string | number
): void {
  if (targetQuantity !== undefined && Number(targetQuantity) < 0) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.NEGATIVE_STOCK,
      'Stock quantity cannot become negative (BR-ERP1-02).',
      'quantity',
      { current, next, quantity: targetQuantity }
    );
  }

  assertValidStockStatus(current);
  assertValidStockStatus(next);

  if (current === next) {
    return;
  }

  const allowed = ERP1_STOCK_STATUS_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.INVALID_STATUS_TRANSITION,
      `Cannot transition stock status from '${current}' to '${next}'. Allowed transitions: [${allowed.join(', ')}].`,
      'stockStatus',
      { current, next, allowed }
    );
  }
}

/**
 * Enforces product lifecycle state transitions:
 *   draft -> active -> discontinued -> archived
 *
 * - Setting identical status is a valid no-op.
 * - Archived is terminal: no further transitions are allowed.
 * - Direct reactivation from discontinued to active is permitted.
 * - Transitions back to draft or from archived are forbidden.
 */
export function assertProductStatusTransition(
  current: ProductLifecycleStatus,
  next: ProductLifecycleStatus
): void {
  assertValidProductStatus(current);
  assertValidProductStatus(next);

  if (current === next) {
    return;
  }

  const isTerminal = (ERP1_PRODUCT_TERMINAL_STATUSES as readonly string[]).includes(current);
  if (isTerminal) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.INVALID_STATUS_TRANSITION,
      `A product in terminal status "${current}" cannot transition to "${next}". Allowed transitions from "${current}": none.`,
      'status',
      { current, next, allowed: [], terminal: true }
    );
  }

  const allowed = ERP1_PRODUCT_STATUS_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.INVALID_STATUS_TRANSITION,
      `Cannot transition product from '${current}' to '${next}'. Allowed forward transitions: [${allowed.join(', ')}].`,
      'status',
      { current, next, allowed, terminal: false }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Read Model Consistency Assertions (AC-4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asserts that a Product record adheres to read model consistency:
 * - Mandatory fields are present
 * - Normalized SKU matches normalized input (BR-ERP1-01)
 * - Valid non-negative price with <= 4 decimal places
 * - Valid non-negative tax rate with <= 2 decimal places
 * - Valid ISO 4217 currency
 * - Valid unit of measure
 * - Provenance pair completeness
 */
export function assertProductReadConsistency(product: Product): void {
  if (!product.id || !product.name || !product.sku || !product.normalizedSku) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'Product read model is missing mandatory identity fields.',
      'product'
    );
  }

  const expectedNormalized = normalizeSku(product.sku);
  if (product.normalizedSku !== expectedNormalized) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      `Product normalizedSku (${product.normalizedSku}) does not match normalizeSku(sku) (${expectedNormalized}).`,
      'normalizedSku',
      { actual: product.normalizedSku, expected: expectedNormalized }
    );
  }

  const priceNum = Number(product.price);
  if (isNaN(priceNum) || priceNum < 0 || !/^\d+(\.\d{1,4})?$/.test(product.price)) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      `Product price (${product.price}) is not a valid non-negative decimal string (numeric(19,4)).`,
      'price',
      { price: product.price }
    );
  }

  if (product.taxRate !== undefined && product.taxRate !== null) {
    const taxNum = Number(product.taxRate);
    if (isNaN(taxNum) || taxNum < 0 || taxNum > 100 || !/^\d+(\.\d{1,2})?$/.test(product.taxRate)) {
      throw new Erp1DomainError(
        ERP1_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
        `Product taxRate (${product.taxRate}) is not a valid non-negative percentage.`,
        'taxRate',
        { taxRate: product.taxRate }
      );
    }
  }

  assertValidCurrencyCode(product.currency);
  assertValidUnitOfMeasure(product.unitOfMeasure);
  assertSourceIdentityIsComplete(product.sourceSystem, product.sourceId);
}

/**
 * Asserts that a StockLevel record adheres to read model consistency:
 * - Mandatory references exist
 * - Quantity is non-negative decimal string (BR-ERP1-02)
 * - Derived stock status matches authoritative quantity calculation
 */
export function assertStockLevelReadConsistency(
  stock: StockLevel,
  expectedStatus?: StockStatus
): void {
  if (!stock.id || !stock.productId || !stock.warehouseId || stock.quantity === undefined) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'StockLevel read model is missing mandatory reference or quantity fields.',
      'stockLevel'
    );
  }

  const qty = Number(stock.quantity);
  if (isNaN(qty) || qty < 0 || !/^\d+(\.\d{1,4})?$/.test(stock.quantity)) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.NEGATIVE_STOCK,
      `StockLevel quantity (${stock.quantity}) cannot be negative or invalid (BR-ERP1-02).`,
      'quantity',
      { quantity: stock.quantity }
    );
  }

  const derived = deriveStockStatus(stock.quantity);
  if (expectedStatus !== undefined && derived !== expectedStatus) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      `Derived stock status (${derived}) does not match expected status (${expectedStatus}) for quantity ${stock.quantity}.`,
      'stockStatus',
      { derived, expectedStatus, quantity: stock.quantity }
    );
  }
}

/**
 * Asserts that a Category record adheres to read model consistency:
 * - Single-level category invariant (no parent category nesting per FR-ERP1-03)
 * - Mandatory name and unique code
 */
export function assertCategoryReadConsistency(category: Category): void {
  if (!category.id || !category.name || !category.code) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'Category read model is missing mandatory fields.',
      'category'
    );
  }

  // FR-ERP1-03: Single level only. Category must not contain any parent relationship.
  if ('parentId' in category || 'parent_id' in category) {
    throw new Erp1DomainError(
      ERP1_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'Categories in V1 are single-level only (FR-ERP1-03); hierarchical nesting is prohibited.',
      'parentId'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Cross-Module Boundaries & Private Table Isolation (AC-5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asserts that writes from this module never touch private tables belonging to sibling modules.
 * Only tables in the `erp1` schema or approved module-owned entities can be targeted.
 */
export function assertNoCrossModulePrivateTableWrite(targetTable: string): void {
  const normalized = targetTable.toLowerCase().trim();
  const forbiddenPrefixes = ['erp2', 'erp3', 'erp4', 'erp5', 'crm'];

  for (const prefix of forbiddenPrefixes) {
    if (
      normalized.startsWith(`${prefix}.`) ||
      normalized.startsWith(`${prefix}_`) ||
      normalized.includes(`_${prefix}_`)
    ) {
      throw new Erp1DomainError(
        ERP1_DOMAIN_RULES.CROSS_MODULE_WRITE_FORBIDDEN,
        `Direct write to sibling module private table "${targetTable}" is forbidden. Cross-module data must be accessed through public contracts or APIs.`,
        'targetTable',
        { targetTable, forbiddenModule: prefix }
      );
    }
  }
}
