import type {
  SalesOrder,
  SalesOrdersFilterQuery,
  CreateSalesOrderInput,
  UpdateSalesOrderStatusInput,
  Invoice,
  InvoicesFilterQuery,
  CreateInvoiceInput,
  Payment,
  PaymentsFilterQuery,
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
 * Fetch bounded paginated Sales Orders with search and status filters.
 */
export async function fetchSalesOrders(
  query: SalesOrdersFilterQuery = { page: 1, pageSize: 20 }
): Promise<NormalizedSalesOrdersResponse> {
  const params = new URLSearchParams();
  const page = query.page || 1;
  const pageSize = query.pageSize !== undefined ? query.pageSize : 20;

  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.customerGoldenId) params.set('customerGoldenId', query.customerGoldenId);
  if (query.currencyCode) params.set('currencyCode', query.currencyCode);
  if (query.startDate) params.set('startDate', query.startDate);
  if (query.endDate) params.set('endDate', query.endDate);

  const qs = params.toString();
  const res = await request<any>(`/sales-orders${qs ? `?${qs}` : ''}`);

  const items: SalesOrder[] = res.items || res.data || [];
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
 * Fetch single Sales Order by ID with lines
 */
export async function fetchSalesOrderById(id: string): Promise<SalesOrder> {
  return request<SalesOrder>(`/sales-orders/${encodeURIComponent(id)}`);
}

/**
 * Create a new Sales Order
 */
export async function createSalesOrder(input: CreateSalesOrderInput): Promise<SalesOrder> {
  return request<SalesOrder>('/sales-orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Update Sales Order Status (allowed transitions only)
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
 */
export async function fetchInvoices(
  query: InvoicesFilterQuery = { page: 1, pageSize: 20 }
): Promise<NormalizedInvoicesResponse> {
  const params = new URLSearchParams();
  const page = query.page || 1;
  const pageSize = query.pageSize !== undefined ? query.pageSize : 20;

  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.customerGoldenId) params.set('customerGoldenId', query.customerGoldenId);
  if (query.orderId) params.set('orderId', query.orderId);

  const qs = params.toString();
  const res = await request<any>(`/invoices${qs ? `?${qs}` : ''}`);

  const items: Invoice[] = res.items || res.data || [];
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
 * Fetch single Invoice by ID
 */
export async function fetchInvoiceById(id: string): Promise<Invoice> {
  return request<Invoice>(`/invoices/${encodeURIComponent(id)}`);
}

/**
 * Create a new Invoice from an order
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  return request<Invoice>('/invoices', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Fetch bounded paginated Payments.
 */
export async function fetchPayments(
  query: PaymentsFilterQuery = { page: 1, pageSize: 20 }
): Promise<NormalizedPaymentsResponse> {
  const params = new URLSearchParams();
  const page = query.page || 1;
  const pageSize = query.pageSize !== undefined ? query.pageSize : 20;

  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  if (query.invoiceId) params.set('invoiceId', query.invoiceId);
  if (query.method) params.set('method', query.method);

  const qs = params.toString();
  const res = await request<any>(`/payments${qs ? `?${qs}` : ''}`);

  const items: Payment[] = res.items || res.data || [];
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
 * Record a payment against an invoice
 */
export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  return request<Payment>('/payments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
