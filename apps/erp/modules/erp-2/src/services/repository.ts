/**
 * ERP-2 Vendors & Purchasing — Repository Layer
 *
 * Provides:
 *   - Erp2Repository: Data access contract for vendors, POs, lines, and durable import receipts
 *   - InMemoryErp2Repository: Deterministic in-memory store for fast unit/integration testing
 *   - DrizzleErp2Repository: Production PostgreSQL storage via Drizzle ORM
 *   - Request hashing & bank masking domain utilities
 *
 * @module erp2/services/repository
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  Vendor,
  CreateVendorRequest,
  VendorListQuery,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderListQuery,
  PurchaseOrderStatus,
  ImportReceiptRecord,
} from '@clearshift/contracts';
import { eq, like, desc, sql, count } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  erp2Vendors,
  erp2PurchaseOrders,
  erp2PoLines,
  erp2ImportReceipts,
  type Erp2Vendor,
  type Erp2PurchaseOrder,
  type Erp2PoLine,
  type Erp2ImportReceipt,
  type NewErp2ImportReceipt,
} from '../../db/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions: Request Canonical Hashing & Bank Masking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministically canonicalizes a JSON structure (keys sorted recursively).
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalizeJson(record[k])).join(',') + '}';
}

/**
 * Computes an SHA-256 hash of the canonicalized payload.
 */
