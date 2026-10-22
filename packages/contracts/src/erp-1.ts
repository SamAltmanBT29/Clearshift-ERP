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
 */
export const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Product name is required'),
  sku: z.string().min(1, 'SKU is required'),
  normalizedSku: z.string().min(1),
  categoryId: z.string().uuid().nullable().optional(),
  unitOfMeasure: UnitOfMeasureSchema,
  price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a valid non-negative decimal string (e.g. 19.99)'),
  currency: z.string().length(3).default('USD'),
  taxRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Tax rate must be a valid non-negative decimal percentage').default('0.00'),
  sourceSystem: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Product = z.infer<typeof ProductSchema>;

export const CreateProductInputSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required'),
  sku: z.string().trim().min(1, 'SKU is required'),
  categoryId: z.string().uuid().nullable().optional(),
  unitOfMeasure: UnitOfMeasureSchema,
  price: z.union([z.string(), z.number()]).transform((val) => {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num) || num < 0) {
      throw new Error('Price must be greater than or equal to 0');
    }
    return num.toFixed(2);
  }),
  currency: z.string().length(3).default('USD').optional(),
  taxRate: z.union([z.string(), z.number()]).transform((val) => {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num) || num < 0) {
      throw new Error('Tax rate must be non-negative');
    }
    return num.toFixed(2);
  }).default('0.00').optional(),
  sourceSystem: z.string().trim().optional(),
  sourceId: z.string().trim().optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

export const UpdateProductInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  unitOfMeasure: UnitOfMeasureSchema.optional(),
  price: z.union([z.string(), z.number()]).transform((val) => {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num) || num < 0) {
      throw new Error('Price must be greater than or equal to 0');
    }
    return num.toFixed(2);
  }).optional(),
  currency: z.string().length(3).optional(),
  taxRate: z.union([z.string(), z.number()]).transform((val) => {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num) || num < 0) {
      throw new Error('Tax rate must be non-negative');
    }
    return num.toFixed(2);
  }).optional(),
});
export type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

/**
 * Stock Level Schema (FR-ERP1-06, BR-ERP1-02: quantity >= 0).
 */
export const StockLevelSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Quantity must be non-negative'),
  updatedAt: z.string().datetime(),
});
export type StockLevel = z.infer<typeof StockLevelSchema>;

export const SetOpeningStockInputSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  quantity: z.union([z.string(), z.number()]).transform((val) => {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num) || num < 0) {
      throw new Error('Stock quantity cannot become negative (BR-ERP1-02)');
    }
    return num.toFixed(2);
  }),
});
export type SetOpeningStockInput = z.infer<typeof SetOpeningStockInputSchema>;

/**
 * Query & List Envelopes.
 */
export const ProductListQuerySchema = PaginationQuerySchema.extend({
  categoryId: z.string().uuid().optional(),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

export const PaginatedProductsResponseSchema = createPaginatedResponseSchema(ProductSchema);
export type PaginatedProductsResponse = z.infer<typeof PaginatedProductsResponseSchema>;

export const PaginatedCategoriesResponseSchema = createPaginatedResponseSchema(CategorySchema);
export type PaginatedCategoriesResponse = z.infer<typeof PaginatedCategoriesResponseSchema>;

export { ErrorEnvelopeSchema };
