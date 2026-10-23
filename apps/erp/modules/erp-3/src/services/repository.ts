/**
 * ERP-3 Sales Orders & Invoices — Repository Contract & Implementations
 *
 * Implements:
 *   - Erp3Repository contract for sales orders, lines, invoices, payments, and import receipts.
 *   - InMemoryErp3Repository: in-memory store with rollback snapshots for fast isolated unit & API tests.
 *   - DrizzleErp3Repository: PostgreSQL persistence via Drizzle ORM for integration & DB constraint tests.
 *
 * @module erp3/services/repository
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  ImportReceiptRecord,
  Invoice,
  InvoiceListQuery,
  InvoiceListResponse,
  InvoiceStatus,
  Payment,
  PaymentListQuery,
  PaymentListResponse,
  SalesOrder,
  SalesOrderListQuery,
  SalesOrderListResponse,
  SalesOrderStatus,
} from "@clearshift/contracts";
import { and, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  salesOrders,
  soLines,
  invoices,
  invoiceLines,
  payments,
  importReceipts,
  type SalesOrderRecord,
  type SoLineRecord,
  type InvoiceRecord,
  type InvoiceLineRecord,
  type PaymentRecord,
  type ImportReceiptRecord as DbImportReceipt,
} from "../../db/schema.js";

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
 * Repository contract required by `Erp3Service` and API route handlers.
 */
export interface Erp3Repository {
  // Sales Orders
  listSalesOrders(query: SalesOrderListQuery): Promise<SalesOrderListResponse>;
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

  // Invoices
  listInvoices(query: InvoiceListQuery): Promise<InvoiceListResponse>;
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

  // Payments
  listPayments(query: PaymentListQuery): Promise<PaymentListResponse>;
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

  async listSalesOrders(query: SalesOrderListQuery): Promise<SalesOrderListResponse> {
    let items = Array.from(this.salesOrders.values());

    if (query.status) {
      items = items.filter((so) => so.status === query.status);
    }
    if (query.customer_golden_id) {
      const cid = query.customer_golden_id.toLowerCase();
      items = items.filter((so) => so.customer_golden_id.toLowerCase() === cid);
    }
    if (query.currency) {
      items = items.filter((so) => so.currency === query.currency);
    }
    if (query.from_date) {
      items = items.filter((so) => so.order_date >= query.from_date!);
    }
    if (query.to_date) {
      items = items.filter((so) => so.order_date <= query.to_date!);
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      items = items.filter(
        (so) =>
          so.order_number.toLowerCase().includes(q) ||
          so.customer_golden_id.toLowerCase().includes(q),
      );
    }

    items.sort(
      (a, b) =>
        b.order_date.localeCompare(a.order_date) || a.id.localeCompare(b.id),
    );

    const total = items.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize).map((so) => structuredClone(so));
    const totalPages = Math.ceil(total / pageSize);

    return {
      data: paged,
      total,
      page,
      pageSize,
      totalPages,
    };
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

  async listInvoices(query: InvoiceListQuery): Promise<InvoiceListResponse> {
    let items = Array.from(this.invoices.values());

    if (query.status) {
      items = items.filter((inv) => inv.status === query.status);
    }
    if (query.customer_golden_id) {
      const cid = query.customer_golden_id.toLowerCase();
      items = items.filter((inv) => inv.customer_golden_id.toLowerCase() === cid);
    }
    if (query.order_id) {
      items = items.filter((inv) => inv.order_id === query.order_id);
    }
    if (query.currency) {
      items = items.filter((inv) => inv.currency === query.currency);
    }
    if (query.from_date) {
      items = items.filter((inv) => inv.invoice_date >= query.from_date!);
    }
    if (query.to_date) {
      items = items.filter((inv) => inv.invoice_date <= query.to_date!);
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      items = items.filter(
        (inv) =>
          inv.invoice_number.toLowerCase().includes(q) ||
          inv.customer_golden_id.toLowerCase().includes(q),
      );
    }

    items.sort(
      (a, b) =>
        b.invoice_date.localeCompare(a.invoice_date) || a.id.localeCompare(b.id),
    );

    const total = items.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize).map((inv) => structuredClone(inv));
    const totalPages = Math.ceil(total / pageSize);

