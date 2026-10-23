import type {
  Vendor,
  VendorListQuery,
  PaginatedVendorsResponse,
  PurchaseOrder,
  PurchaseOrderListQuery,
  PaginatedPurchaseOrdersResponse,
  CreateVendorRequest,
  UpdateVendorRequest,
  CreatePurchaseOrderRequest,
  UpdatePurchaseOrderStatusRequest,
} from '@clearshift/contracts';

const API_BASE = '/api/v1/erp-vendors';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown = null
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorData: any = {};
    try {
      errorData = await response.json();
    } catch {
      // JSON parse error ignored
    }
    throw new ApiError(
      response.status,
      errorData?.code || (response.status === 403 ? 'FORBIDDEN' : 'API_REQUEST_FAILED'),
      errorData?.message || `HTTP ${response.status} ${response.statusText}`,
      errorData?.details
    );
  }

  return (await response.json()) as T;
}

/**
 * Fetch bounded paginated Vendors with optional name search.
 */
export async function fetchVendors(
  query: VendorListQuery = { page: 1, pageSize: 20 }
): Promise<PaginatedVendorsResponse> {
  const params = new URLSearchParams();
  const page = query.page || 1;
  const pageSize = query.pageSize !== undefined ? query.pageSize : 20;

  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  if (query.search && query.search.trim() !== '') {
    params.set('search', query.search.trim());
  }

  return request<PaginatedVendorsResponse>(`/vendors?${params.toString()}`);
}

/**
 * Fetch bounded paginated Purchase Orders with optional vendor and status filters.
 */
export async function fetchPurchaseOrders(
  query: PurchaseOrderListQuery = { page: 1, pageSize: 20 }
): Promise<PaginatedPurchaseOrdersResponse> {
  const params = new URLSearchParams();
  const page = query.page || 1;
  const pageSize = query.pageSize !== undefined ? query.pageSize : 20;

  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  if (query.vendor_id) {
    params.set('vendor_id', query.vendor_id);
  }
  if (query.status) {
    params.set('status', query.status);
  }

  return request<PaginatedPurchaseOrdersResponse>(`/purchase-orders?${params.toString()}`);
}

/**
 * Fetch a single vendor by UUID.
 */
export async function fetchVendorById(id: string): Promise<Vendor> {
  return request<Vendor>(`/vendors/${id}`);
}

/**
 * Fetch a single purchase order by UUID.
 */
export async function fetchPurchaseOrderById(id: string): Promise<PurchaseOrder> {
  return request<PurchaseOrder>(`/purchase-orders/${id}`);
}

/**
 * Create a new vendor.
 */
export async function createVendor(data: CreateVendorRequest): Promise<Vendor> {
  return request<Vendor>('/vendors', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Update an existing vendor.
 */
export async function updateVendor(id: string, data: UpdateVendorRequest): Promise<Vendor> {
  return request<Vendor>(`/vendors/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Create a new purchase order with lines.
 */
export async function createPurchaseOrder(data: CreatePurchaseOrderRequest): Promise<PurchaseOrder> {
  return request<PurchaseOrder>('/purchase-orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Update purchase order status (unidirectional allowed transition: Draft -> Sent -> Received -> Closed).
 */
export async function updatePurchaseOrderStatus(
  id: string,
  data: UpdatePurchaseOrderStatusRequest
): Promise<PurchaseOrder> {
  return request<PurchaseOrder>(`/purchase-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
