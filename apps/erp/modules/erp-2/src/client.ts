/**
 * ERP-2 Frontend API Client & UI Permission Guards
 *
 * Implements:
 *   - Role-based UI access control (hiding/disabling buttons/tabs based on Hub Identity roles)
 *   - Client-side formatting and mask validation
 *   - Standardized fetch client with Bearer token injection and error handling
 *
 * @module erp2/client
 */

import { type RoleType } from '@cs/identity';
import { ERP2_ENDPOINT_ROLES, isRoleAllowed } from './policies/rbac.js';
import { maskBankDetails, maskSalary } from './policies/field-masking.js';
import type {
  Vendor,
  VendorListResponse,
  VendorListQuery,
  CreateVendorRequest,
  UpdateVendorRequest,
  PurchaseOrder,
  PurchaseOrderListResponse,
  PurchaseOrderListQuery,
  CreatePurchaseOrderRequest,
  UpdatePurchaseOrderStatusRequest,
} from '@clearshift/contracts';

export class Erp2Client {
  constructor(
    private baseUrl = '/api/v1/erp-vendors',
    private token?: string
  ) {}

  setToken(token: string): void {
    this.token = token;
  }

  // ── UI Permission Guards ──────────────────────────────────────────────────

  canViewVendors(roles: RoleType[]): boolean {
    return isRoleAllowed(roles, ERP2_ENDPOINT_ROLES.LIST_VENDORS);
  }

  canCreateVendor(roles: RoleType[]): boolean {
    return isRoleAllowed(roles, ERP2_ENDPOINT_ROLES.CREATE_VENDOR);
  }

  canEditVendor(roles: RoleType[]): boolean {
    return isRoleAllowed(roles, ERP2_ENDPOINT_ROLES.UPDATE_VENDOR);
  }

  canViewPurchaseOrders(roles: RoleType[]): boolean {
    return isRoleAllowed(roles, ERP2_ENDPOINT_ROLES.LIST_PURCHASE_ORDERS);
  }

  canCreatePurchaseOrder(roles: RoleType[]): boolean {
    return isRoleAllowed(roles, ERP2_ENDPOINT_ROLES.CREATE_PURCHASE_ORDER);
  }

  canUpdatePurchaseOrderStatus(roles: RoleType[]): boolean {
    return isRoleAllowed(roles, ERP2_ENDPOINT_ROLES.UPDATE_PURCHASE_ORDER_STATUS);
  }

  // ── Display Masking Helpers ───────────────────────────────────────────────

  formatBankForDisplay(rawBank?: string | null): string {
    return maskBankDetails(rawBank);
  }

  formatSalaryForDisplay(salary?: number | string | null): string {
    return maskSalary(salary);
  }

  // ── API Operations ────────────────────────────────────────────────────────

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    headers.set('Content-Type', 'application/json');
    headers.set('Accept', 'application/json');

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errorJson = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const err = new Error((errorJson['message'] as string) || `HTTP ${res.status}`);
      (err as any).statusCode = res.status;
      (err as any).code = errorJson['code'] || 'HTTP_ERROR';
      (err as any).details = errorJson['details'] || [];
      throw err;
    }

    return (await res.json()) as T;
  }

  async listVendors(query?: VendorListQuery): Promise<VendorListResponse> {
    const searchParams = new URLSearchParams();
    if (query?.search) searchParams.set('search', query.search);
    if (query?.page) searchParams.set('page', String(query.page));
    if (query?.pageSize) searchParams.set('pageSize', String(query.pageSize));

    const qs = searchParams.toString();
    return this.request<VendorListResponse>(`/vendors${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
  }

  async getVendorById(id: string): Promise<Vendor> {
    return this.request<Vendor>(`/vendors/${id}`, { method: 'GET' });
  }

  async createVendor(data: CreateVendorRequest): Promise<Vendor> {
    return this.request<Vendor>('/vendors', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateVendor(id: string, data: UpdateVendorRequest): Promise<Vendor> {
    return this.request<Vendor>(`/vendors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async listPurchaseOrders(query?: PurchaseOrderListQuery): Promise<PurchaseOrderListResponse> {
    const searchParams = new URLSearchParams();
    if (query?.vendor_id) searchParams.set('vendor_id', query.vendor_id);
    if (query?.status) searchParams.set('status', query.status);
    if (query?.page) searchParams.set('page', String(query.page));
    if (query?.pageSize) searchParams.set('pageSize', String(query.pageSize));

    const qs = searchParams.toString();
    return this.request<PurchaseOrderListResponse>(`/purchase-orders${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
  }

  async getPurchaseOrderById(id: string): Promise<PurchaseOrder> {
    return this.request<PurchaseOrder>(`/purchase-orders/${id}`, { method: 'GET' });
  }

  async createPurchaseOrder(data: CreatePurchaseOrderRequest): Promise<PurchaseOrder> {
    return this.request<PurchaseOrder>('/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePurchaseOrderStatus(
    id: string,
    data: UpdatePurchaseOrderStatusRequest
  ): Promise<PurchaseOrder> {
    return this.request<PurchaseOrder>(`/purchase-orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
}
