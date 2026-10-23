/**
 * ERP-3 Sales Orders & Invoices — Mutation Repository Contract & In-Memory Test Store
 *
 * Scope & Dependency Notes for Issue #28 (ERP3-03):
 *   1. Production PostgreSQL persistence (`DrizzleErp3Repository`) is BLOCKED on
 *      Issue #26 (`[ERP3-01]` — Schema, Drizzle models and guarded migrations:
 *      `apps/erp/modules/erp-3/db/schema.ts` and `packages/database/migrations/erp3_v1.sql`).
 *      `InMemoryErp3Repository` below is an in-memory test/verification double ONLY
 *      and must NOT be treated as durable production database storage.
 *   2. Paginated list/search/filter queries (`GET /sales-orders`, `GET /invoices`) are
 *      owned by Issue #27 (`[ERP3-02]`). This repository exposes only the write operations
 *      and minimal by-ID/by-key lookups required to execute and verify #28 mutations.
 *
 * @module erp3/services/repository
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  ImportReceiptRecord,
  Invoice,
  InvoiceStatus,
  Payment,
  SalesOrder,
  SalesOrderStatus,
} from "@clearshift/contracts";

/**
 * Deterministically canonicalizes a JSON value (sorting object keys recursively)
 * so idempotency payload hashes are order-independent.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalizeJson).join(",") + "]";
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalizeJson(record[k]))
      .join(",") +
    "}"
  );
}

/**
 * Computes a deterministic SHA-256 hex digest of a canonicalized payload.
 */
export function computeRequestHash(payload: unknown): string {
  return createHash("sha256").update(canonicalizeJson(payload)).digest("hex");
}

/**
 * Repository contract required by `Erp3Service` for Issue #28 mutations
 * and minimal state-verification read-backs.
 */
export interface Erp3Repository {
  // Sales Orders (mutations + minimal lookups)
  getSalesOrderById(id: string): Promise<SalesOrder | null>;
  getSalesOrderByNumber(orderNumber: string): Promise<SalesOrder | null>;
  createSalesOrder(
    order: Omit<SalesOrder, "created_at" | "updated_at"> & {
      created_at?: string;
      updated_at?: string;
    },
  ): Promise<SalesOrder>;
  updateSalesOrderStatus(
    id: string,
    status: SalesOrderStatus,
  ): Promise<SalesOrder>;
  nextOrderNumber(): Promise<string>;

  // Invoices (mutations + minimal lookups)
  getInvoiceById(id: string): Promise<Invoice | null>;
  getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | null>;
  getInvoiceByOrderId(orderId: string): Promise<Invoice | null>;
  createInvoice(
    invoice: Omit<Invoice, "created_at" | "updated_at"> & {
      created_at?: string;
      updated_at?: string;
    },
  ): Promise<Invoice>;
  updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<Invoice>;
  nextInvoiceNumber(): Promise<string>;

  // Payments (mutations + minimal lookups)
  getPaymentById(id: string): Promise<Payment | null>;
  listPaymentsByInvoiceId(invoiceId: string): Promise<Payment[]>;
  createPayment(
    payment: Omit<Payment, "created_at"> & { created_at?: string },
  ): Promise<Payment>;

  // Durable Import Receipts (KIT-08 / Decision C4)
  getImportReceiptByKey(
    idempotencyKey: string,
  ): Promise<ImportReceiptRecord | null>;
  createImportReceipt(
    receipt: Omit<ImportReceiptRecord, "id" | "created_at"> & {
      id?: string;
      created_at?: string;
    },
  ): Promise<ImportReceiptRecord>;

  // Atomic transaction boundary
  executeTransactional<T>(
    work: (txRepo: Erp3Repository) => Promise<T>,
  ): Promise<T>;
}

/**
 * Deterministic in-memory repository for unit and API mutation tests.
 *
 * NOTE: Non-durable test store. Production Drizzle persistence is blocked on
 * Issue #26 (`ERP3-01` schema and migrations).
 */
export class InMemoryErp3Repository implements Erp3Repository {
  public salesOrders = new Map<string, SalesOrder>();
  public invoices = new Map<string, Invoice>();
  public payments = new Map<string, Payment>();
  public receipts = new Map<string, ImportReceiptRecord>();

  private orderCounter = 0;
  private invoiceCounter = 0;

  constructor(seed = false) {
    if (seed) {
      this.seedFixtures();
    }
  }

  private seedFixtures(): void {
    const now = "2026-04-01T00:00:00.000Z";
    const orderId = "aaaaaaaa-0003-4000-8000-000000000001";
    const customerId = "55555555-0003-4000-8000-000000000001";
    const productId = "11111111-0001-4000-8000-000000000001";

    this.orderCounter = 1;
    this.salesOrders.set(orderId, {
      id: orderId,
      order_number: "SO-2026-0001",
      customer_golden_id: customerId,
      order_date: "2026-04-01",
      status: "Open",
      currency: "USD",
      total: "1180.0000",
      lines: [
        {
          id: "bbbbbbbb-0003-4000-8000-000000000001",
          order_id: orderId,
          product_id: productId,
          quantity: "10.0000",
          price: "100.0000",
          tax_rate: "18.0000",
          tax_amount: "180.0000",
          line_total: "1180.0000",
          created_at: now,
        },
      ],
      source_system: null,
      source_id: null,
      created_at: now,
      updated_at: now,
    });
  }

  async nextOrderNumber(): Promise<string> {
    this.orderCounter += 1;
    return `SO-2026-${String(this.orderCounter).padStart(4, "0")}`;
  }

