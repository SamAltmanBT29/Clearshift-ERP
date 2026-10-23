import type {
  SalesOrder,
  SalesOrdersFilterQuery,
  CreateSalesOrderInput,
  UpdateSalesOrderStatusInput,
  Invoice,
  InvoicesFilterQuery,
  CreateInvoiceInput,
  Payment,
  PaymentMethod,
  CreatePaymentInput,
} from '@clearshift/contracts';

const API_BASE = '/api/v1/erp-orders';

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
      // ignore json parse error
    }
    throw new ApiError(
      response.status,
      errorData?.code || 'API_REQUEST_FAILED',
      errorData?.message || `HTTP ${response.status} ${response.statusText}`,
      errorData?.details
    );
  }

  return (await response.json()) as T;
}

export interface NormalizedSalesOrdersResponse {
  items: SalesOrder[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface NormalizedInvoicesResponse {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface NormalizedPaymentsResponse {
  items: Payment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Isolated UI query interface for payment history listing.
 * ⚠️ Note: `GET /api/v1/erp-orders/payments` is not part of the 7-route canonical
 * OpenAPI/mock baseline (Issue #150 / DR-3). Kept isolated for `InvoiceDetailPage`
 * until backend route ratification.
 */
export interface PaymentsFilterQuery {
  page?: number | undefined;
  pageSize?: number | undefined;
  invoice_id?: string | undefined;
  method?: PaymentMethod | undefined;
}

/**
 * Fetch bounded paginated Sales Orders with search and status filters.
 * Canonical route: GET /api/v1/erp-orders/sales-orders
 */
export async function fetchSalesOrders(
  query: Partial<SalesOrdersFilterQuery> = { page: 1, pageSize: 20 }
): Promise<NormalizedSalesOrdersResponse> {
  const params = new URLSearchParams();
  const page = query.page || 1;
  const pageSize = query.pageSize !== undefined ? query.pageSize : 20;

  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.customer_golden_id) params.set('customer_golden_id', query.customer_golden_id);
  if (query.currency) params.set('currency', query.currency);
  if (query.from_date) params.set('from_date', query.from_date);
  if (query.to_date) params.set('to_date', query.to_date);

  const qs = params.toString();
  const res = await request<any>(`/sales-orders${qs ? `?${qs}` : ''}`);

  const items: SalesOrder[] = res.data || res.items || [];
  const total = Number(res.total ?? items.length);
  const totalPages = res.totalPages ?? Math.max(1, Math.ceil(total / pageSize));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Fetch single Sales Order by ID with lines.
 * Canonical route: GET /api/v1/erp-orders/sales-orders/{id} (⚠️ DR-3 pending Gate G1 ratification)
 */
export async function fetchSalesOrderById(id: string): Promise<SalesOrder> {
  return request<SalesOrder>(`/sales-orders/${encodeURIComponent(id)}`);
}

/**
 * Create a new Sales Order.
 * Canonical route: POST /api/v1/erp-orders/sales-orders
 */
export async function createSalesOrder(input: CreateSalesOrderInput): Promise<SalesOrder> {
  return request<SalesOrder>('/sales-orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Update Sales Order Status (forward-only transitions: Open -> Invoiced -> Closed).
 * ⚠️ Isolated UI workflow helper: `UpdateSalesOrderStatusRequestSchema` is exported by
 * `@clearshift/contracts`, but `PATCH /api/v1/erp-orders/sales-orders/{id}` is not one
 * of the 7 routes in the canonical OpenAPI/mock baseline (Issue #150 / DR-3).
 */
export async function updateSalesOrderStatus(
  id: string,
  input: UpdateSalesOrderStatusInput
): Promise<SalesOrder> {
  return request<SalesOrder>(`/sales-orders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * Fetch bounded paginated Invoices with search and filters.
 * Canonical route: GET /api/v1/erp-orders/invoices
 */
export async function fetchInvoices(
  query: Partial<InvoicesFilterQuery> = { page: 1, pageSize: 20 }
): Promise<NormalizedInvoicesResponse> {
  const params = new URLSearchParams();
  const page = query.page || 1;
  const pageSize = query.pageSize !== undefined ? query.pageSize : 20;

  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.customer_golden_id) params.set('customer_golden_id', query.customer_golden_id);
  if (query.order_id) params.set('order_id', query.order_id);
  if (query.currency) params.set('currency', query.currency);
  if (query.from_date) params.set('from_date', query.from_date);
  if (query.to_date) params.set('to_date', query.to_date);

  const qs = params.toString();
  const res = await request<any>(`/invoices${qs ? `?${qs}` : ''}`);

  const items: Invoice[] = res.data || res.items || [];
  const total = Number(res.total ?? items.length);
  const totalPages = res.totalPages ?? Math.max(1, Math.ceil(total / pageSize));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Fetch single Invoice by ID.
 * Canonical route: GET /api/v1/erp-orders/invoices/{id} (⚠️ DR-3 pending Gate G1 ratification)
 */
export async function fetchInvoiceById(id: string): Promise<Invoice> {
  return request<Invoice>(`/invoices/${encodeURIComponent(id)}`);
}

/**
 * Create a new Invoice.
 * Canonical route: POST /api/v1/erp-orders/invoices
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  return request<Invoice>('/invoices', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Fetch bounded paginated Payments for an invoice.
 * ⚠️ Isolated UI workflow helper: `GET /api/v1/erp-orders/payments` is not part of the
 * 7-route canonical OpenAPI/mock baseline (Issue #150 / DR-3). Callers (`InvoiceDetailPage`)
 * gracefully fall back to empty list if the endpoint is unavailable.
 */
export async function fetchPayments(
  query: PaymentsFilterQuery = { page: 1, pageSize: 20 }
): Promise<NormalizedPaymentsResponse> {
  const params = new URLSearchParams();
  const page = query.page || 1;
  const pageSize = query.pageSize !== undefined ? query.pageSize : 20;

  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  if (query.invoice_id) params.set('invoice_id', query.invoice_id);
  if (query.method) params.set('method', query.method);

  const qs = params.toString();
  const res = await request<any>(`/payments${qs ? `?${qs}` : ''}`);

  const items: Payment[] = res.data || res.items || [];
  const total = Number(res.total ?? items.length);
  const totalPages = res.totalPages ?? Math.max(1, Math.ceil(total / pageSize));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Record a payment against an invoice.
 * Canonical route: POST /api/v1/erp-orders/payments
 */
export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  return request<Payment>('/payments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
