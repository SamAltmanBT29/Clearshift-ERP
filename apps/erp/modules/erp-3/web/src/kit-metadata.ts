/**
 * ERP-3 Sales Orders & Invoices — Web Migration Kit Metadata Integration (KIT-14 / H2 / ERP3-22)
 *
 * Supplies ERP-3's target schema metadata to the shared Migration Kit wizard.
 * Strictly adheres to the "Zero duplicate wizards" architecture rule (H2).
 *
 * Provides:
 * - Module target field definitions, human-readable labels, enum options, and required constraints.
 * - Dynamic metadata for sales orders, order lines, invoices, and invoice lines.
 * - Mapping defaults for legacy column name resolution.
 * - Automatic registration with the central MigrationKitRegistry.
 *
 * @module erp3/web/kit-metadata
 */

import type {
  ModuleKitMetadata,
  TargetEntityMetadata,
  TargetFieldDefinition,
} from '@cs/kit';
import { registerModuleKitMetadata } from '@cs/kit';

/**
 * 1. Sales Orders Target Schema
 */
export const erp3SalesOrdersTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'order_number',
    label: 'Order Number',
    type: 'string',
    required: true,
    description: 'Unique human-readable order number (e.g. SO-2026-0001)',
    rules: ['FR-ERP3-01', 'RL-01'],
    example: 'SO-2026-0001',
  },
  {
    name: 'customer_golden_id',
    label: 'Customer Golden ID',
    type: 'uuid',
    required: true,
    description: 'Mandatory UUID v4 referencing canonical CRM-1 customer identity (ADR-003)',
    rules: ['BR-ERP3-03', 'ADR-003'],
    example: '55555555-0003-4000-8000-000000000001',
  },
  {
    name: 'order_date',
    label: 'Order Date',
    type: 'date',
    required: true,
    description: 'Booking calendar date (YYYY-MM-DD)',
    rules: ['FR-ERP3-01', 'RL-01'],
    example: '2026-10-24',
  },
  {
    name: 'currency',
    label: 'Currency Code (ISO-4217)',
    type: 'string',
    required: true,
    description: 'Three-letter uppercase currency code (e.g. USD, EUR, GBP)',
    rules: ['FR-ERP3-01'],
    example: 'USD',
  },
  {
    name: 'status',
    label: 'Order Status',
    type: 'enum',
    required: true,
    description: 'Forward-only lifecycle status (Open, Invoiced, Closed)',
    enumOptions: ['Open', 'Invoiced', 'Closed'],
    rules: ['FR-ERP3-05'],
    example: 'Open',
  },
  {
    name: 'subtotal',
    label: 'Subtotal Amount',
    type: 'decimal',
    required: false,
    description: 'Server-computed pre-tax sum of line items stored as numeric(19,4)',
    rules: ['BR-ERP3-01'],
    example: '200.0000',
  },
  {
    name: 'tax_total',
    label: 'Tax Total Amount',
    type: 'decimal',
    required: false,
    description: 'Server-computed total tax stored as numeric(19,4)',
    rules: ['BR-ERP3-02'],
    example: '20.0000',
  },
  {
    name: 'total',
    label: 'Total Order Amount',
    type: 'decimal',
    required: false,
    description: 'Authoritative server-computed grand total stored as numeric(19,4)',
    rules: ['BR-ERP3-01'],
    example: '220.0000',
  },
  {
    name: 'customer_email',
    label: 'Customer Email',
    type: 'string',
    required: false,
    description: 'Operational customer contact email for order notifications',
    rules: ['RL-02'],
    example: 'billing@customer.synthetic',
  },
  {
    name: 'customer_phone',
    label: 'Customer Phone',
    type: 'string',
    required: false,
    description: 'Contact telephone number for order inquiries',
    rules: ['RL-02'],
    example: '+1-555-0144',
  },
  {
    name: 'notes',
    label: 'Order Notes',
    type: 'string',
    required: false,
    description: 'Optional customer instructions or notes',
    rules: ['RL-02'],
    example: 'Expedite delivery for production run Alpha',
  },
  {
    name: 'source_system',
    label: 'Source System',
    type: 'string',
    required: false,
    description: 'Original legacy system name (preserved immutably)',
    rules: ['KIT-08'],
    example: 'SAP_R3_LEGACY',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: false,
    description: 'Original primary key in source system for idempotency',
    rules: ['KIT-08'],
    example: 'SO-994821',
  },
];

