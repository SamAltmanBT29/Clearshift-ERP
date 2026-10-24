/**
 * ERP-3 Sales Orders & Invoices — Rejection Review Context (KIT-16 / ERP3-23)
 *
 * Configures module context for the shared Migration Kit rejection review and
 * export screens.
 *
 * Guarantees:
 * - Module-specific identifier columns (Order Number, Customer Golden ID, Source ID, Currency) alongside standard error codes (AC1).
 * - Human-readable reason text explaining validation or constraint failures (AC2).
 * - Automatic masking/exclusion of sensitive financial, bank, or employee fields (AC3).
 * - Formula-safe CSV export downloads filtered rejected rows with correct headers (AC4).
 *
 * @module erp3/kit/rejection-context
 */

import type {
  ModuleRejectionContext,
  FailureExplanation,
  RejectedRow,
} from '@cs/kit';

/**
 * Standardized failure explanations for ERP-3 domain errors.
 */
export const erp3FailureExplanations: Readonly<Record<string, FailureExplanation>> = {
  DUPLICATE_ORDER_NUMBER: {
    code: 'DUPLICATE_ORDER_NUMBER',
    title: 'Duplicate Order Number',
    explanation:
      'Sales order number is already registered after normalization (BR-ERP3-01 / FR-ERP3-01). Order numbers must be globally unique across active and historical records.',
    docReference: 'BR-ERP3-01',
    resolution: 'Verify existing order catalog in ERP-3 or re-map source order number.',
  },
  MISSING_CUSTOMER_GOLDEN_ID: {
    code: 'MISSING_CUSTOMER_GOLDEN_ID',
    title: 'Missing Customer Golden ID',
    explanation:
      'Customer reference must resolve to a valid canonical UUID v4 Golden ID from Hub / CRM-1 (BR-ERP3-03 / ADR-003).',
    docReference: 'BR-ERP3-03',
    resolution: 'Ensure customer is master-keyed in CRM-1 Hub before migrating sales orders.',
  },
  INVALID_ORDER_STATUS: {
    code: 'INVALID_ORDER_STATUS',
    title: 'Invalid Order Status',
    explanation:
      'Order status transitions are strictly forward-only: Open -> Invoiced -> Closed (FR-ERP3-05).',
    docReference: 'FR-ERP3-05',
    resolution: 'Map source status to an allowed V1 lifecycle status (Open, Invoiced, Closed).',
  },
  NEGATIVE_QUANTITY: {
    code: 'NEGATIVE_QUANTITY',
    title: 'Negative or Zero Line Quantity',
    explanation:
      'Ordered line quantity must be strictly positive (> 0.0000) (BR-ERP3-01 / FR-ERP3-01).',
    docReference: 'BR-ERP3-01',
    resolution: 'Ensure line quantity is greater than zero.',
  },
  NEGATIVE_UNIT_PRICE: {
    code: 'NEGATIVE_UNIT_PRICE',
    title: 'Negative Unit Price',
    explanation:
      'Selling unit price cannot be negative (BR-ERP3-01). Must be a decimal >= 0.0000.',
    docReference: 'BR-ERP3-01',
    resolution: 'Ensure line item unit price is non-negative.',
  },
  INVALID_CURRENCY: {
    code: 'INVALID_CURRENCY',
    title: 'Invalid Currency Code',
    explanation:
      'Currency must be a valid 3-letter uppercase ISO-4217 code (e.g. USD, EUR, GBP) (FR-ERP3-01).',
    docReference: 'FR-ERP3-01',
    resolution: 'Standardize currency column to uppercase ISO-4217 format.',
  },
  INVALID_INVOICE_DUE_DATE: {
    code: 'INVALID_INVOICE_DUE_DATE',
    title: 'Invalid Invoice Due Date',
    explanation:
      'Invoice payment due date must be greater than or equal to invoice issue date (DR-2 / FR-ERP3-02).',
    docReference: 'DR-2',
    resolution: 'Adjust due_date so that due_date >= invoice_date.',
  },
  MULTIPLE_INVOICES_PER_ORDER: {
    code: 'MULTIPLE_INVOICES_PER_ORDER',
    title: 'Multiple Invoices for Single Order Rejected',
    explanation:
      'ClearShift V1 strictly enforces a 1:1 relationship between sales orders and billing invoices (FR-ERP3-02). Multiple invoices for one order are rejected.',
    docReference: 'FR-ERP3-02',
    resolution: 'Consolidate billings into a single invoice per sales order for V1.',
  },
  UNRESOLVED_PRODUCT_REFERENCE: {
    code: 'UNRESOLVED_PRODUCT_REFERENCE',
    title: 'Unresolved ERP-1 Product Reference',
    explanation:
      'Product ID reference does not exist in ERP-1 product catalog (Decision C7 / FR-ERP3-01). Cross-module references must resolve via owning API.',
    docReference: 'Decision C7',
    resolution: 'Import or register product catalog items in ERP-1 before loading order lines.',
  },
  SOURCE_VALUE_MUTATED: {
    code: 'SOURCE_VALUE_MUTATED',
    title: 'Raw Source Value Alteration',
    explanation:
      'Raw source provenance values must be preserved without destructive mutation (KIT-08).',
    docReference: 'KIT-08',
    resolution: 'Retain original source_system and source_id untouched.',
  },
  TOTAL_MISMATCH: {
    code: 'TOTAL_MISMATCH',
    title: 'Line Item Total Mismatch',
    explanation:
      'Order total is server-computed: line_total = (qty * price) + tax, total = sum(line_total) (BR-ERP3-01). Source total did not reconcile.',
    docReference: 'BR-ERP3-01',
    resolution: 'Allow server-side computed totals or reconcile source line arithmetic.',
  },
  MISSING_REQUIRED_FIELD: {
    code: 'MISSING_REQUIRED_FIELD',
    title: 'Missing Mandatory Field',
    explanation:
      'A mandatory field (order_number, customer_golden_id, order_date, currency, status) is missing or blank (FR-ERP3-01).',
    docReference: 'FR-ERP3-01',
    resolution: 'Populate all required fields in source data prior to importing.',
  },
};

