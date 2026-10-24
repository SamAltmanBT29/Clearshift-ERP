/**
 * ERP-2 Vendors & Purchasing — Rejection Review Context (KIT-16 / ERP2-23)
 *
 * Configures module context for the shared Migration Kit rejection review and
 * export screens.
 *
 * Guarantees:
 * - Module-specific identifier columns (Tax Number, Vendor Name, PO Number, Source ID) alongside standard error codes (AC1).
 * - Human-readable reason text explaining validation or constraint failures (AC2).
 * - Automatic masking/exclusion of sensitive financial, bank, or employee fields (AC3).
 * - Formula-safe CSV export downloads filtered rejected rows with correct headers (AC4).
 *
 * @module erp2/kit/rejection-context
 */

import type {
  ModuleRejectionContext,
  FailureExplanation,
  RejectedRow,
} from '@cs/kit';

/**
 * Standardized failure explanations for ERP-2 domain errors.
 */
export const erp2FailureExplanations: Readonly<Record<string, FailureExplanation>> = {
  DUPLICATE_TAX_NUMBER: {
    code: 'DUPLICATE_TAX_NUMBER',
    title: 'Duplicate Tax Identification Number',
    explanation:
      'Tax number is already registered after uppercase alphanumeric normalization (BR-ERP2-01). Tax numbers must be globally unique across all active vendors.',
    docReference: 'BR-ERP2-01',
    resolution: 'Verify existing vendor catalog in ERP-2 or re-map source tax number.',
  },
  DUPLICATE_PO_NUMBER: {
    code: 'DUPLICATE_PO_NUMBER',
    title: 'Duplicate Purchase Order Number',
    explanation:
      'Purchase order number is already registered (BR-ERP2-01 / FR-ERP2-03). PO numbers must be globally unique across active and historical records.',
    docReference: 'BR-ERP2-01',
    resolution: 'Verify existing PO catalog in ERP-2 or re-map source PO number.',
  },
  INVALID_PO_STATUS: {
    code: 'INVALID_PO_STATUS',
    title: 'Invalid Purchase Order Status',
    explanation:
      'PO status transitions are strictly unidirectional: Draft -> Sent -> Received -> Closed (FR-ERP2-04). Reverse or invalid transitions are rejected.',
    docReference: 'FR-ERP2-04',
    resolution: 'Map source status to one of the approved V1 lifecycle values: Draft, Sent, Received, Closed.',
  },
  NEGATIVE_QUANTITY: {
    code: 'NEGATIVE_QUANTITY',
    title: 'Negative or Zero Line Quantity',
    explanation:
      'PO line quantity must be strictly positive (> 0.0000) (FR-ERP2-03 / BR-ERP2-03). Negative or zero quantities are rejected.',
    docReference: 'FR-ERP2-03',
    resolution: 'Ensure line item quantity is greater than zero.',
  },
  NEGATIVE_PRICE: {
    code: 'NEGATIVE_PRICE',
    title: 'Negative Unit Price',
    explanation:
      'PO line unit price cannot be negative (FR-ERP2-03 / BR-ERP2-03). Must be a decimal >= 0.0000.',
    docReference: 'FR-ERP2-03',
    resolution: 'Ensure line item unit price is non-negative.',
  },
  UNRESOLVED_VENDOR_REFERENCE: {
    code: 'UNRESOLVED_VENDOR_REFERENCE',
    title: 'Unresolved Vendor Reference',
    explanation:
      'PO references a vendor UUID that does not exist in erp2_vendors (FR-ERP2-03). Vendor master must be loaded before purchase orders.',
    docReference: 'FR-ERP2-03',
    resolution: 'Import or create vendor master records in ERP-2 before loading purchase orders.',
  },
  UNRESOLVED_PRODUCT_REFERENCE: {
    code: 'UNRESOLVED_PRODUCT_REFERENCE',
    title: 'Unresolved ERP-1 Product Reference',
    explanation:
      'PO line product_id does not exist in ERP-1 product catalog (Decision C7 / FR-ERP2-03). Cross-module product references must resolve via the ERP-1 owning API.',
    docReference: 'Decision C7',
    resolution: 'Import or register product catalog items in ERP-1 before loading PO lines.',
  },
  TOTAL_MISMATCH: {
    code: 'TOTAL_MISMATCH',
    title: 'PO Total Mismatch',
    explanation:
      'PO total must equal the sum of ROUND_HALF_UP(quantity * price, 2) across all lines (BR-ERP2-03). Source total did not reconcile with computed line totals.',
    docReference: 'BR-ERP2-03',
    resolution: 'Allow server-side computed totals or reconcile source line arithmetic.',
  },
  INVALID_CURRENCY: {
    code: 'INVALID_CURRENCY',
    title: 'Invalid Currency Code',
    explanation:
      'Currency must be a valid 3-letter uppercase ISO-4217 code (e.g. USD, EUR, GBP, INR) (FR-ERP2-01 / FR-ERP2-03).',
    docReference: 'FR-ERP2-01',
    resolution: 'Standardize currency column to uppercase ISO-4217 format.',
  },
  MISSING_REQUIRED_FIELD: {
    code: 'MISSING_REQUIRED_FIELD',
    title: 'Missing Mandatory Field',
    explanation:
      'A required field (vendor name, tax_number, email, currency for vendors; po_number, vendor_id, order_date, status, currency for POs) is missing or blank (FR-ERP2-01 / FR-ERP2-03).',
    docReference: 'FR-ERP2-01',
    resolution: 'Populate all mandatory columns in source data before importing.',
  },
  BANK_DETAILS_EXPOSED: {
    code: 'BANK_DETAILS_EXPOSED',
    title: 'Bank Details Exposure Violation',
    explanation:
      'Raw bank account details must be masked server-side to XXXX-XXXX-LAST4 format in compliance with PCI/GDPR (BR-ERP2-02). Unmasked bank payloads are rejected.',
    docReference: 'BR-ERP2-02',
    resolution: 'Ensure bank details are masked before import using server-side masking utilities.',
  },
  SOURCE_VALUE_MUTATED: {
    code: 'SOURCE_VALUE_MUTATED',
    title: 'Raw Source Value Alteration',
    explanation:
      'Raw source provenance values must be preserved without destructive mutation (KIT-08).',
    docReference: 'KIT-08',
    resolution: 'Retain original source_system and source_id untouched.',
  },
};