export const erp3SalesOrdersTargetMetadata: TargetEntityMetadata = {
  entity: 'sales_orders',
  label: 'Sales Orders',
  module: 'erp3',
  schemaVersion: 1,
  targetTable: 'erp3_sales_orders',
  primaryKey: 'id',
  naturalKey: 'order_number',
  fields: erp3SalesOrdersTargetFields,
  mappingDefaults: {
    order_number: 'order_number',
    customer_golden_id: 'customer_golden_id',
    order_date: 'order_date',
    currency: 'currency',
    status: 'status',
    subtotal: 'subtotal',
    tax_total: 'tax_total',
    total: 'total',
    customer_email: 'customer_email',
    customer_phone: 'customer_phone',
    notes: 'notes',
    source_system: 'source_system',
    source_id: 'source_id',
  },
  validationRules: [
    {
      code: 'BR-ERP3-03',
      description: 'Customer Golden ID is mandatory and must be a valid UUID v4',
    },
    {
      code: 'BR-ERP3-01',
      description: 'Order total is server-computed: line_total = (qty * price) + tax, total = sum(line_total)',
    },
    {
      code: 'FR-ERP3-05',
      description: 'Order status transitions are strictly forward-only: Open -> Invoiced -> Closed',
    },
    {
      code: 'KIT-08',
      description: 'Import never mutates raw source values (source_system and source_id are preserved)',
    },
  ],
};

/**
 * 2. Sales Order Lines Target Schema
 */
export const erp3SoLinesTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'order_id',
    label: 'Sales Order ID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing the parent sales order record',
    rules: ['FR-ERP3-01'],
    example: 'aaaaaaaa-0003-4000-8000-000000000101',
  },
  {
    name: 'line_number',
    label: 'Line Number',
    type: 'number',
    required: true,
    description: '1-based sequential line item position within the order',
    rules: ['FR-ERP3-01'],
    example: 1,
  },
  {
    name: 'product_id',
    label: 'Product ID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing ERP-1 product catalog item',
    rules: ['FR-ERP3-01', 'Decision C7'],
    example: '11111111-0001-4000-8000-000000000001',
  },
  {
    name: 'quantity',
    label: 'Ordered Quantity',
    type: 'decimal',
    required: true,
    description: 'Strictly positive ordered quantity stored as numeric(12,4)',
    rules: ['BR-ERP3-01'],
    example: '10.0000',
  },
  {
    name: 'unit_price',
    label: 'Unit Selling Price',
    type: 'decimal',
    required: true,
    description: 'Non-negative unit selling price stored as numeric(19,4)',
    rules: ['BR-ERP3-01'],
    example: '25.5000',
  },
  {
    name: 'tax_rate',
    label: 'Tax Rate (%)',
    type: 'decimal',
    required: false,
    description: 'Tax rate percentage in range 0.00% to 100.00%',
    rules: ['BR-ERP3-02'],
    example: '10.0000',
  },
  {
    name: 'tax_amount',
    label: 'Line Tax Amount',
    type: 'decimal',
    required: false,
    description: 'Server-computed line tax amount stored as numeric(19,4)',
    rules: ['BR-ERP3-02'],
    example: '25.5000',
  },
  {
    name: 'line_total',
    label: 'Line Total Amount',
    type: 'decimal',
    required: false,
    description: 'Server-computed line total (qty * price + tax) stored as numeric(19,4)',
    rules: ['BR-ERP3-01'],
    example: '280.5000',
  },
];

export const erp3SoLinesTargetMetadata: TargetEntityMetadata = {
  entity: 'so_lines',
  label: 'Sales Order Lines',
  module: 'erp3',
  schemaVersion: 1,
  targetTable: 'erp3_so_lines',
  primaryKey: 'id',
  fields: erp3SoLinesTargetFields,
  mappingDefaults: {
    order_id: 'order_id',
    line_number: 'line_number',
    product_id: 'product_id',
    quantity: 'quantity',
    unit_price: 'unit_price',
    tax_rate: 'tax_rate',
    tax_amount: 'tax_amount',
    line_total: 'line_total',
  },
  validationRules: [
    {
      code: 'BR-ERP3-01',
      description: 'Ordered quantity must be strictly positive (> 0); unit price must be non-negative (>= 0)',
    },
    {
      code: 'BR-ERP3-02',
      description: 'Tax rate must be between 0 and 100; line tax computed using exact integer scaling',
    },
  ],
};

