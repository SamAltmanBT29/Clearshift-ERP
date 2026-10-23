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
