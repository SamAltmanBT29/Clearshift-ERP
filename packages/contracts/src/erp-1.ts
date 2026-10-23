import { z } from 'zod';
import {
  StandardPaginationQuerySchema as PaginationQuerySchema,
  createPaginatedResponseSchema,
  ErrorEnvelopeSchema,
} from './common.js';

export const ERP1_API_PREFIX = '/api/v1/erp-products';

/**
 * Stable ERP-1 domain rule identifiers.
 *
 * The API returns these codes for business-rule failures so a client never has
 * to parse a human-readable message.
 */
export const ERP1_DOMAIN_RULES = {
  SKU_DUPLICATE: 'DUPLICATE_SKU',
  CATEGORY_CODE_DUPLICATE: 'DUPLICATE_CATEGORY_CODE',
  CATEGORY_REQUIRED: 'UNKNOWN_CATEGORY',
  PRODUCT_REQUIRED: 'UNKNOWN_PRODUCT',
  WAREHOUSE_REQUIRED: 'UNKNOWN_WAREHOUSE',
  SINGLE_WAREHOUSE: 'SINGLE_WAREHOUSE_V1',
  NEGATIVE_STOCK: 'NEGATIVE_STOCK',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
  IMPORT_PROVENANCE_REQUIRED: 'IMPORT_PROVENANCE_REQUIRED',
  PROTECTED_FIELD: 'ERP1_PROTECTED_FIELD',
  SOURCE_IDENTITY_INCOMPLETE: 'SOURCE_IDENTITY_INCOMPLETE',
  INVALID_UNIT_OF_MEASURE: 'INVALID_UNIT_OF_MEASURE',
  INVALID_CURRENCY_CODE: 'INVALID_CURRENCY_CODE',
  INVALID_STOCK_STATUS: 'INVALID_STOCK_STATUS',
  INVALID_PRODUCT_STATUS: 'INVALID_PRODUCT_STATUS',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  READ_MODEL_INCONSISTENT: 'READ_MODEL_INCONSISTENT',
  CROSS_MODULE_WRITE_FORBIDDEN: 'CROSS_MODULE_WRITE_FORBIDDEN',
} as const;

export type Erp1DomainRule = (typeof ERP1_DOMAIN_RULES)[keyof typeof ERP1_DOMAIN_RULES];

/**
 * An absent optional relationship is reported as an approved warning.
 *
 * The module never invents a synthetic or placeholder record to satisfy an optional link.
 */
export const ERP1_OPTIONAL_REFERENCE_ABSENT = 'ERP1_OPTIONAL_REFERENCE_ABSENT';

export const Erp1RelationshipWarningSchema = z.object({
  relationship: z.string(),
  field: z.string(),
  code: z.literal(ERP1_OPTIONAL_REFERENCE_ABSENT),
  message: z.string(),
});
export type Erp1RelationshipWarning = z.infer<typeof Erp1RelationshipWarningSchema>;

/**
 * Approved units of measure per FR-ERP1-04.
 */
export const ERP1_UNITS_OF_MEASURE = [
  'pcs',
  'kg',
  'g',
  'litre',
  'metre',
  'box',
] as const;

/**
 * Approved stock statuses derived from physical inventory level.
 */
export const ERP1_STOCK_STATUSES = [
  'out_of_stock',
  'low_stock',
  'in_stock',
] as const;
export type StockStatus = (typeof ERP1_STOCK_STATUSES)[number];

/**
 * Allowed stock status transitions based on balance changes.
 */
export const ERP1_STOCK_STATUS_TRANSITIONS: Readonly<
  Record<StockStatus, readonly StockStatus[]>
> = {
  out_of_stock: ['low_stock', 'in_stock'],
  low_stock: ['out_of_stock', 'in_stock'],
  in_stock: ['low_stock', 'out_of_stock'],
};

/**
 * Product lifecycle statuses for enterprise master data cataloging.
 */