/**
 * 3. Invoices Target Schema
 */
export const erp3InvoicesTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'invoice_number',
    label: 'Invoice Number',
    type: 'string',
    required: true,
    description: 'Unique human-readable invoice identifier (e.g. INV-2026-0001)',
    rules: ['FR-ERP3-02', 'RL-01'],
    example: 'INV-2026-0001',
  },
  {
    name: 'order_id',
    label: 'Sales Order ID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing parent sales order (1:1 in V1)',
    rules: ['FR-ERP3-02'],
    example: 'aaaaaaaa-0003-4000-8000-000000000101',
  },
  {
    name: 'customer_golden_id',
    label: 'Customer Golden ID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing canonical CRM-1 customer identity',
    rules: ['BR-ERP3-03', 'ADR-003'],
    example: '55555555-0003-4000-8000-000000000001',
  },
  {
    name: 'invoice_date',
    label: 'Invoice Issue Date',
    type: 'date',
    required: true,
    description: 'Issue calendar date in ISO format (YYYY-MM-DD)',
    rules: ['FR-ERP3-02', 'RL-01'],
    example: '2026-10-24',
  },
  {
    name: 'due_date',
    label: 'Payment Due Date',
    type: 'date',
    required: true,
    description: 'Mandatory payment due date; must satisfy due_date >= invoice_date (DR-2)',
    rules: ['DR-2', 'FR-ERP3-02'],
    example: '2026-11-24',
  },
  {
    name: 'currency',
    label: 'Currency Code (ISO-4217)',
    type: 'string',
    required: true,
    description: 'Three-letter uppercase currency code (e.g. USD, EUR, GBP)',
    rules: ['FR-ERP3-02'],
    example: 'USD',
  },
  {
    name: 'status',
    label: 'Invoice Status',
    type: 'enum',
    required: true,
    description: 'Invoice lifecycle status (Open, Paid, Overdue)',
    enumOptions: ['Open', 'Paid', 'Overdue'],
    rules: ['FR-ERP3-02', 'FR-ERP3-04'],
    example: 'Open',
  },
  {
    name: 'subtotal',
    label: 'Subtotal Amount',
    type: 'decimal',
    required: false,
    description: 'Server-computed pre-tax sum of invoice lines stored as numeric(19,4)',
    rules: ['BR-ERP3-01'],
    example: '200.0000',
  },
  {
    name: 'tax_total',
    label: 'Tax Total Amount',
    type: 'decimal',
    required: false,
    description: 'Server-computed total tax stored as numeric(19,4)',
    rules: ['BR-ERP3-02'],
    example: '20.0000',
  },
  {
    name: 'total',
    label: 'Total Invoice Amount',
    type: 'decimal',
    required: false,
    description: 'Authoritative server-computed grand invoice total stored as numeric(19,4)',
    rules: ['BR-ERP3-01'],
    example: '220.0000',
  },
  {
    name: 'source_system',
    label: 'Source System',
    type: 'string',
    required: false,
    description: 'Original legacy system name preserved immutably',
    rules: ['KIT-08'],
    example: 'SAP_R3_LEGACY',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: false,
    description: 'Original primary key in source system for idempotency',
    rules: ['KIT-08'],
    example: 'INV-884920',
  },
];

