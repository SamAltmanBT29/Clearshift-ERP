/**
 * ERP-1 Products & Inventory — Web Migration Kit Metadata Integration (KIT-14 / H2 / ERP1-22)
 *
 * Supplies ERP-1's target schema metadata to the shared Migration Kit wizard.
 * Strictly adheres to the "Zero duplicate wizards" architecture rule (H2).
 *
 * Provides:
 * - Module target field definitions, human-readable labels, enum options, and required constraints.
 * - Dynamic metadata for products, categories, warehouses, and stock levels.
 * - Mapping defaults for legacy column name resolution.
 * - Automatic registration with the central MigrationKitRegistry.
 *
 * @module erp1/web/kit-metadata
 */

import type {
  ModuleKitMetadata,
  TargetEntityMetadata,
  TargetFieldDefinition,
} from '@cs/kit';
import { migrationKitRegistry, registerModuleKitMetadata } from '@cs/kit';

/**
 * 1. Product Master Data Target Schema
 */
export const erp1ProductsTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'name',
    label: 'Product Name',
    type: 'string',
    required: true,
    description: 'Commercial title / product display name',
    rules: ['FR-ERP1-01', 'RL-01'],
    example: 'Industrial Precision Ball Bearing 608-ZZ',
  },
  {
    name: 'sku',
    label: 'Stock Keeping Unit (SKU)',
    type: 'string',
    required: true,
    description: 'Unique inventory code after normalization (trim and uppercase)',
    rules: ['FR-ERP1-01', 'BR-ERP1-01', 'RL-03'],
    example: 'SKU-IND-608ZZ',
  },
  {
    name: 'categoryId',
    label: 'Category ID',
    type: 'uuid',
    required: false,
    description: 'Optional UUID link to single-level category (erp1_categories)',
    rules: ['FR-ERP1-03'],
    example: 'c1111111-1111-4111-8111-111111111111',
  },
  {
    name: 'unitOfMeasure',
    label: 'Unit of Measure',
    type: 'enum',
    required: true,
    description: 'Fixed V1 unit of measure list per FR-ERP1-04',
    enumOptions: ['pcs', 'kg', 'g', 'litre', 'metre', 'box'],
    rules: ['FR-ERP1-04'],
    example: 'pcs',
  },
  {
    name: 'price',
    label: 'Unit Price',
    type: 'decimal',
    required: true,
    description: 'Non-negative selling price stored as numeric(19,4)',
    rules: ['FR-ERP1-02', 'BR-ERP1-01'],
    example: '149.5000',
  },
  {
    name: 'currency',
    label: 'Currency Code (ISO-4217)',
    type: 'string',
    required: true,
    description: 'Three-letter uppercase currency code (e.g. USD, EUR, GBP)',
    rules: ['FR-ERP1-02'],
    example: 'USD',
  },
  {
    name: 'taxRate',
    label: 'Tax Rate (%)',
    type: 'decimal',
    required: false,
    description: 'Non-negative tax rate percentage stored as numeric(5,2)',
    rules: ['FR-ERP1-02'],
    example: '18.00',
  },
  {
    name: 'notificationEmail',
    label: 'Notification Email',
    type: 'string',
    required: false,
    description: 'Operational contact email for inventory updates',
    rules: ['RL-02'],
    example: 'inventory-ops@clearshift.synthetic',
  },
  {
    name: 'contactPhone',
    label: 'Contact Phone',
    type: 'string',
    required: false,
    description: 'Supplier or dispatcher telephone number',
    rules: ['RL-02'],
    example: '+1-555-0199',
  },
  {
    name: 'sourceSystem',
    label: 'Source System',
    type: 'string',
    required: false,
    description: 'Original legacy system name (preserved immutably)',
    rules: ['KIT-08'],
    example: 'SAP_R3_LEGACY',
  },
  {
    name: 'sourceId',
    label: 'Source Record ID',
    type: 'string',
    required: false,
    description: 'Original primary key in source system for idempotency',
    rules: ['KIT-08'],
    example: 'MAT-884920',
  },
];

export const erp1ProductsTargetMetadata: TargetEntityMetadata = {
  entity: 'products',
  label: 'Product Master Data',
  module: 'erp1',
  schemaVersion: 1,
  targetTable: 'erp1_products',
  primaryKey: 'id',
  naturalKey: 'sku',
  fields: erp1ProductsTargetFields,
  mappingDefaults: {
    name: 'product_name',
    sku: 'sku_code',
    unitOfMeasure: 'unit',
    price: 'unit_price',
    currency: 'currency_code',
    taxRate: 'tax_rate',
    notificationEmail: 'email',
    contactPhone: 'phone',
    sourceId: 'legacy_id',
    sourceSystem: 'source_system',
  },
  validationRules: [
    {
      code: 'BR-ERP1-01',
      description: 'SKU must be unique after documented normalization (trim and uppercase)',
    },
    {
      code: 'FR-ERP1-04',
      description: 'Unit of measure must be one of the fixed V1 list: pcs, kg, g, litre, metre, box',
    },
    {
      code: 'FR-ERP1-02',
      description: 'Price and tax rate must be non-negative decimals with up to 4 decimal places',
    },
    {
      code: 'RL-01',
      description: 'Required string fields must not be empty or whitespace-only',
    },
    {
      code: 'KIT-08',
      description: 'Import never changes raw source values (sourceSystem and sourceId are preserved)',
    },
  ],
};

