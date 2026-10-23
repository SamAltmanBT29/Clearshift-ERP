/**
 * ERP-1 Products & Inventory — Pure Domain Rules & Invariants
 *
 * Side-effect free domain error handling and business invariants for ERP-1:
 *   - BR-ERP1-01: SKU is unique in the database and uppercase-normalized
 *   - BR-ERP1-02: Stock quantity cannot become negative
 *   - FR-ERP1-03: Single-level categories only (no parent/child hierarchy)
 *   - FR-ERP1-04: Fixed units of measure (pcs, kg, g, litre, metre, box)
 *   - FR-ERP1-05: Exactly one default warehouse in V1
 *   - Exact decimal NUMERIC(19,4) precision for price and quantities
 *
 * @module erp1/domain/rules
 */

export class Erp1DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'Erp1DomainError';
  }
}

export const ALLOWED_UNITS_OF_MEASURE = [
  'pcs',
  'kg',
  'g',
  'litre',
  'metre',
  'box',
] as const;

export type AllowedUnitOfMeasure = (typeof ALLOWED_UNITS_OF_MEASURE)[number];

export function validateUnitOfMeasure(unit: string): AllowedUnitOfMeasure {
  if (!ALLOWED_UNITS_OF_MEASURE.includes(unit as AllowedUnitOfMeasure)) {
    throw new Erp1DomainError(
      'INVALID_UNIT_OF_MEASURE',
      `Invalid unit of measure: "${unit}". Allowed units are: ${ALLOWED_UNITS_OF_MEASURE.join(', ')}`,
      'unitOfMeasure'
    );
  }
  return unit as AllowedUnitOfMeasure;
}

export function validateCurrency(currency: string): string {
  const trimmed = currency.trim();
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    throw new Erp1DomainError(
      'INVALID_CURRENCY',
      `Currency must be an uppercase ISO-4217 3-letter code, received: "${currency}"`,
      'currency'
    );
  }
  return trimmed;
}

export function validateStockNonNegative(quantity: number | string): string {
  const num = typeof quantity === 'number' ? quantity : parseFloat(quantity);
  if (isNaN(num) || num < 0) {
    throw new Erp1DomainError(
      'NEGATIVE_STOCK',
      `Stock quantity cannot become negative (BR-ERP1-02). Received: ${quantity}`,
      'quantity'
    );
  }
  return num.toFixed(4);
}

export function validateDecimalPrice(price: number | string): string {
  const num = typeof price === 'number' ? price : parseFloat(price);
  if (isNaN(num) || num < 0) {
    throw new Erp1DomainError(
      'INVALID_PRICE',
      `Price must be a non-negative decimal amount. Received: ${price}`,
      'price'
    );
  }
  return num.toFixed(4);
}

export function validateCategoryHierarchy(hasParentCategory: boolean): void {
  if (hasParentCategory) {
    throw new Erp1DomainError(
      'INVALID_CATEGORY_HIERARCHY',
      'Category hierarchy is strictly one level only in V1 (FR-ERP1-03). Nested categories are prohibited.',
      'parentId'
    );
  }
}