export const erp3InvoicesTargetMetadata: TargetEntityMetadata = {
  entity: 'invoices',
  label: 'Billing Invoices',
  module: 'erp3',
  schemaVersion: 1,
  targetTable: 'erp3_invoices',
  primaryKey: 'id',
  naturalKey: 'invoice_number',
  fields: erp3InvoicesTargetFields,
  mappingDefaults: {
    invoice_number: 'invoice_number',
    order_id: 'order_id',
    customer_golden_id: 'customer_golden_id',
    invoice_date: 'invoice_date',
    due_date: 'due_date',
    currency: 'currency',
    status: 'status',
    subtotal: 'subtotal',
    tax_total: 'tax_total',
    total: 'total',
    source_system: 'source_system',
    source_id: 'source_id',
  },
  validationRules: [
    {
      code: 'DR-2',
      description: 'Invoice due_date must be greater than or equal to invoice_date',
    },
    {
      code: 'FR-ERP3-02',
      description: 'Single invoice per sales order in V1; multiple invoices per order rejected',
    },
  ],
};

/**
 * 4. Invoice Lines Target Schema
 */
export const erp3InvoiceLinesTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'invoice_id',
    label: 'Invoice ID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing parent billing invoice',
    rules: ['FR-ERP3-02'],
    example: 'cccccccc-0003-4000-8000-000000000201',
  },
  {
    name: 'line_number',
    label: 'Line Number',
    type: 'number',
    required: true,
    description: '1-based sequential line item position within the invoice',
    rules: ['FR-ERP3-02'],
    example: 1,
  },
  {
    name: 'product_id',
    label: 'Product ID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing ERP-1 product catalog item',
    rules: ['FR-ERP3-02', 'Decision C7'],
    example: '11111111-0001-4000-8000-000000000001',
  },
  {
    name: 'quantity',
    label: 'Invoiced Quantity',
    type: 'decimal',
    required: true,
    description: 'Non-negative invoiced quantity stored as numeric(12,4)',
    rules: ['BR-ERP3-01'],
    example: '10.0000',
  },
  {
    name: 'unit_price',
    label: 'Unit Price',
    type: 'decimal',
    required: true,
    description: 'Non-negative selling unit price stored as numeric(19,4)',
    rules: ['BR-ERP3-01'],
    example: '25.5000',
  },
  {
    name: 'tax_rate',
    label: 'Tax Rate (%)',
    type: 'decimal',
    required: false,
    description: 'Tax percentage stored as numeric(6,4)',
    rules: ['BR-ERP3-02'],
    example: '10.0000',
  },
  {
    name: 'tax_amount',
    label: 'Line Tax Amount',
    type: 'decimal',
    required: false,
    description: 'Server-computed line tax amount stored as numeric(19,4)',
    rules: ['BR-ERP3-02'],
    example: '25.5000',
  },
  {
    name: 'line_total',
    label: 'Line Total Amount',
    type: 'decimal',
    required: false,
    description: 'Server-computed line total (qty * price + tax) stored as numeric(19,4)',
    rules: ['BR-ERP3-01'],
    example: '280.5000',
  },
];

export const erp3InvoiceLinesTargetMetadata: TargetEntityMetadata = {
  entity: 'invoice_lines',
  label: 'Invoice Line Items',
  module: 'erp3',
  schemaVersion: 1,
  targetTable: 'erp3_invoice_lines',
  primaryKey: 'id',
  fields: erp3InvoiceLinesTargetFields,
  mappingDefaults: {
    invoice_id: 'invoice_id',
    line_number: 'line_number',
    product_id: 'product_id',
    quantity: 'quantity',
    unit_price: 'unit_price',
    tax_rate: 'tax_rate',
    tax_amount: 'tax_amount',
    line_total: 'line_total',
  },
  validationRules: [
    {
      code: 'BR-ERP3-01',
      description: 'Invoiced quantity must be strictly positive; unit price must be non-negative',
    },
  ],
};

/**
 * Web-Facing ERP-3 Module Kit Metadata
 */
export const erp3WebKitMetadata: ModuleKitMetadata = {
  moduleId: 'erp3',
  moduleName: 'ERP-3 Sales Orders and Invoices',
  defaultEntity: 'sales_orders',
  entities: {
    sales_orders: erp3SalesOrdersTargetMetadata,
    so_lines: erp3SoLinesTargetMetadata,
    invoices: erp3InvoicesTargetMetadata,
    invoice_lines: erp3InvoiceLinesTargetMetadata,
  },
  supportedSourceTypes: ['csv', 'json'],
};

// Auto-register with shared MigrationKitRegistry (AC 1)
registerModuleKitMetadata(erp3WebKitMetadata);
