/**
 * ERP-2 Vendors & Purchasing — Repository Interface & In-Memory Implementation
 *
 * Provides persistent data access abstractions with an in-memory test implementation
 * seeded with synthetic fixture data.
 *
 * @module erp2/services/repository
 */

import { randomUUID } from 'node:crypto';
import type {
  Vendor,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
} from '@clearshift/contracts';

export interface ServiceContext {
  actor: string;
  correlationId?: string | undefined;
}

export interface Erp2Repository {
  // Vendor methods
  listVendors(params: {
    search?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<{ items: Vendor[]; total: number }>;
  getVendorById(id: string): Promise<Vendor | null>;
  getVendorByTaxNumber(taxNumber: string): Promise<Vendor | null>;
  createVendor(
    vendor: Omit<Vendor, 'id' | 'created_at' | 'updated_at'> & {
      id?: string | undefined;
      idempotency_key?: string | null | undefined;
      batch_id?: string | null | undefined;
      source_row?: number | null | undefined;
    }
  ): Promise<Vendor>;
  updateVendor(id: string, updates: Partial<Vendor>): Promise<Vendor | null>;

  // Purchase Order methods
  listPurchaseOrders(params: {
    vendorId?: string | undefined;
    status?: PurchaseOrderStatus | undefined;
    page: number;
    pageSize: number;
  }): Promise<{ items: PurchaseOrder[]; total: number }>;
  getPurchaseOrderById(id: string): Promise<PurchaseOrder | null>;
  createPurchaseOrder(
    po: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'> & {
      id?: string | undefined;
      idempotency_key?: string | null | undefined;
      batch_id?: string | null | undefined;
      source_row?: number | null | undefined;
    }
  ): Promise<PurchaseOrder>;
  updatePurchaseOrderStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder | null>;

  // Idempotency & Import Receipts
  getImportReceipt(
    idempotencyKey: string
  ): Promise<{ entityId: string; entityType: string } | null>;
  saveImportReceipt(receipt: {
    idempotencyKey: string;
    entityType: string;
    entityId: string;
    batchId?: string | null | undefined;
    sourceRow?: number | null | undefined;
  }): Promise<void>;
}

export class InMemoryErp2Repository implements Erp2Repository {
  private vendors: Map<string, Vendor> = new Map();
  private purchaseOrders: Map<string, PurchaseOrder> = new Map();
  private importReceipts: Map<string, { entityId: string; entityType: string }> = new Map();

  constructor(seedFixtures = true) {
    if (seedFixtures) {
      this.seed();
    }
  }

  private seed(): void {
    const v1Id = '22222222-0001-0001-0001-000000000001';
    const v2Id = '22222222-0001-0001-0001-000000000002';
    const v3Id = '22222222-0001-0001-0001-000000000003';

    const now = new Date().toISOString();

    const v1: Vendor = {
      id: v1Id,
      name: 'Acme Industrial Supplies',
      tax_number: 'TX-998877',
      email: 'sales@acme-supplies.example.com',
      phone: '+1-555-0101',
      address_line: '100 Industrial Parkway',
      city: 'Chicago',
      country: 'United States',
      bank_masked: 'XXXX-XXXX-7890',
      source_system: 'ERP-LEGACY',
      source_id: 'V-1001',
      created_at: now,
      updated_at: now,
    };

    const v2: Vendor = {
      id: v2Id,
      name: 'Global Metals & Alloys Corp',
      tax_number: 'TX-445566',
      email: 'orders@globalmetals.example.com',
      phone: '+1-555-0102',
      address_line: '500 Foundry Road',
      city: 'Pittsburgh',
      country: 'United States',
      bank_masked: 'XXXX-XXXX-4321',
      source_system: 'ERP-LEGACY',
      source_id: 'V-1002',
      created_at: now,
      updated_at: now,
    };

    const v3: Vendor = {
      id: v3Id,
      name: 'Pacific Electronics Packaging',
      tax_number: 'TX-112233',
      email: 'info@pacific-pack.example.com',
      phone: '+1-555-0103',
      address_line: '88 Harbor Street',
      city: 'Seattle',
      country: 'United States',
      bank_masked: 'XXXX-XXXX-9999',
      source_system: 'ERP-LEGACY',
      source_id: 'V-1003',
      created_at: now,
      updated_at: now,
    };

    this.vendors.set(v1.id, v1);
    this.vendors.set(v2.id, v2);
    this.vendors.set(v3.id, v3);

    // Seed sample purchase order
    const poId = '33333333-0001-0001-0001-000000000001';
    const poLineId = '44444444-0001-0001-0001-000000000001';
    const sampleLine: PurchaseOrderLine = {
      id: poLineId,
      po_id: poId,
      product_id: '11111111-0001-0001-0001-000000000001',
      quantity: 10,
      price: '199.99',
      line_total: '1999.90',
      created_at: now,
    };

    const samplePo: PurchaseOrder = {
      id: poId,
      po_number: 'PO-2026-0001',
      vendor_id: v1Id,
      order_date: '2026-10-20',
      status: 'Draft',
      currency_code: 'USD',
      total: '1999.90',
      lines: [sampleLine],
      created_at: now,
      updated_at: now,
    };

    this.purchaseOrders.set(poId, samplePo);
  }

  // ── Vendor Methods ──────────────────────────────────────────────────────────