/**
 * ERP-3 Sales Orders Module Rejection Context configuration.
 */
export const erp3OrdersRejectionContext: ModuleRejectionContext = {
  moduleId: 'erp3',
  moduleName: 'ERP-3 Sales Orders and Invoices',
  entity: 'sales_orders',

  identifierColumns: [
    {
      field: 'order_number',
      label: 'Order Number',
      isIdentifier: true,
      format: (val) => (val !== undefined && val !== null ? String(val).toUpperCase().trim() : '—'),
    },
    {
      field: 'customer_golden_id',
      label: 'Customer Golden ID',
      isIdentifier: true,
    },
    {
      field: 'source_id',
      label: 'Source ID',
      isIdentifier: true,
    },
    {
      field: 'currency',
      label: 'Currency Code',
    },
  ],

  additionalColumns: [
    {
      field: 'order_date',
      label: 'Order Date',
    },
    {
      field: 'status',
      label: 'Order Status',
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

  sensitiveFields: [
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

  failureExplanations: erp3FailureExplanations,

  contextualLinks: [
    {
      label: 'Search Orders',
      getUrl: (row: RejectedRow) => {
        const orderNum = row.rawData['order_number'];
        return `/erp3/sales-orders?search=${encodeURIComponent(typeof orderNum === 'string' ? orderNum : '')}`;
      },
    },
    {
      label: 'Data Dictionary',
      getUrl: () => 'docs/data-dictionaries/erp-3.md',
      openInNewTab: true,
    },
  ],
};

/**
 * ERP-3 Invoices Module Rejection Context configuration.
 */
export const erp3InvoicesRejectionContext: ModuleRejectionContext = {
  moduleId: 'erp3',
  moduleName: 'ERP-3 Sales Orders and Invoices',
  entity: 'invoices',

  identifierColumns: [
    {
      field: 'invoice_number',
      label: 'Invoice Number',
      isIdentifier: true,
      format: (val) => (val !== undefined && val !== null ? String(val).toUpperCase().trim() : '—'),
    },
    {
      field: 'order_id',
      label: 'Order ID',
      isIdentifier: true,
    },
    {
      field: 'customer_golden_id',
      label: 'Customer Golden ID',
      isIdentifier: true,
    },
    {
      field: 'source_id',
      label: 'Source ID',
      isIdentifier: true,
    },
  ],

  additionalColumns: [
    {
      field: 'invoice_date',
      label: 'Invoice Date',
    },
    {
      field: 'due_date',
      label: 'Due Date',
    },
    {
      field: 'status',
      label: 'Invoice Status',
    },
    {
      field: 'total',
      label: 'Total Amount',
    },
  ],

  sensitiveFields: erp3OrdersRejectionContext.sensitiveFields,
  failureExplanations: erp3FailureExplanations,

  contextualLinks: [
    {
      label: 'Search Invoices',
      getUrl: (row: RejectedRow) => {
        const invNum = row.rawData['invoice_number'];
        return `/erp3/invoices?search=${encodeURIComponent(typeof invNum === 'string' ? invNum : '')}`;
      },
    },
    {
      label: 'Data Dictionary',
      getUrl: () => 'docs/data-dictionaries/erp-3.md',
      openInNewTab: true,
    },
  ],
};
