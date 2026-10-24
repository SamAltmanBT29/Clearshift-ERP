/**
 * ERP-2 Vendors & Purchasing — Migration Kit Field Registry (KIT-14 / H2 / ERP2-22)
 *
 * Registers ERP-2 target schema metadata with the central Migration Kit registry.
 * Defines target field attributes, human-readable labels, enum options, and required constraints
 * across all three owned domain entities:
 * 1. Vendors (erp2_vendors)
 * 2. Purchase Orders (erp2_purchase_orders)
 * 3. Purchase Order Lines (erp2_po_lines)
 *
 * Invariants Enforced:
 * - Natural key uniqueness for vendors (tax_number) and purchase orders (po_number) (BR-ERP2-01, FR-ERP2-01)
 * - Explicit PO lifecycle states: Draft -> Sent -> Received -> Closed (FR-ERP2-04)
 * - Decimal pricing and non-negative currency amounts stored with documented rounding (FR-ERP2-03, BR-ERP2-03)
 * - Bank details masked server-side to XXXX-XXXX-7890 and excluded from exports (FR-ERP2-02, BR-ERP2-02)
 * - Cross-module PO line references to existing ERP-1 product IDs (FR-ERP2-03, Decision C7)
 * - Exact duplicate matching and raw source preservation (KIT-08)
 *
 * @module erp2/kit/field-registry
 */

import type {
  ModuleKitMetadata,
  TargetEntityMetadata,
  TargetFieldDefinition,
} from '@cs/kit';
import { migrationKitRegistry } from '@cs/kit';

/**
 * 1. Vendors Target Entity Metadata (FR-ERP2-01, FR-ERP2-02, BR-ERP2-01)
 */
export const erp2VendorsFields: readonly TargetFieldDefinition[] = [
  {
    name: 'name',
    label: 'Vendor Name',
    type: 'string',
    required: true,
    description: 'Commercial organization or supplier legal trade name',
    rules: ['FR-ERP2-01', 'RL-01'],
    example: 'Acme Industrial Supplies Ltd',
  },
  {
    name: 'tax_number',
    label: 'Tax Identification Number',
    type: 'string',
    required: true,
    description: 'Unique tax identifier / VAT number after uppercase alphanumeric normalization',
    rules: ['FR-ERP2-01', 'BR-ERP2-01', 'RL-03'],
    example: 'TAX-ACME-9901',
  },
  {
    name: 'email',
    label: 'Contact Email',
    type: 'string',
    required: true,
    description: 'Official procurement or accounts payable contact email',
    rules: ['FR-ERP2-01', 'RL-02'],
    example: 'procurement@acme.synthetic',
  },
  {
    name: 'phone',
    label: 'Phone Number',
    type: 'string',
    required: false,
    description: 'Primary telephone or dispatch contact number',
    rules: ['FR-ERP2-01'],
    example: '+1-555-0199',
  },
  {
    name: 'address_line',
    label: 'Address Line',
    type: 'string',
    required: false,
    description: 'Street address or warehouse dispatch location',
    rules: ['FR-ERP2-01'],
    example: '456 Supply Chain Blvd',
  },
  {
    name: 'city',
    label: 'City',
    type: 'string',
    required: false,
    description: 'Municipality or city of vendor corporate registration',
    rules: ['FR-ERP2-01'],
    example: 'Detroit',
  },
  {
    name: 'country',
    label: 'Country',
    type: 'string',
    required: false,
    description: 'Country of incorporation or operations',
    rules: ['FR-ERP2-01'],
    example: 'USA',
  },
  {
    name: 'currency',
    label: 'Default Currency (ISO-4217)',
    type: 'string',
    required: true,
    description: 'Three-letter uppercase currency code (e.g. USD, EUR, GBP, INR)',
    rules: ['FR-ERP2-01'],
    example: 'USD',
  },
  {
    name: 'bank_masked',
    label: 'Masked Bank Details',
    type: 'string',
    required: false,
    description: 'PCI/GDPR sensitive bank details masked server-side to XXXX-XXXX-7890',
    rules: ['FR-ERP2-02', 'BR-ERP2-02'],
    example: 'XXXX-XXXX-7890',
  },
  {
    name: 'source_system',
    label: 'Source System',
    type: 'string',
    required: false,
    description: 'Originating legacy platform identifier (e.g. SAP_ECC, NAV_2018)',
    rules: ['KIT-08'],
    example: 'SAP_ECC',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: false,
    description: 'Original record identifier from source platform for durable lineage tracking',
    rules: ['KIT-08'],
    example: 'VEND-8821',
  },
];

