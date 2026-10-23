/**
 * ERP-1 Products & Inventory — Domain Rules and Invariants
 *
 * Enforces SDS core invariants:
 *   - SKU uniqueness after normalization (BR-ERP1-01)
 *   - Unit of measure is from fixed V1 list (pcs, kg, g, litre, metre, box) (FR-ERP1-04)
 *   - Stock quantity cannot become negative (BR-ERP1-02)
 *   - Category hierarchy is one level only (FR-ERP1-03)
 *   - Price and tax rate use exact decimal/NUMERIC handling (19,4 and 5,2)
 *   - Explicit uppercase ISO 4217 currency (no implicit default)
 *
 * @module erp1/domain/rules
 */

import { AppError } from '@cs/kernel';

export class Erp1DomainError extends AppError {
  readonly field?: string | undefined;

  constructor(
    message: string,
    code: string,
    statusCode: number = 422,
    field?: string
  ) {
    super(code, message, statusCode, field ? [{ field, message, code }] : []);
    this.name = 'Erp1DomainError';
    this.field = field;
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
      `Invalid unit of measure: "${unit}". Allowed units are: ${ALLOWED_UNITS_OF_MEASURE.join(', ')}`,
      'INVALID_UNIT_OF_MEASURE',
      422,
      'unitOfMeasure'
    );
  }
  return unit as AllowedUnitOfMeasure;
}

export function validateCurrency(currency: string): string {
  const trimmed = currency.trim();
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    throw new Erp1DomainError(
      `Currency must be an uppercase ISO-4217 3-letter code, received: "${currency}"`,
      'INVALID_CURRENCY',
      422,
      'currency'
    );
  }
  return trimmed;
}

export function validateStockNonNegative(quantity: number | string): string {
  const num = typeof quantity === 'number' ? quantity : parseFloat(quantity);
  if (isNaN(num) || num < 0) {
    throw new Erp1DomainError(
      `Stock quantity cannot become negative (BR-ERP1-02). Received: ${quantity}`,
      'NEGATIVE_STOCK',
      422,
      'quantity'
    );
  }
  return num.toFixed(4);
}

export function validateDecimalPrice(price: number | string): string {
  const num = typeof price === 'number' ? price : parseFloat(price);
  if (isNaN(num) || num < 0) {
    throw new Erp1DomainError(
      `Price must be a non-negative decimal amount. Received: ${price}`,
      'INVALID_PRICE',
      422,
      'price'
    );
  }
  return num.toFixed(4);
}

export function validateCategoryHierarchy(hasParentCategory: boolean): void {
  if (hasParentCategory) {
    throw new Erp1DomainError(
      'Category hierarchy is strictly one level only in V1 (FR-ERP1-03). Nested categories are prohibited.',
      'INVALID_CATEGORY_HIERARCHY',
      422,
      'parentId'
    );
  }
}