/**
 * 2. Categories Target Schema
 */
export const erp1CategoriesTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'name',
    label: 'Category Name',
    type: 'string',
    required: true,
    description: 'Human-readable category title',
    rules: ['FR-ERP1-03'],
    example: 'Precision Bearings',
  },
  {
    name: 'code',
    label: 'Category Code',
    type: 'string',
    required: true,
    description: 'Unique category identifier code',
    rules: ['FR-ERP1-03'],
    example: 'CAT-BRG',
  },
];

export const erp1CategoriesTargetMetadata: TargetEntityMetadata = {
  entity: 'categories',
  label: 'Product Categories',
  module: 'erp1',
  schemaVersion: 1,
  targetTable: 'erp1_categories',
  primaryKey: 'id',
  naturalKey: 'code',
  fields: erp1CategoriesTargetFields,
  mappingDefaults: {
    name: 'category_name',
    code: 'category_code',
  },
  validationRules: [
    {
      code: 'FR-ERP1-03',
      description: 'One-level category hierarchy with unique category code',
    },
  ],
};

/**
 * 3. Warehouses Target Schema
 */
export const erp1WarehousesTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'name',
    label: 'Warehouse Name',
    type: 'string',
    required: true,
    description: 'Name of the physical warehouse location',
    rules: ['FR-ERP1-05'],
    example: 'Main Central Logistics Hub',
  },
  {
    name: 'code',
    label: 'Warehouse Code',
    type: 'string',
    required: true,
    description: 'Unique warehouse identifier code',
    rules: ['FR-ERP1-05'],
    example: 'WH-CENTRAL-01',
  },
  {
    name: 'isDefault',
    label: 'Default Warehouse Flag',
    type: 'boolean',
    required: false,
    description: 'Designates the primary facility (default: true)',
    rules: ['FR-ERP1-05'],
    example: true,
  },
];

export const erp1WarehousesTargetMetadata: TargetEntityMetadata = {
  entity: 'warehouses',
  label: 'Warehouses',
  module: 'erp1',
  schemaVersion: 1,
  targetTable: 'erp1_warehouses',
  primaryKey: 'id',
  naturalKey: 'code',
  fields: erp1WarehousesTargetFields,
  mappingDefaults: {
    name: 'warehouse_name',
    code: 'warehouse_code',
    isDefault: 'is_default',
  },
  validationRules: [
    {
      code: 'FR-ERP1-05',
      description: 'ClearShift operates exactly one warehouse in V1',
    },
  ],
};

/**
 * 4. Stock Levels Target Schema
 */
export const erp1StockLevelsTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'productId',
    label: 'Product UUID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing the existing product master record',
    rules: ['FR-ERP1-06'],
    example: 'p1111111-1111-4111-8111-111111111111',
  },
  {
    name: 'warehouseId',
    label: 'Warehouse UUID',
    type: 'uuid',
    required: true,
    description: 'UUID referencing the storage warehouse',
    rules: ['FR-ERP1-06'],
    example: 'w1111111-1111-4111-8111-111111111111',
  },
  {
    name: 'quantity',
    label: 'Stock Quantity',
    type: 'decimal',
    required: true,
    description: 'Non-negative on-hand stock quantity',
    rules: ['FR-ERP1-06', 'BR-ERP1-02'],
    example: '500.0000',
  },
];

export const erp1StockLevelsTargetMetadata: TargetEntityMetadata = {
  entity: 'stock_levels',
  label: 'Stock Levels',
  module: 'erp1',
  schemaVersion: 1,
  targetTable: 'erp1_stock_levels',
  primaryKey: 'id',
  fields: erp1StockLevelsTargetFields,
  mappingDefaults: {
    productId: 'product_id',
    warehouseId: 'warehouse_id',
    quantity: 'quantity',
  },
  validationRules: [
    {
      code: 'BR-ERP1-02',
      description: 'Stock quantity cannot become negative',
    },
  ],
};

/**
 * Web-Facing ERP-1 Module Kit Metadata
 */
export const erp1WebKitMetadata: ModuleKitMetadata = {
  moduleId: 'erp1',
  moduleName: 'ERP-1 Products and Inventory',
  defaultEntity: 'products',
  entities: {
    products: erp1ProductsTargetMetadata,
    categories: erp1CategoriesTargetMetadata,
    warehouses: erp1WarehousesTargetMetadata,
    stock_levels: erp1StockLevelsTargetMetadata,
  },
  supportedSourceTypes: ['csv', 'json'],
};

// Auto-register with shared MigrationKitRegistry (AC 1)
registerModuleKitMetadata(erp1WebKitMetadata);