  async nextInvoiceNumber(): Promise<string> {
    this.invoiceCounter += 1;
    return `INV-2026-${String(this.invoiceCounter).padStart(4, "0")}`;
  }

  async getSalesOrderById(id: string): Promise<SalesOrder | null> {
    const order = this.salesOrders.get(id);
    return order ? structuredClone(order) : null;
  }

  async getSalesOrderByNumber(orderNumber: string): Promise<SalesOrder | null> {
    for (const order of this.salesOrders.values()) {
      if (order.order_number === orderNumber) {
        return structuredClone(order);
      }
    }
    return null;
  }

  async createSalesOrder(
    order: Omit<SalesOrder, "created_at" | "updated_at"> & {
      created_at?: string;
      updated_at?: string;
    },
  ): Promise<SalesOrder> {
    const now = new Date().toISOString();
    const record: SalesOrder = {
      ...order,
      created_at: order.created_at ?? now,
      updated_at: order.updated_at ?? now,
    };
    this.salesOrders.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async updateSalesOrderStatus(
    id: string,
    status: SalesOrderStatus,
  ): Promise<SalesOrder> {
    const existing = this.salesOrders.get(id);
    if (!existing) {
      throw new Error(`Sales order '${id}' not found`);
    }
    const updated: SalesOrder = {
      ...existing,
      status,
      updated_at: new Date().toISOString(),
    };
    this.salesOrders.set(id, structuredClone(updated));
    return structuredClone(updated);
  }

  async getInvoiceById(id: string): Promise<Invoice | null> {
    const invoice = this.invoices.get(id);
    return invoice ? structuredClone(invoice) : null;
  }

  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | null> {
    for (const invoice of this.invoices.values()) {
      if (invoice.invoice_number === invoiceNumber) {
        return structuredClone(invoice);
      }
    }
    return null;
  }

  async getInvoiceByOrderId(orderId: string): Promise<Invoice | null> {
    for (const invoice of this.invoices.values()) {
      if (invoice.order_id === orderId) {
        return structuredClone(invoice);
      }
    }
    return null;
  }

  async createInvoice(
    invoice: Omit<Invoice, "created_at" | "updated_at"> & {
      created_at?: string;
      updated_at?: string;
    },
  ): Promise<Invoice> {
    const now = new Date().toISOString();
    const record: Invoice = {
      ...invoice,
      created_at: invoice.created_at ?? now,
      updated_at: invoice.updated_at ?? now,
    };
    this.invoices.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async updateInvoiceStatus(
    id: string,
    status: InvoiceStatus,
  ): Promise<Invoice> {
    const existing = this.invoices.get(id);
    if (!existing) {
      throw new Error(`Invoice '${id}' not found`);
    }
    const updated: Invoice = {
      ...existing,
      status,
      updated_at: new Date().toISOString(),
    };
    this.invoices.set(id, structuredClone(updated));
    return structuredClone(updated);
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    const payment = this.payments.get(id);
    return payment ? structuredClone(payment) : null;
  }

  async listPaymentsByInvoiceId(invoiceId: string): Promise<Payment[]> {
    const results: Payment[] = [];
    for (const payment of this.payments.values()) {
      if (payment.invoice_id === invoiceId) {
        results.push(structuredClone(payment));
      }
    }
    return results;
  }

  async createPayment(
    payment: Omit<Payment, "created_at"> & { created_at?: string },
  ): Promise<Payment> {
    const now = new Date().toISOString();
    const record: Payment = {
      ...payment,
      created_at: payment.created_at ?? now,
    };
    this.payments.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async getImportReceiptByKey(
    idempotencyKey: string,
  ): Promise<ImportReceiptRecord | null> {
    const receipt = this.receipts.get(idempotencyKey);
    return receipt ? structuredClone(receipt) : null;
  }

  async createImportReceipt(
    receipt: Omit<ImportReceiptRecord, "id" | "created_at"> & {
      id?: string;
      created_at?: string;
    },
  ): Promise<ImportReceiptRecord> {
    if (this.receipts.has(receipt.idempotency_key)) {
      throw new Error(
        `Duplicate idempotency_key '${receipt.idempotency_key}' in import receipts`,
      );
    }
    const record: ImportReceiptRecord = {
      ...receipt,
      id: receipt.id ?? randomUUID(),
      created_at: receipt.created_at ?? new Date().toISOString(),
    };
    this.receipts.set(record.idempotency_key, structuredClone(record));
    return structuredClone(record);
  }

  /**
   * Executes `work` atomically against this in-memory store.
   * If `work` throws, all maps and sequence counters roll back to their pre-transaction snapshot.
   */
  async executeTransactional<T>(
    work: (txRepo: Erp3Repository) => Promise<T>,
  ): Promise<T> {
    const ordersSnapshot = structuredClone(this.salesOrders);
    const invoicesSnapshot = structuredClone(this.invoices);
    const paymentsSnapshot = structuredClone(this.payments);
    const receiptsSnapshot = structuredClone(this.receipts);
    const orderCounterSnapshot = this.orderCounter;
    const invoiceCounterSnapshot = this.invoiceCounter;

    try {
      return await work(this);
    } catch (error) {
      this.salesOrders = ordersSnapshot;
      this.invoices = invoicesSnapshot;
      this.payments = paymentsSnapshot;
      this.receipts = receiptsSnapshot;
      this.orderCounter = orderCounterSnapshot;
      this.invoiceCounter = invoiceCounterSnapshot;
      throw error;
    }
  }
}
