/**
 * ERP-1 Products & Inventory — Module API Client
 *
 * Typed API client for ERP-1 endpoints rooted at `/api/v1/erp-products`.
 * Normalizes all responses and errors conforming to the ClearShift standard
 * error envelope: { code, message, details, correlation_id }.
 *
 * @module erp1/web/api/erp-1
 */

import type {
  Product,
  Category,
  StockLevel,
  ProductListQuery,
  CategoryListQuery,
  PaginatedProductsResponse,
  PaginatedCategoriesResponse,
  UnitOfMeasure,
  ProductSortField,
  StockStatusFilter,
} from '@clearshift/contracts';

export const ERP1_API_BASE = '/api/v1/erp-products';

export interface Erp1ApiErrorDetail {
  readonly field?: string;
  readonly message: string;
  readonly code?: string;
}

export class Erp1ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: readonly Erp1ApiErrorDetail[];
  public readonly correlationId: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: readonly Erp1ApiErrorDetail[] = [],
    correlationId: string | null = null
  ) {
    super(message);
    this.name = 'Erp1ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.correlationId = correlationId;
  }
}

/**
 * Builds standard URL search params from a ProductListQuery object.
 */
export function buildProductQueryParams(query: Partial<ProductListQuery>): string {
  const params = new URLSearchParams();

  if (query.page !== undefined && query.page !== null) {
    params.set('page', String(query.page));
  }
  if (query.pageSize !== undefined && query.pageSize !== null) {
    params.set('pageSize', String(query.pageSize));
  }
  if (query.search && query.search.trim()) {
    params.set('search', query.search.trim());
  }
  if (query.categoryId && query.categoryId.trim()) {
    params.set('categoryId', query.categoryId.trim());
  }
  if (query.unitOfMeasure) {
    params.set('unitOfMeasure', query.unitOfMeasure);
  }
  if (query.stockStatus && query.stockStatus !== 'all') {
    params.set('stockStatus', query.stockStatus);
  }
  if (query.minPrice !== undefined && query.minPrice !== null && query.minPrice !== '') {
    params.set('minPrice', String(query.minPrice));
  }
  if (query.maxPrice !== undefined && query.maxPrice !== null && query.maxPrice !== '') {
    params.set('maxPrice', String(query.maxPrice));
  }
  if (query.sortBy) {
    params.set('sortBy', query.sortBy);
  }
  const direction = query.sortDirection || query.sortOrder;
  if (direction) {
    params.set('sortDirection', direction);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

async function executeRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${ERP1_API_BASE}${endpoint}`;
  let response: Response;

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
    });
  } catch (netErr: any) {
    throw new Erp1ApiError(
      0,
      'NETWORK_ERROR',
      netErr?.message || 'Failed to communicate with ERP-1 server'
    );
  }

  if (!response.ok) {
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      // payload may not be JSON
    }

    const envelope = payload?.error ?? payload ?? {};
    const code = envelope.code || `HTTP_${response.status}`;
    const message = envelope.message || `Request failed with HTTP status ${response.status}`;
    const details = Array.isArray(envelope.details) ? envelope.details : [];
    const correlationId = payload?.correlation_id || envelope.correlation_id || null;

    throw new Erp1ApiError(response.status, code, message, details, correlationId);
  }

  return (await response.json()) as T;
}

/**
 * Fetch paginated, filtered, sorted products from ERP-1.
 */
export async function fetchProducts(
  query: Partial<ProductListQuery> = {}
): Promise<PaginatedProductsResponse> {
  const queryString = buildProductQueryParams(query);
  return executeRequest<PaginatedProductsResponse>(`/products${queryString}`);
}

/**
 * Fetch categories for faceted filter sidebar.
 */
export async function fetchCategories(
  query: CategoryListQuery = { page: 1, pageSize: 100 }
): Promise<PaginatedCategoriesResponse> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return executeRequest<PaginatedCategoriesResponse>(`/categories${qs}`);
}

/**
 * Fetch stock level for a product.
 */
export async function fetchStock(
  productId: string,
  warehouseId?: string
): Promise<StockLevel> {
  const params = new URLSearchParams({ productId });
  if (warehouseId) params.set('warehouseId', warehouseId);
  return executeRequest<StockLevel>(`/stock?${params.toString()}`);
}