    return {
      data: paged,
      total,
      page,
      pageSize,
      totalPages,
    };
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

  async listPayments(query: PaymentListQuery): Promise<PaymentListResponse> {
    let items = Array.from(this.payments.values());

    if (query.invoice_id) {
      items = items.filter((p) => p.invoice_id === query.invoice_id);
    }

    items.sort(
      (a, b) =>
        b.paid_at.localeCompare(a.paid_at) || a.id.localeCompare(b.id),
    );

    const total = items.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize).map((p) => structuredClone(p));
    const totalPages = Math.ceil(total / pageSize);

    return {
      data: paged,
      total,
      page,
      pageSize,
      totalPages,
    };
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

/**
 * PostgreSQL persistence via Drizzle ORM.
 */
export class DrizzleErp3Repository implements Erp3Repository {
  constructor(private readonly db: NodePgDatabase<Record<string, never>>) {}

  async nextOrderNumber(): Promise<string> {
    const [row] = await this.db.select({ count: count() }).from(salesOrders);
    const nextVal = (row ? Number(row.count) : 0) + 1;
    return `SO-2026-${String(nextVal).padStart(4, "0")}`;
  }

  async nextInvoiceNumber(): Promise<string> {
    const [row] = await this.db.select({ count: count() }).from(invoices);
    const nextVal = (row ? Number(row.count) : 0) + 1;
    return `INV-2026-${String(nextVal).padStart(4, "0")}`;
  }