export const erp2VendorsMetadata: TargetEntityMetadata = {
  entity: 'vendors',
  label: 'Vendor Master Records',
  module: 'erp2',
  schemaVersion: 1,
  targetTable: 'erp2_vendors',
  primaryKey: 'id',
  naturalKey: 'tax_number',
  fields: erp2VendorsFields,
  mappingDefaults: {
    name: 'vendor_name',
    tax_number: 'tax_id',
    email: 'email',
    phone: 'phone',
    address_line: 'address',
    city: 'city',
    country: 'country',
    currency: 'currency',
    bank_masked: 'bank_account',
    source_system: 'source_system',
    source_id: 'source_id',
  },
  validationRules: [
    {
      code: 'FR-ERP2-01',
      description: 'Vendor name, tax_number, email, and currency are mandatory',
    },
    {
      code: 'BR-ERP2-01',
      description: 'Tax number must be unique across all active vendors',
    },
    {
      code: 'BR-ERP2-02',
      description: 'Bank details must be masked server-side in compliance with PCI/GDPR',
    },
  ],
};

/**
 * 2. Purchase Orders Target Entity Metadata (FR-ERP2-03, FR-ERP2-04)
 */
export const erp2PurchaseOrdersFields: readonly TargetFieldDefinition[] = [
  {
    name: 'po_number',
    label: 'PO Number',
    type: 'string',
    required: true,
    description: 'Unique purchase order tracking reference code',
    rules: ['FR-ERP2-03', 'BR-ERP2-01'],
    example: 'PO-2026-0001',
  },
  {
    name: 'vendor_id',
    label: 'Vendor UUID',
    type: 'uuid',
    required: true,
    description: 'UUID reference to owning vendor record in erp2_vendors',
    rules: ['FR-ERP2-03'],
    example: 'a1111111-1111-4111-8111-111111111111',
  },
  {
    name: 'order_date',
    label: 'Order Date (ISO-8601)',
    type: 'date',
    required: true,
    description: 'Date of order issuance in YYYY-MM-DD format',
    rules: ['FR-ERP2-03'],
    example: '2026-03-15',
  },
  {
    name: 'status',
    label: 'Lifecycle Status',
    type: 'enum',
    required: true,
    description: 'Unidirectional purchase order lifecycle transition state',
    enumOptions: ['Draft', 'Sent', 'Received', 'Closed'],
    rules: ['FR-ERP2-04'],
    example: 'Draft',
  },
  {
    name: 'currency',
    label: 'Currency (ISO-4217)',
    type: 'string',
    required: true,
    description: 'Three-letter currency symbol for all monetary totals on this order',
    rules: ['FR-ERP2-03'],
    example: 'USD',
  },
  {
    name: 'total',
    label: 'Order Total',
    type: 'decimal',
    required: true,
    description: 'Computed non-negative decimal order sum with 2 decimal places',
    rules: ['FR-ERP2-03', 'BR-ERP2-03'],
    example: '1250.50',
  },
  {
    name: 'notes',
    label: 'Order Notes',
    type: 'string',
    required: false,
    description: 'Optional operational instructions or shipment terms',
    rules: ['FR-ERP2-03'],
    example: 'Expedited shipping requested',
  },
  {
    name: 'source_system',
    label: 'Source System',
    type: 'string',
    required: false,
    description: 'Originating legacy platform identifier',
    rules: ['KIT-08'],
    example: 'NAV_2018',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: false,
    description: 'Original record identifier from source platform',
    rules: ['KIT-08'],
    example: 'PO-90021',
  },
];

