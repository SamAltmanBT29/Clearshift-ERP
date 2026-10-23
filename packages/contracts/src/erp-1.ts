import { z } from 'zod';
import {
  StandardPaginationQuerySchema as PaginationQuerySchema,
  createPaginatedResponseSchema,
  ErrorEnvelopeSchema,
} from './common.js';

export const ERP1_API_PREFIX = '/api/v1/erp-products';

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

/**
 * Category Schema (FR-ERP1-03: one level only, name & code).
 */
export const CategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Category name is required'),
  code: z.string().min(1, 'Category code is required'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Category = z.infer<typeof CategorySchema>;

export const CreateCategoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required'),
  code: z.string().trim().min(1, 'Category code is required'),
});
export type CreateCategoryInput = z.infer<typeof CreateCategoryInputSchema>;

export const UpdateCategoryInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  code: z.string().trim().min(1).optional(),
});
export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInputSchema>;

/**
 * Warehouse Schema (FR-ERP1-05: one warehouse in V1).
 */
export const WarehouseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  code: z.string().min(1),
  isDefault: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Warehouse = z.infer<typeof WarehouseSchema>;

/**
 * Product Schema (FR-ERP1-01, FR-ERP1-02, BR-ERP1-01).
 *
 * Money and quantities use the SDS numeric(19,4) precision.
 */
export const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Product name is required'),
  sku: z.string().min(1, 'SKU is required'),
  normalizedSku: z.string().min(1),
  categoryId: z.string().uuid().nullable().optional(),
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Product = z.infer<typeof ProductSchema>;

export const CreateProductInputSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required'),
  sku: z.string().trim().min(1, 'SKU is required'),
  categoryId: z.string().uuid().nullable().optional(),
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
  taxRate: z
    .union([z.string(), z.number()])
    .transform((val, ctx) =>
      normalizeDecimalInput(val, 2, 'Tax rate must be non-negative', ctx)
    )
    .default('0.00')
    .optional(),
  notificationEmail: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().trim().email('Invalid email address format').optional()
  ),
  contactPhone: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().trim().regex(/^\+?[0-9\s\-()]{7,20}$/, 'Invalid phone number format').optional()
  ),
  sourceSystem: z.string().trim().min(1).max(64).optional(),
  sourceId: z.string().trim().min(1).max(128).optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

export const UpdateProductInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  categoryId: z.string().uuid().nullable().optional(),
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
  taxRate: z
    .union([z.string(), z.number()])
    .transform((val, ctx) =>
      normalizeDecimalInput(val, 2, 'Tax rate must be non-negative', ctx)
    )
    .optional(),
  notificationEmail: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().trim().email('Invalid email address format').optional()
  ),
  contactPhone: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().trim().regex(/^\+?[0-9\s\-()]{7,20}$/, 'Invalid phone number format').optional()
  ),
  version: z.string().optional(),
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
  id: z.string().uuid(),
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z
    .string()
    .regex(QuantityPattern, 'Quantity must be a non-negative decimal with up to 4 decimal places'),
  updatedAt: z.string().datetime(),
});
export type StockLevel = z.infer<typeof StockLevelSchema>;

export const SetOpeningStockInputSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
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
});
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
  search: z.string().trim().optional(),
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

export const CategoryListQuerySchema = Erp1PaginationQuerySchema;
export type CategoryListQuery = z.infer<typeof CategoryListQuerySchema>;

export const PaginatedProductsResponseSchema = createPaginatedResponseSchema(ProductSchema);
export type PaginatedProductsResponse = z.infer<typeof PaginatedProductsResponseSchema>;

export const PaginatedCategoriesResponseSchema = createPaginatedResponseSchema(CategorySchema);
export type PaginatedCategoriesResponse = z.infer<typeof PaginatedCategoriesResponseSchema>;

export { ErrorEnvelopeSchema };