export const ERP1_PRODUCT_STATUSES = [
  'draft',
  'active',
  'discontinued',
  'archived',
] as const;
export type ProductLifecycleStatus = (typeof ERP1_PRODUCT_STATUSES)[number];

export const ERP1_PRODUCT_TERMINAL_STATUSES: readonly ProductLifecycleStatus[] = [
  'archived',
];

/**
 * Allowed forward product lifecycle transitions.
 * Archived is terminal.
 */
export const ERP1_PRODUCT_STATUS_TRANSITIONS: Readonly<
  Record<ProductLifecycleStatus, readonly ProductLifecycleStatus[]>
> = {
  draft: ['active', 'archived'],
  active: ['discontinued', 'archived'],
  discontinued: ['active', 'archived'],
  archived: [],
};

/**
 * Fields that are owned by the platform or the service layer. A browser edit
 * may never set them as authoritative values.
 */
export const ERP1_PROTECTED_FIELD_NAMES = [
  'id',
  'normalizedSku',
  'normalized_sku',
  'createdAt',
  'created_at',
  'updatedAt',
  'updated_at',
] as const;

/**
 * Fixed list of units of measure per FR-ERP1-04.
 */
export const UnitOfMeasureSchema = z.enum([
  'pcs',
  'kg',
  'g',
  'litre',
  'metre',
  'box',
]);
export type UnitOfMeasure = z.infer<typeof UnitOfMeasureSchema>;

/**
 * ISO 4217 currency code. ERP-1 has no approved implicit currency default in
 * the SDS, so callers must supply the currency explicitly.
 */
export const CurrencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'Currency must be an uppercase ISO 4217 code');

const PricePattern = /^\d+(\.\d{1,4})?$/;
const QuantityPattern = /^\d+(\.\d{1,4})?$/;
const TaxRatePattern = /^\d+(\.\d{1,2})?$/;