export const erp2PurchaseOrdersMetadata: TargetEntityMetadata = {
  entity: 'purchase_orders',
  label: 'Purchase Orders',
  module: 'erp2',
  schemaVersion: 1,
  targetTable: 'erp2_purchase_orders',
  primaryKey: 'id',
  naturalKey: 'po_number',
  fields: erp2PurchaseOrdersFields,
  mappingDefaults: {
    po_number: 'po_number',
    vendor_id: 'vendor_id',
    order_date: 'order_date',
    status: 'status',
    currency: 'currency',
    total: 'total',
    notes: 'notes',
    source_system: 'source_system',
    source_id: 'source_id',
  },
  validationRules: [
    {
      code: 'FR-ERP2-04',
      description: 'Status must be one of: Draft, Sent, Received, Closed',
    },
    {
      code: 'BR-ERP2-03',
      description: 'Order total must equal sum of rounded decimal line totals',
    },
  ],
};

/**
 * 3. Purchase Order Lines Target Entity Metadata (FR-ERP2-03, Decision C7)
 */
export const erp2PoLinesFields: readonly TargetFieldDefinition[] = [
  {
    name: 'po_id',
    label: 'Purchase Order UUID',
    type: 'uuid',
    required: true,
    description: 'UUID reference to parent header in erp2_purchase_orders',
    rules: ['FR-ERP2-03'],
    example: 'b1111111-1111-4111-8111-111111111111',
  },
  {
    name: 'product_id',
    label: 'Product UUID (ERP-1 Catalog)',
    type: 'uuid',
    required: true,
    description: 'UUID reference to existing product in ERP-1 catalog (cross-module)',
    rules: ['FR-ERP2-03', 'Decision C7'],
    example: 'c1111111-1111-4111-8111-111111111111',
  },
  {
    name: 'line_number',
    label: 'Line Number',
    type: 'number',
    required: true,
    description: 'Sequential 1-based line sequence within the purchase order',
    rules: ['FR-ERP2-03'],
    example: 1,
  },
  {
    name: 'quantity',
    label: 'Quantity',
    type: 'decimal',
    required: true,
    description: 'Strictly positive ordered quantity stored as numeric(12,2)',
    rules: ['FR-ERP2-03', 'BR-ERP2-03'],
    example: '10.00',
  },
  {
    name: 'price',
    label: 'Unit Price',
    type: 'decimal',
    required: true,
    description: 'Non-negative agreed unit price stored as numeric(18,2)',
    rules: ['FR-ERP2-03', 'BR-ERP2-03'],
    example: '125.05',
  },
  {
    name: 'line_total',
    label: 'Line Total',
    type: 'decimal',
    required: true,
    description: 'Computed line total: ROUND_HALF_UP(quantity * price, 2)',
    rules: ['FR-ERP2-03', 'BR-ERP2-03'],
    example: '1250.50',
  },
];

export const erp2PoLinesMetadata: TargetEntityMetadata = {
  entity: 'po_lines',
  label: 'Purchase Order Line Items',
  module: 'erp2',
  schemaVersion: 1,
  targetTable: 'erp2_po_lines',
  primaryKey: 'id',
  naturalKey: 'po_id,line_number',
  fields: erp2PoLinesFields,
  mappingDefaults: {
    po_id: 'po_id',
    product_id: 'product_id',
    line_number: 'line_number',
    quantity: 'quantity',
    price: 'unit_price',
    line_total: 'line_total',
  },
  validationRules: [
    {
      code: 'FR-ERP2-03',
      description: 'Line number must be unique per purchase order',
    },
    {
      code: 'Decision C7',
      description: 'product_id must resolve to a valid ERP-1 product master record',
    },
  ],
};

/**
 * Top-Level Module Kit Metadata for ERP-2
 */
export const erp2KitMetadata: ModuleKitMetadata = {
  moduleId: 'erp2',
  moduleName: 'ERP-2 Vendors and Purchasing',
  defaultEntity: 'vendors',
  entities: {
    vendors: erp2VendorsMetadata,
    purchase_orders: erp2PurchaseOrdersMetadata,
    po_lines: erp2PoLinesMetadata,
  },
  supportedSourceTypes: ['csv', 'json'],
};

// Auto-register with central MigrationKitRegistry on module evaluation (AC 1)
migrationKitRegistry.register(erp2KitMetadata);
