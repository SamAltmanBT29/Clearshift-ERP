/**
 * ERP-1 Products & Inventory — Rejection Review Context (KIT-16 / ERP1-23)
 *
 * Configures module context for the shared Migration Kit rejection review and
 * export screens.
 *
 * Guarantees:
 * - Module-specific identifier columns (SKU, Product Name, Source ID, Category Code) alongside standard error codes (AC1).
 * - Human-readable reason text explaining validation or constraint failures (AC2).
 * - Automatic masking/exclusion of sensitive financial, bank, or employee fields (AC3).
 * - Formula-safe CSV export downloads filtered rejected rows with correct headers (AC4).
 *
 * @module erp1/kit/rejection-context
 */

import type {
  ModuleRejectionContext,
  FailureExplanation,
  RejectedRow,
} from '@cs/kit';

/**
 * Standardized failure explanations for ERP-1 domain errors.
 */
export const erp1FailureExplanations: Readonly<Record<string, FailureExplanation>> = {
  DUPLICATE_SKU: {
    code: 'DUPLICATE_SKU',
    title: 'Duplicate SKU',
    explanation:
      'SKU is already registered after normalization (BR-ERP1-01). SKUs must be globally unique across all active and archived records.',
    docReference: 'BR-ERP1-01',
    resolution: 'Verify existing catalog in ERP-1 or re-map source SKU.',
  },
  INVALID_UNIT_OF_MEASURE: {
    code: 'INVALID_UNIT_OF_MEASURE',
    title: 'Invalid Unit of Measure',
    explanation:
      'Unit of measure must be one of the approved V1 units: pcs, kg, g, litre, metre, box (FR-ERP1-04).',
    docReference: 'FR-ERP1-04',
    resolution: 'Standardize unit to one of the 6 allowed V1 units.',
  },
  NEGATIVE_PRICE: {
    code: 'NEGATIVE_PRICE',
    title: 'Negative Unit Price',
    explanation:
      'Product unit price cannot be negative (FR-ERP1-02). Must be a decimal >= 0.0000.',
    docReference: 'FR-ERP1-02',
    resolution: 'Ensure unit price is non-negative.',
  },
  INVALID_TAX_RATE: {
    code: 'INVALID_TAX_RATE',
    title: 'Invalid Tax Rate',
    explanation:
      'Tax rate must be a valid decimal between 0.0000 and 1.0000 (FR-ERP1-02). Percentages (e.g. 18%) must be formatted as decimals (0.1800).',
    docReference: 'FR-ERP1-02',
    resolution: 'Divide percentage by 100 to produce decimal rate between 0.0000 and 1.0000.',
  },
  NEGATIVE_STOCK: {
    code: 'NEGATIVE_STOCK',
    title: 'Negative Stock Level',
    explanation:
      'Stock quantity cannot be negative (BR-ERP1-02 / FR-ERP1-06). Minimum stock level is 0.',
    docReference: 'BR-ERP1-02',
    resolution: 'Reconcile warehouse inventory quantity.',
  },
  INVALID_CATEGORY: {
    code: 'INVALID_CATEGORY',
    title: 'Category Not Found',
    explanation:
      'Referenced category code does not exist in erp1_categories (FR-ERP1-03).',
    docReference: 'FR-ERP1-03',
    resolution: 'Import or create categories prior to importing products.',
  },
  MISSING_REQUIRED_FIELD: {
    code: 'MISSING_REQUIRED_FIELD',
    title: 'Missing Mandatory Field',
    explanation:
      'A required product field (such as Name, SKU, or Unit of Measure) is missing or blank.',
    docReference: 'FR-ERP1-01',
    resolution: 'Populate all mandatory columns in source data before importing.',
  },
  MULTIPLE_WAREHOUSES_REJECTED: {
    code: 'MULTIPLE_WAREHOUSES_REJECTED',
    title: 'Multiple Warehouses Not Supported',
    explanation:
      'V1 scope strictly supports a single warehouse (BR-ERP1-03). Second warehouse was rejected.',
    docReference: 'BR-ERP1-03',
    resolution: 'Assign all inventory to the primary default warehouse.',
  },
  SOURCE_VALUE_MUTATED: {
    code: 'SOURCE_VALUE_MUTATED',
    title: 'Raw Source Value Alteration',
    explanation:
      'Raw source values must be preserved without destructive mutation (KIT-08).',
    docReference: 'KIT-08',
    resolution: 'Retain original sourceSystem and sourceId untouched.',
  },
};

/**
 * ERP-1 Products Module Rejection Context configuration.
 */
export const erp1ProductsRejectionContext: ModuleRejectionContext = {
  moduleId: 'erp-1',
  moduleName: 'ERP-1 Products and Inventory',
  entity: 'products',

  identifierColumns: [
    {
      field: 'sku',
      label: 'SKU',
      isIdentifier: true,
      format: (val) => (val !== undefined && val !== null ? String(val).toUpperCase().trim() : '—'),
    },
    {
      field: 'name',
      label: 'Product Name',
      isIdentifier: true,
    },
    {
      field: 'sourceId',
      label: 'Source ID',
      isIdentifier: true,
    },
    {
      field: 'categoryCode',
      label: 'Category Code',
    },
  ],

  additionalColumns: [
    {
      field: 'unitOfMeasure',
      label: 'Unit of Measure',
    },
    {
      field: 'price',
      label: 'Unit Price',
    },
    {
      field: 'taxRate',
      label: 'Tax Rate',
    },
  ],

  sensitiveFields: [
    'bankAccountNumber',
    'bank_account_number',
    'routingNumber',
    'routing_number',
    'iban',
    'ssn',
    'social_security_number',
    'taxId',
    'tax_id',
    'salary',
    'compensation',
    'creditCard',
    'credit_card_number',
    'pin',
    'password',
  ],

  failureExplanations: erp1FailureExplanations,

  contextualLinks: [
    {
      label: 'Search Products',
      getUrl: (row: RejectedRow) => {
        const sku = row.rawData['sku'];
        return `/erp1/products?search=${encodeURIComponent(typeof sku === 'string' ? sku : '')}`;
      },
    },
    {
      label: 'Data Dictionary',
      getUrl: () => 'docs/data-dictionaries/erp-1.md',
      openInNewTab: true,
    },
  ],
};