  async listSalesOrders(query: SalesOrderListQuery): Promise<SalesOrderListResponse> {
    const conditions: SQL[] = [];
    if (query.status) {
      conditions.push(eq(salesOrders.status, query.status));
    }
    if (query.customer_golden_id) {
      conditions.push(eq(salesOrders.customer_golden_id, query.customer_golden_id));
    }
    if (query.currency) {
      conditions.push(eq(salesOrders.currency, query.currency));
    }
    if (query.from_date) {
      conditions.push(gte(salesOrders.order_date, query.from_date));
    }
    if (query.to_date) {
      conditions.push(lte(salesOrders.order_date, query.to_date));
    }
    if (query.search) {
      conditions.push(
        or(
          ilike(salesOrders.order_number, `%${query.search}%`),
          sql`${salesOrders.customer_golden_id}::text ILIKE ${`%${query.search}%`}`,
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await this.db
      .select({ count: count() })
      .from(salesOrders)
      .where(whereClause);
    const total = totalRow ? Number(totalRow.count) : 0;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const orderRows = await this.db
      .select()
      .from(salesOrders)
      .where(whereClause)
      .orderBy(desc(salesOrders.order_date), desc(salesOrders.id))
      .limit(pageSize)
      .offset(offset);

    const items: SalesOrder[] = [];
    for (const row of orderRows) {
      const lineRows = await this.db
        .select()
        .from(soLines)
        .where(eq(soLines.order_id, row.id))
        .orderBy(soLines.line_number);

      items.push({
        id: row.id,
        order_number: row.order_number,
        customer_golden_id: row.customer_golden_id,
        order_date: row.order_date,
        status: row.status as SalesOrderStatus,
        currency: row.currency,
        total: row.total,
        lines: lineRows.map((l) => ({
          id: l.id,
          order_id: l.order_id,
          product_id: l.product_id,
          quantity: l.quantity,
          price: l.unit_price,
          tax_rate: l.tax_rate,
          tax_amount: l.tax_amount,
          line_total: l.line_total,
          created_at: l.created_at.toISOString(),
        })),
        source_system: row.source_system ?? null,
        source_id: row.source_id ?? null,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      });
    }

    return {
      data: items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getSalesOrderById(id: string): Promise<SalesOrder | null> {
    const [row] = await this.db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, id))
      .limit(1);
    if (!row) return null;

    const lineRows = await this.db
      .select()
      .from(soLines)
      .where(eq(soLines.order_id, row.id))
      .orderBy(soLines.line_number);

    return {
      id: row.id,
      order_number: row.order_number,
      customer_golden_id: row.customer_golden_id,
      order_date: row.order_date,
      status: row.status as SalesOrderStatus,
      currency: row.currency,
      total: row.total,
      lines: lineRows.map((l) => ({
        id: l.id,
        order_id: l.order_id,
        product_id: l.product_id,
        quantity: l.quantity,
        price: l.unit_price,
        tax_rate: l.tax_rate,
        tax_amount: l.tax_amount,
        line_total: l.line_total,
        created_at: l.created_at.toISOString(),
      })),
      source_system: row.source_system ?? null,
      source_id: row.source_id ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async getSalesOrderByNumber(orderNumber: string): Promise<SalesOrder | null> {
    const [row] = await this.db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.order_number, orderNumber))
      .limit(1);
    if (!row) return null;

    const lineRows = await this.db
      .select()
      .from(soLines)
      .where(eq(soLines.order_id, row.id))
      .orderBy(soLines.line_number);

    return {
      id: row.id,
      order_number: row.order_number,
      customer_golden_id: row.customer_golden_id,
      order_date: row.order_date,
      status: row.status as SalesOrderStatus,
      currency: row.currency,
      total: row.total,
      lines: lineRows.map((l) => ({
        id: l.id,
        order_id: l.order_id,
        product_id: l.product_id,
        quantity: l.quantity,
        price: l.unit_price,
        tax_rate: l.tax_rate,
        tax_amount: l.tax_amount,
        line_total: l.line_total,
        created_at: l.created_at.toISOString(),
      })),
      source_system: row.source_system ?? null,
      source_id: row.source_id ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async createSalesOrder(
    order: Omit<SalesOrder, "created_at" | "updated_at"> & {
      created_at?: string;
      updated_at?: string;
    },
  ): Promise<SalesOrder> {
    const [header] = await this.db
      .insert(salesOrders)
      .values({
        id: order.id,
        order_number: order.order_number,
        customer_golden_id: order.customer_golden_id,
        order_date: order.order_date,
        status: order.status,
        currency: order.currency,
        total: order.total,
        source_system: order.source_system ?? null,
        source_id: order.source_id ?? null,
      })
      .returning();

    if (!header) {
      throw new Error("Failed to insert sales order header");
    }

    const insertedLines: SalesOrder["lines"] = [];
    let idx = 1;
    for (const line of order.lines) {
      const [l] = await this.db
        .insert(soLines)
        .values({
          id: line.id,
          order_id: order.id,
          line_number: idx++,
          product_id: line.product_id,
          quantity: line.quantity,
          unit_price: line.price,
          tax_rate: line.tax_rate,
          tax_amount: line.tax_amount,
          line_total: line.line_total,
        })
        .returning();
      if (!l) throw new Error("Failed to insert sales order line");
      insertedLines.push({
        id: l.id,
        order_id: l.order_id,
        product_id: l.product_id,
        quantity: l.quantity,
        price: l.unit_price,
        tax_rate: l.tax_rate,
        tax_amount: l.tax_amount,
        line_total: l.line_total,
        created_at: l.created_at.toISOString(),
      });
    }

    return {
      id: header.id,
      order_number: header.order_number,
      customer_golden_id: header.customer_golden_id,
      order_date: header.order_date,
      status: header.status as SalesOrderStatus,
      currency: header.currency,
      total: header.total,
      lines: insertedLines,
      source_system: header.source_system ?? null,
      source_id: header.source_id ?? null,
      created_at: header.created_at.toISOString(),
      updated_at: header.updated_at.toISOString(),
    };
  }

  async updateSalesOrderStatus(
    id: string,
    status: SalesOrderStatus,
  ): Promise<SalesOrder> {
    const [row] = await this.db
      .update(salesOrders)
      .set({ status, updated_at: new Date() })
      .where(eq(salesOrders.id, id))
      .returning();
    if (!row) {
      throw new Error(`Sales order '${id}' not found`);
    }
    return (await this.getSalesOrderById(id))!;
  }

  async listInvoices(query: InvoiceListQuery): Promise<InvoiceListResponse> {
    const conditions: SQL[] = [];
    if (query.status) {
      conditions.push(eq(invoices.status, query.status));
    }
    if (query.customer_golden_id) {
      conditions.push(eq(invoices.customer_golden_id, query.customer_golden_id));
    }
    if (query.order_id) {
      conditions.push(eq(invoices.order_id, query.order_id));
    }
    if (query.currency) {
      conditions.push(eq(invoices.currency, query.currency));
    }
    if (query.from_date) {
      conditions.push(gte(invoices.invoice_date, query.from_date));
    }
    if (query.to_date) {
      conditions.push(lte(invoices.invoice_date, query.to_date));
    }
    if (query.search) {
      conditions.push(
        or(
          ilike(invoices.invoice_number, `%${query.search}%`),
          sql`${invoices.customer_golden_id}::text ILIKE ${`%${query.search}%`}`,
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const [totalRow] = await this.db
      .select({ count: count() })
      .from(invoices)
      .where(whereClause);
    const total = totalRow ? Number(totalRow.count) : 0;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const invRows = await this.db
      .select()
      .from(invoices)
      .where(whereClause)
      .orderBy(desc(invoices.invoice_date), desc(invoices.id))
      .limit(pageSize)
      .offset(offset);

    const items: Invoice[] = [];
    for (const row of invRows) {
      const lineRows = await this.db
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoice_id, row.id))
        .orderBy(invoiceLines.line_number);

      items.push({
        id: row.id,
        invoice_number: row.invoice_number,
        order_id: row.order_id,
        customer_golden_id: row.customer_golden_id,
        invoice_date: row.invoice_date,
        due_date: row.due_date,
        status: row.status as InvoiceStatus,
        currency: row.currency,
        total: row.total,
        lines: lineRows.map((l) => ({
          id: l.id,
          invoice_id: l.invoice_id,
          product_id: l.product_id,
          quantity: l.quantity,
          price: l.unit_price,
          tax_rate: l.tax_rate,
          tax_amount: l.tax_amount,
          line_total: l.line_total,
          created_at: l.created_at.toISOString(),
        })),
        source_system: row.source_system ?? null,
        source_id: row.source_id ?? null,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      });
    }

    return {
      data: items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getInvoiceById(id: string): Promise<Invoice | null> {
    const [row] = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    if (!row) return null;

    const lineRows = await this.db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoice_id, row.id))
      .orderBy(invoiceLines.line_number);

    return {
      id: row.id,
      invoice_number: row.invoice_number,
      order_id: row.order_id,
      customer_golden_id: row.customer_golden_id,
      invoice_date: row.invoice_date,
      due_date: row.due_date,
      status: row.status as InvoiceStatus,
      currency: row.currency,
      total: row.total,
      lines: lineRows.map((l) => ({
        id: l.id,
        invoice_id: l.invoice_id,
        product_id: l.product_id,
        quantity: l.quantity,
        price: l.unit_price,
        tax_rate: l.tax_rate,
        tax_amount: l.tax_amount,
        line_total: l.line_total,
        created_at: l.created_at.toISOString(),
      })),
      source_system: row.source_system ?? null,
      source_id: row.source_id ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | null> {
    const [row] = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.invoice_number, invoiceNumber))
      .limit(1);
    if (!row) return null;
    return this.getInvoiceById(row.id);
  }

  async getInvoiceByOrderId(orderId: string): Promise<Invoice | null> {
    const [row] = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.order_id, orderId))
      .limit(1);
    if (!row) return null;
    return this.getInvoiceById(row.id);
  }

  async createInvoice(
    invoice: Omit<Invoice, "created_at" | "updated_at"> & {
      created_at?: string;
      updated_at?: string;
    },
  ): Promise<Invoice> {
    const [header] = await this.db
      .insert(invoices)
      .values({
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        order_id: invoice.order_id ?? null,
        customer_golden_id: invoice.customer_golden_id,
        invoice_date: invoice.invoice_date,
        due_date: invoice.due_date,
        status: invoice.status,
        currency: invoice.currency,
        total: invoice.total,
        source_system: invoice.source_system ?? null,
        source_id: invoice.source_id ?? null,
      })
      .returning();

    if (!header) throw new Error("Failed to insert invoice header");

    const insertedLines: Invoice["lines"] = [];
    let idx = 1;
    for (const line of invoice.lines) {
      const [l] = await this.db
        .insert(invoiceLines)
        .values({
          id: line.id,
          invoice_id: invoice.id,
          line_number: idx++,
          product_id: line.product_id,
          quantity: line.quantity,
          unit_price: line.price,
          tax_rate: line.tax_rate,
          tax_amount: line.tax_amount,
          line_total: line.line_total,
        })
        .returning();
      if (!l) throw new Error("Failed to insert invoice line");
      insertedLines.push({
        id: l.id,
        invoice_id: l.invoice_id,
        product_id: l.product_id,
        quantity: l.quantity,
        price: l.unit_price,
        tax_rate: l.tax_rate,
        tax_amount: l.tax_amount,
        line_total: l.line_total,
        created_at: l.created_at.toISOString(),
      });
    }

    return {
      id: header.id,
      invoice_number: header.invoice_number,
      order_id: header.order_id,
      customer_golden_id: header.customer_golden_id,
      invoice_date: header.invoice_date,
      due_date: header.due_date,
      status: header.status as InvoiceStatus,
      currency: header.currency,
      total: header.total,
      lines: insertedLines,
      source_system: header.source_system ?? null,
      source_id: header.source_id ?? null,
      created_at: header.created_at.toISOString(),
      updated_at: header.updated_at.toISOString(),
    };
  }

  async updateInvoiceStatus(
    id: string,
    status: InvoiceStatus,
  ): Promise<Invoice> {
    const [row] = await this.db
      .update(invoices)
      .set({ status, updated_at: new Date() })
      .where(eq(invoices.id, id))
      .returning();
    if (!row) throw new Error(`Invoice '${id}' not found`);
    return (await this.getInvoiceById(id))!;
  }

  async listPayments(query: PaymentListQuery): Promise<PaymentListResponse> {
    const conditions: SQL[] = [];
    if (query.invoice_id) {
      conditions.push(eq(payments.invoice_id, query.invoice_id));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const [totalRow] = await this.db
      .select({ count: count() })
      .from(payments)
      .where(whereClause);
    const total = totalRow ? Number(totalRow.count) : 0;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const rows = await this.db
      .select()
      .from(payments)
      .where(whereClause)
      .orderBy(desc(payments.created_at), desc(payments.id))
      .limit(pageSize)
      .offset(offset);

    const items: Payment[] = rows.map((p) => ({
      id: p.id,
      invoice_id: p.invoice_id,
      amount: p.amount,
      paid_at: p.created_at.toISOString(),
      method: p.payment_method as Payment["method"],
      created_at: p.created_at.toISOString(),
    }));

    return {
      data: items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      invoice_id: row.invoice_id,
      amount: row.amount,
      paid_at: row.created_at.toISOString(),
      method: row.payment_method as Payment["method"],
      created_at: row.created_at.toISOString(),
    };
  }

  async listPaymentsByInvoiceId(invoiceId: string): Promise<Payment[]> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.invoice_id, invoiceId))
      .orderBy(payments.created_at);

    return rows.map((p) => ({
      id: p.id,
      invoice_id: p.invoice_id,
      amount: p.amount,
      paid_at: p.created_at.toISOString(),
      method: p.payment_method as Payment["method"],
      created_at: p.created_at.toISOString(),
    }));
  }

  async createPayment(
    payment: Omit<Payment, "created_at"> & { created_at?: string },
  ): Promise<Payment> {
    const [row] = await this.db
      .insert(payments)
      .values({
        id: payment.id,
        invoice_id: payment.invoice_id,
        amount: payment.amount,
        payment_date: payment.paid_at.slice(0, 10),
        payment_method: payment.method,
      })
      .returning();
    if (!row) throw new Error("Failed to insert payment");

    return {
      id: row.id,
      invoice_id: row.invoice_id,
      amount: row.amount,
      paid_at: row.created_at.toISOString(),
      method: row.payment_method as Payment["method"],
      created_at: row.created_at.toISOString(),
    };
  }

  async getImportReceiptByKey(
    idempotencyKey: string,
  ): Promise<ImportReceiptRecord | null> {
    const [row] = await this.db
      .select()
      .from(importReceipts)
      .where(eq(importReceipts.idempotency_key, idempotencyKey))
      .limit(1);
    if (!row) return null;

    let parsedPayload: unknown = null;
    if (row.response_payload) {
      try {
        parsedPayload = JSON.parse(row.response_payload);
      } catch {
        parsedPayload = row.response_payload;
      }
    }

    return {
      id: row.id,
      batch_id: row.batch_id,
      source_row: row.source_row,
      source_system: row.source_system ?? undefined,
      source_id: row.source_id ?? undefined,
      entity: row.entity,
      schema_version: row.schema_version,
      idempotency_key: row.idempotency_key,
      request_hash: row.request_hash,
      target_id: row.target_id,
      kind: (row.kind as "created" | "linked") ?? "created",
      outcome: (row.outcome as "loaded" | "rejected" | "merged" | "skipped") ?? "loaded",
      response_payload: parsedPayload,
      created_at: row.created_at.toISOString(),
    };
  }

  async createImportReceipt(
    receipt: Omit<ImportReceiptRecord, "id" | "created_at"> & {
      id?: string;
      created_at?: string;
    },
  ): Promise<ImportReceiptRecord> {
    const [row] = await this.db
      .insert(importReceipts)
      .values({
        id: receipt.id ?? randomUUID(),
        batch_id: receipt.batch_id,
        source_row: receipt.source_row,
        source_system: receipt.source_system ?? null,
        source_id: receipt.source_id ?? null,
        entity: receipt.entity,
        schema_version: receipt.schema_version ?? 1,
        idempotency_key: receipt.idempotency_key,
        request_hash: receipt.request_hash,
        target_id: receipt.target_id,
        kind: receipt.kind ?? "created",
        outcome: receipt.outcome ?? "loaded",
        response_payload: receipt.response_payload ? JSON.stringify(receipt.response_payload) : null,
      })
      .returning();
    if (!row) throw new Error("Failed to insert import receipt");

    let parsedPayload: unknown = null;
    if (row.response_payload) {
      try {
        parsedPayload = JSON.parse(row.response_payload);
      } catch {
        parsedPayload = row.response_payload;
      }
    }

    return {
      id: row.id,
      batch_id: row.batch_id,
      source_row: row.source_row,
      source_system: row.source_system ?? undefined,
      source_id: row.source_id ?? undefined,
      entity: row.entity,
      schema_version: row.schema_version,
      idempotency_key: row.idempotency_key,
      request_hash: row.request_hash,
      target_id: row.target_id,
      kind: (row.kind as "created" | "linked") ?? "created",
      outcome: (row.outcome as "loaded" | "rejected" | "merged" | "skipped") ?? "loaded",
      response_payload: parsedPayload,
      created_at: row.created_at.toISOString(),
    };
  }

  async executeTransactional<T>(
    work: (txRepo: Erp3Repository) => Promise<T>,
  ): Promise<T> {
    return await this.db.transaction(async (tx) => {
      const txRepo = new DrizzleErp3Repository(
        tx as unknown as NodePgDatabase<Record<string, never>>,
      );
      return await work(txRepo);
    });
  }
}