  async listVendors(params: {
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: Vendor[]; total: number }> {
    let all = Array.from(this.vendors.values());

    if (params.search) {
      const q = params.search.toLowerCase().trim();
      all = all.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.tax_number.toLowerCase().includes(q) ||
          v.city.toLowerCase().includes(q)
      );
    }

    all.sort((a, b) => a.name.localeCompare(b.name));

    const total = all.length;
    const start = (params.page - 1) * params.pageSize;
    const items = all.slice(start, start + params.pageSize);

    return { items, total };
  }

  async getVendorById(id: string): Promise<Vendor | null> {
    return this.vendors.get(id) ?? null;
  }

  async getVendorByTaxNumber(taxNumber: string): Promise<Vendor | null> {
    const normalized = taxNumber.trim().toUpperCase();
    for (const v of this.vendors.values()) {
      if (v.tax_number.trim().toUpperCase() === normalized) {
        return v;
      }
    }
    return null;
  }

  async createVendor(
    vendor: Omit<Vendor, 'id' | 'created_at' | 'updated_at'> & {
      id?: string;
      idempotency_key?: string | null;
      batch_id?: string | null;
      source_row?: number | null;
    }
  ): Promise<Vendor> {
    const id = vendor.id || randomUUID();
    const now = new Date().toISOString();

    const created: Vendor = {
      id,
      name: vendor.name,
      tax_number: vendor.tax_number,
      email: vendor.email,
      phone: vendor.phone,
      address_line: vendor.address_line,
      city: vendor.city,
      country: vendor.country,
      bank_masked: vendor.bank_masked,
      source_system: vendor.source_system ?? null,
      source_id: vendor.source_id ?? null,
      created_at: now,
      updated_at: now,
    };

    this.vendors.set(id, created);

    if (vendor.idempotency_key) {
      await this.saveImportReceipt({
        idempotencyKey: vendor.idempotency_key,
        entityType: 'vendor',
        entityId: id,
        batchId: vendor.batch_id,
        sourceRow: vendor.source_row,
      });
    }

    return created;
  }

  async updateVendor(id: string, updates: Partial<Vendor>): Promise<Vendor | null> {
    const existing = this.vendors.get(id);
    if (!existing) return null;

    const updated: Vendor = {
      ...existing,
      ...updates,
      id: existing.id,
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    };

    this.vendors.set(id, updated);
    return updated;
  }

  // ── Purchase Order Methods ──────────────────────────────────────────────────

  async listPurchaseOrders(params: {
    vendorId?: string;
    status?: PurchaseOrderStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: PurchaseOrder[]; total: number }> {
    let all = Array.from(this.purchaseOrders.values());

    if (params.vendorId) {
      all = all.filter((p) => p.vendor_id === params.vendorId);
    }

    if (params.status) {
      all = all.filter((p) => p.status === params.status);
    }

    all.sort((a, b) => b.order_date.localeCompare(a.order_date));

    const total = all.length;
    const start = (params.page - 1) * params.pageSize;
    const items = all.slice(start, start + params.pageSize);

    return { items, total };
  }

  async getPurchaseOrderById(id: string): Promise<PurchaseOrder | null> {
    return this.purchaseOrders.get(id) ?? null;
  }

  async createPurchaseOrder(
    po: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'> & {
      id?: string;
      idempotency_key?: string | null;
      batch_id?: string | null;
      source_row?: number | null;
    }
  ): Promise<PurchaseOrder> {
    const id = po.id || randomUUID();
    const now = new Date().toISOString();

    const createdLines: PurchaseOrderLine[] = po.lines.map((l) => ({
      ...l,
      id: l.id || randomUUID(),
      po_id: id,
      created_at: l.created_at || now,
    }));

    const created: PurchaseOrder = {
      id,
      po_number: po.po_number,
      vendor_id: po.vendor_id,
      order_date: po.order_date,
      status: po.status,
      currency_code: po.currency_code,
      total: po.total,
      lines: createdLines,
      created_at: now,
      updated_at: now,
    };

    this.purchaseOrders.set(id, created);

    if (po.idempotency_key) {
      await this.saveImportReceipt({
        idempotencyKey: po.idempotency_key,
        entityType: 'purchase_order',
        entityId: id,
        batchId: po.batch_id,
        sourceRow: po.source_row,
      });
    }

    return created;
  }

  async updatePurchaseOrderStatus(
    id: string,
    status: PurchaseOrderStatus
  ): Promise<PurchaseOrder | null> {
    const existing = this.purchaseOrders.get(id);
    if (!existing) return null;

    const updated: PurchaseOrder = {
      ...existing,
      status,
      updated_at: new Date().toISOString(),
    };

    this.purchaseOrders.set(id, updated);
    return updated;
  }

  // ── Import Receipts ─────────────────────────────────────────────────────────

  async getImportReceipt(
    idempotencyKey: string
  ): Promise<{ entityId: string; entityType: string } | null> {
    return this.importReceipts.get(idempotencyKey) ?? null;
  }

  async saveImportReceipt(receipt: {
    idempotencyKey: string;
    entityType: string;
    entityId: string;
    batchId?: string | null | undefined;
    sourceRow?: number | null | undefined;
  }): Promise<void> {
    this.importReceipts.set(receipt.idempotencyKey, {
      entityId: receipt.entityId,
      entityType: receipt.entityType,
    });
  }
}