/**
 * ERP-2 Vendors Module Rejection Context configuration.
 */
export const erp2VendorsRejectionContext: ModuleRejectionContext = {
  moduleId: 'erp-2',
  moduleName: 'ERP-2 Vendors and Purchasing',
  entity: 'vendors',

  identifierColumns: [
    {
      field: 'tax_number',
      label: 'Tax Number',
      isIdentifier: true,
      format: (val) => (val !== undefined && val !== null ? String(val).toUpperCase().trim() : '—'),
    },
    {
      field: 'name',
      label: 'Vendor Name',
      isIdentifier: true,
    },
    {
      field: 'source_id',
      label: 'Source ID',
      isIdentifier: true,
    },
    {
      field: 'currency',
      label: 'Currency',
    },
  ],

  additionalColumns: [
    {
      field: 'email',
      label: 'Contact Email',
    },
    {
      field: 'phone',
      label: 'Phone',
    },
    {
      field: 'country',
      label: 'Country',
    },
  ],

  sensitiveFields: [
    'bank_masked',
    'bank_account',
    'bankAccount',
    'bankAccountNumber',
    'bank_account_number',
    'routingNumber',
    'routing_number',
    'iban',
    'swift',
    'bic',
    'ssn',
    'social_security_number',
    'taxId',
    'tax_id',
    'salary',
    'compensation',
    'creditCard',
    'credit_card_number',
    'cvv',
    'pan',
    'pin',
    'password',
  ],

  failureExplanations: erp2FailureExplanations,

  contextualLinks: [
    {
      label: 'Search Vendors',
      getUrl: (row: RejectedRow) => {
        const taxNum = row.rawData['tax_number'];
        return `/erp2/vendors?search=${encodeURIComponent(typeof taxNum === 'string' ? taxNum : '')}`;
      },
    },
    {
      label: 'Data Dictionary',
      getUrl: () => 'docs/data-dictionaries/erp-2.md',
      openInNewTab: true,
    },
  ],
};

/**
 * ERP-2 Purchase Orders Module Rejection Context configuration.
 */
export const erp2PurchaseOrdersRejectionContext: ModuleRejectionContext = {
  moduleId: 'erp-2',
  moduleName: 'ERP-2 Vendors and Purchasing',
  entity: 'purchase_orders',

  identifierColumns: [
    {
      field: 'po_number',
      label: 'PO Number',
      isIdentifier: true,
      format: (val) => (val !== undefined && val !== null ? String(val).toUpperCase().trim() : '—'),
    },
    {
      field: 'vendor_id',
      label: 'Vendor ID',
      isIdentifier: true,
    },
    {
      field: 'source_id',
      label: 'Source ID',
      isIdentifier: true,
    },
    {
      field: 'currency',
      label: 'Currency',
    },
  ],

  additionalColumns: [
    {
      field: 'order_date',
      label: 'Order Date',
    },
    {
      field: 'status',
      label: 'PO Status',
    },
    {
      field: 'total',
      label: 'Total Amount',
    },
    {
      field: 'notes',
      label: 'Notes',
    },
  ],

  sensitiveFields: erp2VendorsRejectionContext.sensitiveFields,

  failureExplanations: erp2FailureExplanations,

  contextualLinks: [
    {
      label: 'Search Purchase Orders',
      getUrl: (row: RejectedRow) => {
        const poNum = row.rawData['po_number'];
        return `/erp2/purchase-orders?search=${encodeURIComponent(typeof poNum === 'string' ? poNum : '')}`;
      },
    },
    {
      label: 'Data Dictionary',
      getUrl: () => 'docs/data-dictionaries/erp-2.md',
      openInNewTab: true,
    },
  ],
};