export function computeRequestHash(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Masks raw bank account details to XXXX-XXXX-7890.
 * Server-side serialization rule (FR-ERP2-06).
 */
export function maskBankDetails(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^XXXX-XXXX-\d{4}$/.test(trimmed)) {
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, '');
  const last4 = digits.length >= 4 ? digits.slice(-4) : (digits || '0000').padStart(4, '0');
  return `XXXX-XXXX-${last4}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp2Repository {
  // Vendors
  listVendors(query: VendorListQuery): Promise<{ vendors: Vendor[]; total: number }>;
  getVendorById(id: string): Promise<Vendor | null>;
  getVendorByTaxNumber(taxNumber: string): Promise<Vendor | null>;
  createVendor(data: CreateVendorRequest, maskedBank: string | null): Promise<Vendor>;
  updateVendor(id: string, updates: Partial<Vendor>): Promise<Vendor>;

  // Purchase Orders
  listPurchaseOrders(query: PurchaseOrderListQuery): Promise<{ purchaseOrders: PurchaseOrder[]; total: number }>;
  getPurchaseOrderById(id: string): Promise<PurchaseOrder | null>;
  getPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | null>;
  createPurchaseOrder(po: Omit<PurchaseOrder, 'created_at' | 'updated_at'>): Promise<PurchaseOrder>;
  updatePurchaseOrderStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder>;

  // Durable Import Receipts
  getImportReceiptByKey(idempotencyKey: string): Promise<ImportReceiptRecord | null>;
  createImportReceipt(
    receipt: Omit<ImportReceiptRecord, 'id' | 'created_at'> & { id?: string; created_at?: string }
  ): Promise<ImportReceiptRecord>;

  // Transaction support
  executeTransactional<T>(work: (txRepo: Erp2Repository) => Promise<T>): Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Repository (Fast, Deterministic Test Store)
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryErp2Repository implements Erp2Repository {
  public vendors = new Map<string, Vendor>();
  public purchaseOrders = new Map<string, PurchaseOrder>();
  public receipts = new Map<string, ImportReceiptRecord>();

  constructor(seed = false) {
    if (seed) {
      this.seedFixtures();
    }
  }

  private seedFixtures(): void {
    const v1Id = '00000000-0000-0000-0000-000000000001';
    const now = '2026-03-01T00:00:00.000Z';
    this.vendors.set(v1Id, {
      id: v1Id,
      name: 'Acme Industrial Supplies',
      tax_number: 'TX-998877',
      email: 'sales@acme-industrial.com',
      phone: '+1-555-0199',
      address_line: '100 Industrial Parkway',
      city: 'Metropolis',
      country: 'USA',
      bank_masked: 'XXXX-XXXX-7890',
      currency: 'USD',
      source_system: null,
      source_id: null,
      created_at: now,
      updated_at: now,
    });
  }

  async listVendors(query: VendorListQuery): Promise<{ vendors: Vendor[]; total: number }> {
    let items = Array.from(this.vendors.values());

    if (query.search) {
      const s = query.search.toLowerCase();
      items = items.filter((v) => v.name.toLowerCase().includes(s) || v.tax_number.toLowerCase().includes(s));
    }

    items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const total = items.length;

    const page = query.page;
    const pageSize = query.pageSize;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    return { vendors: paged, total };
  }

  async getVendorById(id: string): Promise<Vendor | null> {
    return this.vendors.get(id) ?? null;
  }

  async getVendorByTaxNumber(taxNumber: string): Promise<Vendor | null> {
    for (const v of this.vendors.values()) {
      if (v.tax_number.toLowerCase() === taxNumber.toLowerCase()) {
        return v;
      }
    }
    return null;
  }

  async createVendor(data: CreateVendorRequest, maskedBank: string | null): Promise<Vendor> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const vendor: Vendor = {
      id,
      name: data.name,
      tax_number: data.tax_number,
      email: data.email,
      phone: data.phone ?? null,
      address_line: data.address_line ?? null,
      city: data.city ?? null,
      country: data.country ?? null,
      bank_masked: maskedBank,
      currency: data.currency ?? 'USD',
      source_system: data.source_system ?? null,
      source_id: data.source_id ?? null,
      created_at: now,
      updated_at: now,
    };
    this.vendors.set(id, vendor);
    return vendor;
  }

  async updateVendor(id: string, updates: Partial<Vendor>): Promise<Vendor> {
    const existing = this.vendors.get(id);
    if (!existing) {
      throw new Error(`Vendor ${id} not found`);
    }
    const updated: Vendor = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.vendors.set(id, updated);
    return updated;
  }

  async listPurchaseOrders(query: PurchaseOrderListQuery): Promise<{ purchaseOrders: PurchaseOrder[]; total: number }> {
    let items = Array.from(this.purchaseOrders.values());

    if (query.vendor_id) {
      items = items.filter((po) => po.vendor_id === query.vendor_id);
    }
    if (query.status) {
      items = items.filter((po) => po.status === query.status);
    }

    items.sort((a, b) => b.order_date.localeCompare(a.order_date) || a.id.localeCompare(b.id));
    const total = items.length;

    const page = query.page;
    const pageSize = query.pageSize;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    return { purchaseOrders: paged, total };
  }

  async getPurchaseOrderById(id: string): Promise<PurchaseOrder | null> {
    return this.purchaseOrders.get(id) ?? null;
  }

  async getPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | null> {
    for (const po of this.purchaseOrders.values()) {
      if (po.po_number === poNumber) {
        return po;
      }
    }
    return null;
  }

  async createPurchaseOrder(po: Omit<PurchaseOrder, 'created_at' | 'updated_at'>): Promise<PurchaseOrder> {
    const now = new Date().toISOString();
    const created: PurchaseOrder = {
      ...po,
      created_at: now,
      updated_at: now,
    };
    this.purchaseOrders.set(po.id, created);
    return created;
  }

  async updatePurchaseOrderStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder> {
    const existing = this.purchaseOrders.get(id);
    if (!existing) {
      throw new Error(`Purchase order ${id} not found`);
    }
    const updated: PurchaseOrder = {
      ...existing,
      status,
      updated_at: new Date().toISOString(),
    };
    this.purchaseOrders.set(id, updated);
    return updated;
  }

  async getImportReceiptByKey(idempotencyKey: string): Promise<ImportReceiptRecord | null> {
    return this.receipts.get(idempotencyKey) ?? null;
  }

  async createImportReceipt(
    receipt: Omit<ImportReceiptRecord, 'id' | 'created_at'> & { id?: string; created_at?: string }
  ): Promise<ImportReceiptRecord> {
    if (this.receipts.has(receipt.idempotency_key)) {
      throw new Error(`Duplicate idempotency key: ${receipt.idempotency_key}`);
    }
    const id = receipt.id ?? randomUUID();
    const created_at = receipt.created_at ?? new Date().toISOString();
    const record: ImportReceiptRecord = {
      ...receipt,
      id,
      created_at,
    };
    this.receipts.set(receipt.idempotency_key, record);
    return record;
  }

  /**
   * In-memory transaction simulator: creates a snapshot clone and commits on success;
   * on failure, state reverts to pre-transaction snapshot.
   */
  async executeTransactional<T>(work: (txRepo: Erp2Repository) => Promise<T>): Promise<T> {
    // Clone maps
    const vendorSnapshot = new Map(this.vendors);
    const poSnapshot = new Map(this.purchaseOrders);
    const receiptSnapshot = new Map(this.receipts);

    const txRepo = new InMemoryErp2Repository(false);
    txRepo.vendors = new Map(this.vendors);
    txRepo.purchaseOrders = new Map(this.purchaseOrders);
    txRepo.receipts = new Map(this.receipts);

    try {
      const result = await work(txRepo);
      // Commit
      this.vendors = txRepo.vendors;
      this.purchaseOrders = txRepo.purchaseOrders;
      this.receipts = txRepo.receipts;
      return result;
    } catch (err) {
      // Rollback
      this.vendors = vendorSnapshot;
      this.purchaseOrders = poSnapshot;
      this.receipts = receiptSnapshot;
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Production Drizzle Repository
// ─────────────────────────────────────────────────────────────────────────────

export class DrizzleErp2Repository implements Erp2Repository {
  constructor(private readonly db: NodePgDatabase) {}

  async listVendors(query: VendorListQuery): Promise<{ vendors: Vendor[]; total: number }> {
    const page = query.page;
    const pageSize = query.pageSize;
    const offset = (page - 1) * pageSize;

    let baseQuery = this.db.select().from(erp2Vendors);
    if (query.search) {
      baseQuery = baseQuery.where(like(erp2Vendors.name, `%${query.search}%`)) as any;
    }

    const rows = await (baseQuery as any).limit(pageSize).offset(offset).orderBy(erp2Vendors.name);
    const countRes = await this.db.select({ value: count() }).from(erp2Vendors);
    const countVal = countRes[0]?.value ?? 0;

    const vendors: Vendor[] = rows.map((r: Erp2Vendor) => ({
      id: r.id,
      name: r.name,
      tax_number: r.tax_number,
      email: r.email,
      phone: r.phone ?? null,
      address_line: r.address_line ?? null,
      city: r.city ?? null,
      country: r.country ?? null,
      bank_masked: r.bank_masked ?? null,
      currency: r.currency,
      source_system: r.source_system ?? null,
      source_id: r.source_id ?? null,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    }));

    return { vendors, total: Number(countVal) };
  }

  async getVendorById(id: string): Promise<Vendor | null> {
    const [row] = await this.db.select().from(erp2Vendors).where(eq(erp2Vendors.id, id)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      tax_number: row.tax_number,
      email: row.email,
      phone: row.phone ?? null,
      address_line: row.address_line ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
      bank_masked: row.bank_masked ?? null,
      currency: row.currency,
      source_system: row.source_system ?? null,
      source_id: row.source_id ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async getVendorByTaxNumber(taxNumber: string): Promise<Vendor | null> {
    const [row] = await this.db
      .select()
      .from(erp2Vendors)
      .where(eq(erp2Vendors.tax_number, taxNumber))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      tax_number: row.tax_number,
      email: row.email,
      phone: row.phone ?? null,
      address_line: row.address_line ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
      bank_masked: row.bank_masked ?? null,
      currency: row.currency,
      source_system: row.source_system ?? null,
      source_id: row.source_id ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async createVendor(data: CreateVendorRequest, maskedBank: string | null): Promise<Vendor> {
    const [row] = await this.db
      .insert(erp2Vendors)
      .values({
        name: data.name,
        tax_number: data.tax_number,
        email: data.email,
        phone: data.phone ?? null,
        address_line: data.address_line ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
        bank_masked: maskedBank,
        currency: data.currency ?? 'USD',
        source_system: data.source_system ?? null,
        source_id: data.source_id ?? null,
      })
      .returning();

    if (!row) throw new Error('Failed to create vendor');

    return {
      id: row.id,
      name: row.name,
      tax_number: row.tax_number,
      email: row.email,
      phone: row.phone ?? null,
      address_line: row.address_line ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
      bank_masked: row.bank_masked ?? null,
      currency: row.currency,
      source_system: row.source_system ?? null,
      source_id: row.source_id ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async updateVendor(id: string, updates: Partial<Vendor>): Promise<Vendor> {
    const updateValues: Record<string, unknown> = { updated_at: sql`now()` };
    if (updates.name !== undefined) updateValues['name'] = updates.name;
    if (updates.tax_number !== undefined) updateValues['tax_number'] = updates.tax_number;
    if (updates.email !== undefined) updateValues['email'] = updates.email;
    if (updates.phone !== undefined) updateValues['phone'] = updates.phone;
    if (updates.address_line !== undefined) updateValues['address_line'] = updates.address_line;
    if (updates.city !== undefined) updateValues['city'] = updates.city;
    if (updates.country !== undefined) updateValues['country'] = updates.country;
    if (updates.bank_masked !== undefined) updateValues['bank_masked'] = updates.bank_masked;
    if (updates.currency !== undefined) updateValues['currency'] = updates.currency;

    const [row] = await this.db
      .update(erp2Vendors)
      .set(updateValues)
      .where(eq(erp2Vendors.id, id))
      .returning();

    if (!row) throw new Error(`Vendor ${id} not found`);

    return {
      id: row.id,
      name: row.name,
      tax_number: row.tax_number,
      email: row.email,
      phone: row.phone ?? null,
      address_line: row.address_line ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
      bank_masked: row.bank_masked ?? null,
      currency: row.currency,
      source_system: row.source_system ?? null,
      source_id: row.source_id ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async listPurchaseOrders(query: PurchaseOrderListQuery): Promise<{ purchaseOrders: PurchaseOrder[]; total: number }> {
    const page = query.page;
    const pageSize = query.pageSize;
    const offset = (page - 1) * pageSize;

    let baseQuery = this.db.select().from(erp2PurchaseOrders);
    if (query.vendor_id) {
      baseQuery = baseQuery.where(eq(erp2PurchaseOrders.vendor_id, query.vendor_id)) as any;
    }
    if (query.status) {
      baseQuery = baseQuery.where(eq(erp2PurchaseOrders.status, query.status)) as any;
    }

    const rows = await (baseQuery as any).limit(pageSize).offset(offset).orderBy(desc(erp2PurchaseOrders.order_date));
    const countRes = await this.db.select({ value: count() }).from(erp2PurchaseOrders);
    const countVal = countRes[0]?.value ?? 0;

    const purchaseOrders: PurchaseOrder[] = [];
    for (const r of rows) {
      const lines = await this.db.select().from(erp2PoLines).where(eq(erp2PoLines.po_id, r.id));
      purchaseOrders.push({
        id: r.id,
        po_number: r.po_number,
        vendor_id: r.vendor_id,
        order_date: r.order_date,
        status: r.status as PurchaseOrderStatus,
        currency: r.currency,
        total: r.total,
        lines: lines.map((l: Erp2PoLine) => ({
          id: l.id,
          po_id: l.po_id,
          product_id: l.product_id,
          quantity: l.quantity,
          price: l.price,
          line_total: l.line_total,
        })),
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
      });
    }

    return { purchaseOrders, total: Number(countVal) };
  }

  async getPurchaseOrderById(id: string): Promise<PurchaseOrder | null> {
    const [row] = await this.db.select().from(erp2PurchaseOrders).where(eq(erp2PurchaseOrders.id, id)).limit(1);
    if (!row) return null;

    const lines = await this.db.select().from(erp2PoLines).where(eq(erp2PoLines.po_id, row.id));
    return {
      id: row.id,
      po_number: row.po_number,
      vendor_id: row.vendor_id,
      order_date: row.order_date,
      status: row.status as PurchaseOrderStatus,
      currency: row.currency,
      total: row.total,
      lines: lines.map((l: Erp2PoLine) => ({
        id: l.id,
        po_id: l.po_id,
        product_id: l.product_id,
        quantity: l.quantity,
        price: l.price,
        line_total: l.line_total,
      })),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async getPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | null> {
    const [row] = await this.db.select().from(erp2PurchaseOrders).where(eq(erp2PurchaseOrders.po_number, poNumber)).limit(1);
    if (!row) return null;

    const lines = await this.db.select().from(erp2PoLines).where(eq(erp2PoLines.po_id, row.id));
    return {
      id: row.id,
      po_number: row.po_number,
      vendor_id: row.vendor_id,
      order_date: row.order_date,
      status: row.status as PurchaseOrderStatus,
      currency: row.currency,
      total: row.total,
      lines: lines.map((l: Erp2PoLine) => ({
        id: l.id,
        po_id: l.po_id,
        product_id: l.product_id,
        quantity: l.quantity,
        price: l.price,
        line_total: l.line_total,
      })),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async createPurchaseOrder(po: Omit<PurchaseOrder, 'created_at' | 'updated_at'>): Promise<PurchaseOrder> {
    const [createdPo] = await this.db
      .insert(erp2PurchaseOrders)
      .values({
        id: po.id,
        po_number: po.po_number,
        vendor_id: po.vendor_id,
        order_date: po.order_date,
        status: po.status,
        currency: po.currency,
        total: po.total,
      })
      .returning();

    if (!createdPo) throw new Error('Failed to create purchase order');

    for (const line of po.lines) {
      await this.db.insert(erp2PoLines).values({
        id: line.id,
        po_id: po.id,
        product_id: line.product_id,
        quantity: line.quantity,
        price: line.price,
        line_total: line.line_total,
      });
    }

    return {
      ...po,
      created_at: createdPo.created_at.toISOString(),
      updated_at: createdPo.updated_at.toISOString(),
    };
  }

  async updatePurchaseOrderStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder> {
    const [row] = await this.db
      .update(erp2PurchaseOrders)
      .set({ status, updated_at: sql`now()` })
      .where(eq(erp2PurchaseOrders.id, id))
      .returning();

    if (!row) throw new Error(`Purchase order ${id} not found`);

    const lines = await this.db.select().from(erp2PoLines).where(eq(erp2PoLines.po_id, row.id));
    return {
      id: row.id,
      po_number: row.po_number,
      vendor_id: row.vendor_id,
      order_date: row.order_date,
      status: row.status as PurchaseOrderStatus,
      currency: row.currency,
      total: row.total,
      lines: lines.map((l: Erp2PoLine) => ({
        id: l.id,
        po_id: l.po_id,
        product_id: l.product_id,
        quantity: l.quantity,
        price: l.price,
        line_total: l.line_total,
      })),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async getImportReceiptByKey(idempotencyKey: string): Promise<ImportReceiptRecord | null> {
    const [row] = await this.db
      .select()
      .from(erp2ImportReceipts)
      .where(eq(erp2ImportReceipts.idempotency_key, idempotencyKey))
      .limit(1);

    if (!row) return null;
    return {
      id: row.id,
      batch_id: row.batch_id,
      source_row: row.source_row,
      source_system: row.source_system ?? null,
      source_id: row.source_id ?? null,
      entity: row.entity,
      schema_version: row.schema_version,
      idempotency_key: row.idempotency_key,
      request_hash: row.request_hash,
      target_id: row.target_id,
      kind: row.kind as 'created' | 'linked',
      outcome: row.outcome as 'loaded' | 'rejected' | 'merged' | 'skipped',
      response_payload: row.response_payload ? JSON.parse(row.response_payload) : null,
      created_at: row.created_at.toISOString(),
    };
  }

  async createImportReceipt(
    receipt: Omit<ImportReceiptRecord, 'id' | 'created_at'> & { id?: string; created_at?: string }
  ): Promise<ImportReceiptRecord> {
    const payloadStr = receipt.response_payload ? JSON.stringify(receipt.response_payload) : null;
    const insertValues: NewErp2ImportReceipt = {
      id: receipt.id ?? randomUUID(),
      batch_id: receipt.batch_id,
      source_row: receipt.source_row,
      source_system: receipt.source_system ?? null,
      source_id: receipt.source_id ?? null,
      entity: receipt.entity,
      schema_version: receipt.schema_version,
      idempotency_key: receipt.idempotency_key,
      request_hash: receipt.request_hash,
      target_id: receipt.target_id,
      kind: receipt.kind,
      outcome: receipt.outcome,
      response_payload: payloadStr,
    };
    const [row] = await this.db
      .insert(erp2ImportReceipts)
      .values(insertValues)
      .returning();

    if (!row) throw new Error('Failed to create import receipt');

    return {
      id: row.id,
      batch_id: row.batch_id,
      source_row: row.source_row,
      source_system: row.source_system ?? null,
      source_id: row.source_id ?? null,
      entity: row.entity,
      schema_version: row.schema_version,
      idempotency_key: row.idempotency_key,
      request_hash: row.request_hash,
      target_id: row.target_id,
      kind: row.kind as 'created' | 'linked',
      outcome: row.outcome as 'loaded' | 'rejected' | 'merged' | 'skipped',
      response_payload: receipt.response_payload,
      created_at: row.created_at.toISOString(),
    };
  }

  async executeTransactional<T>(work: (txRepo: Erp2Repository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const txRepo = new DrizzleErp2Repository(tx as unknown as NodePgDatabase);
      return work(txRepo);
    });
  }
}