function normalizeDecimalInput(
  value: string | number,
  scale: number,
  message: string,
  ctx: z.RefinementCtx
): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return value.toFixed(scale);
  }

  const text = value.trim();
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`);
  if (!pattern.test(text)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    return z.NEVER;
  }
  return Number(text).toFixed(scale);
}

/**
 * Normalizes SKU strings for exact deterministic matching (uppercase, trimmed).
 */
export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/** ISO 4217 currency code — normalized to uppercase. */
export const Erp1CurrencyCode = z
  .string()
  .trim()
  .length(3, 'Currency must be a 3-letter ISO 4217 code')
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code'));

const Uuid = z.string().uuid('Must be a valid UUID');
const IsoDateTime = z.string().datetime();

/** Path parameter for a module resource identifier. */
export const Erp1IdParamSchema = z.object({ id: Uuid });
export type Erp1IdParam = z.infer<typeof Erp1IdParamSchema>;

/**
 * A non-negative decimal with at most two decimal places, normalized to a
 * fixed two-decimal string. Accepts a JSON number or string.
 */
function decimal2(message: string) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), { message })
    .transform((value) => Number(value).toFixed(2));
}

const MoneyAmount = decimal2(
  'Price must be greater than or equal to 0 with up to 2 decimal places'
);

const TaxRate = decimal2('Tax rate must be non-negative with up to 2 decimal places');

const StockQuantity = decimal2(
  'Stock quantity cannot become negative (BR-ERP1-02)'
);

const IdempotencyKey = z.string().trim().min(1).max(255);
const SourceRow = z.number().int().nonnegative();

/**
 * Optional import provenance accepted by migration-load writes.
 *
 * Snake_case matches the shared Migration Kit payload; camelCase is accepted
 * for clients that follow the module's own field convention.
 */
const ImportProvenanceShape = {
  idempotency_key: IdempotencyKey.optional(),
  idempotencyKey: IdempotencyKey.optional(),
  batch_id: Uuid.optional(),
  batchId: Uuid.optional(),
  source_row: SourceRow.optional(),
  sourceRow: SourceRow.optional(),
  source_system: z.string().trim().max(64).optional(),
  sourceSystem: z.string().trim().max(64).optional(),
  source_id: z.string().trim().max(128).optional(),
  sourceId: z.string().trim().max(128).optional(),
} as const;

/**
 * Category Schema (FR-ERP1-03: one level only, name & code).
 */
export const CategorySchema = z.object({
  id: Uuid,
  name: z.string().min(1, 'Category name is required'),
  code: z.string().min(1, 'Category code is required'),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Category = z.infer<typeof CategorySchema>;

export const CreateCategoryInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Category name is required').max(255),
    code: z.string().trim().min(1, 'Category code is required').max(64),
    ...ImportProvenanceShape,
  })
  .strict('Unknown or protected field is not accepted when creating a category');
export type CreateCategoryInput = z.infer<typeof CreateCategoryInputSchema>;

export const UpdateCategoryInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Category name is required').max(255).optional(),
    code: z.string().trim().min(1, 'Category code is required').max(64).optional(),
  })
  .strict('Unknown or protected field is not accepted when updating a category')
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one editable category field is required',
  });
export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInputSchema>;

/**
 * Warehouse Schema (FR-ERP1-05: one warehouse in V1).
 */
export const WarehouseSchema = z.object({
  id: Uuid,
  name: z.string().min(1),
  code: z.string().min(1),
  isDefault: z.boolean().default(true),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Warehouse = z.infer<typeof WarehouseSchema>;

/**
 * Product Schema (FR-ERP1-01, FR-ERP1-02, BR-ERP1-01).
 *
 * Money and quantities use the SDS numeric(19,4) precision.
 */
export const ProductSchema = z.object({
  id: Uuid,
  name: z.string().min(1, 'Product name is required'),
  sku: z.string().min(1, 'SKU is required'),
  normalizedSku: z.string().min(1),
  categoryId: Uuid.nullable().optional(),
  unitOfMeasure: UnitOfMeasureSchema,
  price: z
    .string()
    .regex(PricePattern, 'Price must be a valid non-negative decimal string with up to 4 decimal places'),
  currency: CurrencySchema,
  taxRate: z
    .string()
    .regex(TaxRatePattern, 'Tax rate must be a valid non-negative decimal percentage')
    .default('0.00'),
  notificationEmail: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  sourceSystem: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  goldenId: z.string().nullable().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Product = z.infer<typeof ProductSchema>;

export const CreateProductInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required').max(255),
    sku: z.string().trim().min(1, 'SKU is required').max(128),
    categoryId: Uuid.nullable().optional(),
    unitOfMeasure: UnitOfMeasureSchema,
    price: z
      .union([z.string(), z.number()])
      .transform((val, ctx) =>
        normalizeDecimalInput(
          val,
          4,
          'Price must be greater than or equal to 0',
          ctx
        )
      ),
    currency: CurrencySchema,
    taxRate: TaxRate.optional().default('0.00'),
    notificationEmail: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().trim().email('Invalid email address format').optional()
    ),
    contactPhone: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().trim().regex(/^\+?[0-9\s\-()]{7,20}$/, 'Invalid phone number format').optional()
    ),
    ...ImportProvenanceShape,
  })
  .strict('Unknown or protected field is not accepted when creating a product');
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

export const UpdateProductInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required').max(255).optional(),
    sku: z.string().trim().min(1, 'SKU is required').max(128).optional(),
    categoryId: Uuid.nullable().optional(),
    unitOfMeasure: UnitOfMeasureSchema.optional(),
    price: z
      .union([z.string(), z.number()])
      .transform((val, ctx) =>
        normalizeDecimalInput(
          val,
          4,
          'Price must be greater than or equal to 0',
          ctx
        )
      )
      .optional(),
    currency: CurrencySchema.optional(),
    taxRate: TaxRate.optional(),
    notificationEmail: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().trim().email('Invalid email address format').optional()
    ),
    contactPhone: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().trim().regex(/^\+?[0-9\s\-()]{7,20}$/, 'Invalid phone number format').optional()
    ),
    version: z.string().optional(),
  })
  .strict('Unknown or protected field is not accepted when updating a product')
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one editable product field is required',
  });
export type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

/**
 * Linked warehouse stock record for Product detail views.
 */
export const ProductWarehouseStockLinkedRecordSchema = z.object({
  warehouseId: z.string().uuid(),
  warehouseCode: z.string(),
  warehouseName: z.string(),
  quantity: z.string(),
  unitOfMeasure: UnitOfMeasureSchema,
  updatedAt: z.string().datetime(),
});
export type ProductWarehouseStockLinkedRecord = z.infer<typeof ProductWarehouseStockLinkedRecordSchema>;

/**
 * Linked ERP-2 Purchase Order line for Product detail views.
 */
export const ProductPurchaseLineLinkedRecordSchema = z.object({
  id: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
  poNumber: z.string(),
  vendorName: z.string(),
  orderDate: z.string(),
  quantity: z.string(),
  unitPrice: z.string(),
  currency: CurrencySchema,
  status: z.string(),
});
export type ProductPurchaseLineLinkedRecord = z.infer<typeof ProductPurchaseLineLinkedRecordSchema>;

/**
 * Linked ERP-3 Sales Order / Invoice line for Product detail views.
 */
export const ProductSalesLineLinkedRecordSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  customerGoldenId: z.string(),
  orderDate: z.string(),
  quantity: z.string(),
  unitPrice: z.string(),
  lineTotal: z.string(),
  currency: CurrencySchema,
  status: z.string(),
});
export type ProductSalesLineLinkedRecord = z.infer<typeof ProductSalesLineLinkedRecordSchema>;

/**
 * Aggregated linked records for a Product across ERP-1 inventory, ERP-2 purchasing, and ERP-3 sales.
 */
export const ProductLinkedRecordsSchema = z.object({
  productId: z.string().uuid(),
  stockLevels: z.array(ProductWarehouseStockLinkedRecordSchema),
  purchaseOrders: z.array(ProductPurchaseLineLinkedRecordSchema),
  salesOrders: z.array(ProductSalesLineLinkedRecordSchema),
});
export type ProductLinkedRecords = z.infer<typeof ProductLinkedRecordsSchema>;

/**
 * Stock Level Schema (FR-ERP1-06, BR-ERP1-02: quantity >= 0).
 */
export const StockLevelSchema = z.object({
  id: Uuid,
  productId: Uuid,
  warehouseId: Uuid,
  quantity: z
    .string()
    .regex(QuantityPattern, 'Quantity must be a non-negative decimal with up to 4 decimal places'),
  updatedAt: IsoDateTime,
});
export type StockLevel = z.infer<typeof StockLevelSchema>;

export const SetOpeningStockInputSchema = z
  .object({
    productId: Uuid,
    warehouseId: Uuid.optional(),
    quantity: z
      .union([z.string(), z.number()])
      .transform((val, ctx) =>
        normalizeDecimalInput(
          val,
          4,
          'Stock quantity cannot become negative (BR-ERP1-02)',
          ctx
        )
      ),
    ...ImportProvenanceShape,
  })
  .strict('Unknown or protected field is not accepted when loading opening stock');
export type SetOpeningStockInput = z.infer<typeof SetOpeningStockInputSchema>;

/**
 * Query & List Envelopes.
 */
const Erp1PaginationQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce
    .number()
    .int({ message: 'pageSize must be an integer' })
    .min(1, { message: 'pageSize must be >= 1' })
    .max(100, { message: 'pageSize cannot exceed 100' })
    .default(25),
});

export const ProductSortFieldSchema = z.enum([
  'name',
  'sku',
  'price',
  'createdAt',
  'quantity',
]);
export type ProductSortField = z.infer<typeof ProductSortFieldSchema>;

export const StockStatusFilterSchema = z.enum([
  'all',
  'in_stock',
  'low_stock',
  'out_of_stock',
]);
export type StockStatusFilter = z.infer<typeof StockStatusFilterSchema>;

export const ProductListQuerySchema = Erp1PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  categoryId: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().uuid().optional()
  ),
  unitOfMeasure: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    UnitOfMeasureSchema.optional()
  ),
  stockStatus: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    StockStatusFilterSchema.optional()
  ),
  minPrice: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z
      .union([z.string(), z.number()])
      .transform((val, ctx) =>
        normalizeDecimalInput(val, 4, 'Min price must be non-negative', ctx)
      )
      .optional()
  ),
  maxPrice: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z
      .union([z.string(), z.number()])
      .transform((val, ctx) =>
        normalizeDecimalInput(val, 4, 'Max price must be non-negative', ctx)
      )
      .optional()
  ),
  sortBy: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    ProductSortFieldSchema.optional()
  ),
  sortOrder: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.enum(['asc', 'desc']).optional()
  ),
  sortDirection: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.enum(['asc', 'desc']).optional()
  ),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

export const CategoryListQuerySchema = Erp1PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
});
export type CategoryListQuery = z.infer<typeof CategoryListQuerySchema>;

export const StockLevelListQuerySchema = PaginationQuerySchema.extend({
  productId: Uuid.optional(),
  warehouseId: Uuid.optional(),
});
export type StockLevelListQuery = z.infer<typeof StockLevelListQuerySchema>;

export const PaginatedProductsResponseSchema = createPaginatedResponseSchema(ProductSchema);
export type PaginatedProductsResponse = z.infer<typeof PaginatedProductsResponseSchema>;

export const PaginatedCategoriesResponseSchema = createPaginatedResponseSchema(CategorySchema);
export type PaginatedCategoriesResponse = z.infer<typeof PaginatedCategoriesResponseSchema>;

/**
 * Target Field Type Schema for Migration Kit Integration (KIT-14 / ERP1-22).
 */
export const TargetFieldTypeSchema = z.enum([
  'string',
  'number',
  'decimal',
  'boolean',
  'date',
  'enum',
  'uuid',
]);
export type TargetFieldType = z.infer<typeof TargetFieldTypeSchema>;

/**
 * Target Field Definition Schema for Migration Kit Integration.
 */
export const TargetFieldDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: TargetFieldTypeSchema,
  required: z.boolean(),
  description: z.string().optional(),
  enumOptions: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
  example: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type TargetFieldDefinition = z.infer<typeof TargetFieldDefinitionSchema>;

/**
 * Target Entity Metadata Schema for Migration Kit Integration.
 */
export const TargetEntityMetadataSchema = z.object({
  entity: z.string().min(1),
  label: z.string().min(1),
  module: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  targetTable: z.string().min(1),
  primaryKey: z.string().min(1),
  naturalKey: z.string().optional(),
  fields: z.array(TargetFieldDefinitionSchema),
  mappingDefaults: z.record(z.string()).optional(),
  validationRules: z
    .array(
      z.object({
        code: z.string(),
        description: z.string(),
      })
    )
    .optional(),
});
export type TargetEntityMetadata = z.infer<typeof TargetEntityMetadataSchema>;

/**
 * Module Migration Metadata Schema supplied to shared Migration Kit wizard.
 */
export const ModuleMigrationMetadataSchema = z.object({
  moduleId: z.string().min(1),
  moduleName: z.string().min(1),
  defaultEntity: z.string().min(1),
  entities: z.record(TargetEntityMetadataSchema),
  supportedSourceTypes: z.array(z.string()).optional(),
});
export type ModuleMigrationMetadata = z.infer<typeof ModuleMigrationMetadataSchema>;

/**
 * Migration Kit Rejection & Review Schemas (KIT-16 / ERP1-23)
 */
export const RejectionColumnConfigSchema = z.object({
  field: z.string().min(1),
  label: z.string().min(1),
  isIdentifier: z.boolean().optional(),
  isSensitive: z.boolean().optional(),
});
export type RejectionColumnConfig = z.infer<typeof RejectionColumnConfigSchema>;

export const FailureExplanationSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  explanation: z.string().min(1),
  docReference: z.string().optional(),
  resolution: z.string().optional(),
});
export type FailureExplanation = z.infer<typeof FailureExplanationSchema>;

export const ModuleRejectionContextSchema = z.object({
  moduleId: z.string().min(1),
  moduleName: z.string().min(1),
  entity: z.string().min(1),
  identifierColumns: z.array(RejectionColumnConfigSchema),
  additionalColumns: z.array(RejectionColumnConfigSchema).optional(),
  sensitiveFields: z.array(z.string()).optional(),
  failureExplanations: z.record(FailureExplanationSchema),
});
export type ModuleRejectionContext = z.infer<typeof ModuleRejectionContextSchema>;

export const RejectedRowSchema = z.object({
  id: z.string().min(1),
  batchId: z.string().min(1),
  sourceRow: z.number().int().min(1),
  entity: z.string().min(1),
  schemaVersion: z.number().int().min(1).optional(),
  errorCode: z.string().min(1),
  failureReason: z.string().optional(),
  field: z.string().optional(),
  rawData: z.record(z.unknown()),
  createdAt: z.string().optional(),
});
export type RejectedRow = z.infer<typeof RejectedRowSchema>;

/**
 * Data Quality Rule Schema (KIT-17 / ERP1-24)
 */
export const DataQualityRuleSchema = z.object({
  rule_id: z.string().min(1),
  version: z.string().min(1),
  record_type: z.enum(['category', 'warehouse', 'product', 'stock_level', 'all']),
  field: z.string().min(1),
  condition: z.string().min(1),
  action: z.enum(['normalize', 'reject', 'review']),
  reason_code: z.string().optional(),
  explanation: z.string().min(1),
  doc_reference: z.string().min(1),
});
export type DataQualityRule = z.infer<typeof DataQualityRuleSchema>;

/**
 * Reconciliation Summary Schema
 */
export const ReconciliationSummarySchema = z.object({
  total_source_rows: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  review: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  unaccounted: z.number().int().nonnegative(),
  is_balanced: z.boolean(),
});
export type ReconciliationSummary = z.infer<typeof ReconciliationSummarySchema>;

/**
 * Dirty Data Profile Report Schema (KIT-17 / ERP1-24)
 */
export const DirtyDataProfileReportSchema = z.object({
  profile_schema_version: z.number().int().positive(),
  rules_version: z.string().min(1),
  module: z.literal('erp1'),
  fixture: z.string().min(1),
  fixture_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  total_rows: z.number().int().nonnegative(),
  reconciliation: ReconciliationSummarySchema,
  by_record_type: z.record(
    z.object({
      accepted: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      review: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
  ),
  by_reason_code: z.record(z.number().int().nonnegative()),
  rows: z
    .record(
      z.object({
        outcome: z.enum(['accepted', 'rejected', 'review', 'skipped']),
        reasons: z.array(z.string()),
      })
    )
    .optional(),
  generated_at: z.string().datetime(),
});
export type DirtyDataProfileReport = z.infer<typeof DirtyDataProfileReportSchema>;

export const PaginatedStockLevelsResponseSchema =
  createPaginatedResponseSchema(StockLevelSchema);
export type PaginatedStockLevelsResponse = z.infer<
  typeof PaginatedStockLevelsResponseSchema
>;

export { ErrorEnvelopeSchema };


