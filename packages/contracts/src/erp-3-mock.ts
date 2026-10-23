/**
 * ERP-3 Sales Orders & Invoices — Deterministic Mock Server & Contract Package
 *
 * Provides a production-grade, zero-external-dependency mock server and
 * deterministic fixture dataset for dependent teams (CRM-1, CRM-2, CRM-3,
 * ERP-4, and the Migration Kit).
 *
 * Conforms strictly to:
 *   - SDS ClearShift ERP v2.0 §4.4 (FR-ERP3-01..05, BR-ERP3-01..03)
 *   - ADR-002: Shared Zod/OpenAPI Contract & Error Envelope
 *   - ADR-003: Hub Golden ID (customer_golden_id is a UUID PK)
 *   - PLT-04 / PLT-09: Bounded Pagination & Transactional Event Envelopes
 *   - Issue #150 ([ERP3-14])
 *
 * Interface:
 *   - createErp3MockServer()  → { app, store, reset, stop }
 *   (No standalone `npm run mock:erp-3` script is added; that would modify the
 *   root package.json, which is outside this issue's approved scope.)
 *
 * ⚠️ DR-1: Monetary rounding rule is unresolved. The mock performs exact
 * scaled-integer arithmetic at 4 dp and NEVER rounds. Any input whose computed
 * tax_amount/line_total is not exactly representable at 4 dp is rejected with
 * 422 DR1_ROUNDING_UNRESOLVED. The authoritative rule must be confirmed before
 * the real mutation API (ERP3-05) is implemented.
 *
 * @module contracts/erp-3-mock
 */

import fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  SalesOrderListQuerySchema,
  SalesOrderListResponseSchema,
  CreateSalesOrderRequestSchema,
  InvoiceListQuerySchema,
  InvoiceListResponseSchema,
  CreateInvoiceRequestSchema,
  CreatePaymentRequestSchema,
  Erp3IdParamSchema,
  ERP3_RELATIONSHIP_ERROR_CODES,
  type SalesOrder,
  type SalesOrderLine,
  type Invoice,
  type InvoiceLine,
  type Payment,
  type InvoiceStatus,
} from "./erp-3.js";
import { ERP3_EVENT_TYPES, createErp3Event } from "./erp-3-events.js";
import type { EventEnvelope } from "./events.js";

export const ERP3_MOCK_DEFAULT_PORT = 4013;

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Seed IDs
// All IDs are fixed to guarantee reproducible test assertions.
// ─────────────────────────────────────────────────────────────────────────────

/** Synthetic customer Golden IDs (UUID PKs — ADR-003). */
const SEED_CUSTOMER_1 = "55555555-0003-4000-8000-000000000001";
const SEED_CUSTOMER_2 = "55555555-0003-4000-8000-000000000002";

/** Synthetic ERP-1 product IDs. */
const SEED_PRODUCT_1 = "11111111-0001-4000-8000-000000000001";
const SEED_PRODUCT_2 = "11111111-0001-4000-8000-000000000002";
const SEED_PRODUCT_3 = "11111111-0001-4000-8000-000000000003";

/** Sales order IDs. */
const SEED_ORDER_1 = "aaaaaaaa-0003-4000-8000-000000000001";
const SEED_ORDER_2 = "aaaaaaaa-0003-4000-8000-000000000002";

/** Sales order line IDs. */
const SEED_OLINE_1 = "bbbbbbbb-0003-4000-8000-000000000001";
const SEED_OLINE_2 = "bbbbbbbb-0003-4000-8000-000000000002";
const SEED_OLINE_3 = "bbbbbbbb-0003-4000-8000-000000000003";

/** Invoice IDs. */
const SEED_INVOICE_1 = "cccccccc-0003-4000-8000-000000000001";
const SEED_INVOICE_2 = "cccccccc-0003-4000-8000-000000000002";

/** Invoice line IDs. */
const SEED_ILINE_1 = "dddddddd-0003-4000-8000-000000000001";
const SEED_ILINE_2 = "dddddddd-0003-4000-8000-000000000002";

/** Payment IDs. */
const SEED_PAYMENT_1 = "eeeeeeee-0003-4000-8000-000000000001";

const SEED_TS = "2026-04-01T00:00:00.000Z";
const SEED_TS2 = "2026-04-15T09:00:00.000Z";

// ─────────────────────────────────────────────────────────────────────────────
// Mock Store Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp3MockStore {
  salesOrders: Map<string, SalesOrder>;
  invoices: Map<string, Invoice>;
  payments: Map<string, Payment>;
  emittedEvents: EventEnvelope[];
  /** Monotonic counter for auto-generated order numbers. */
  orderCounter: number;
  /** Monotonic counter for auto-generated invoice numbers. */
  invoiceCounter: number;
  /** Monotonic counter for payment IDs. */
  paymentCounter: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock helper: exact 4-dp decimal arithmetic (NO rounding — DR-1 unresolved)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ DR-1: The monetary rounding rule is NOT confirmed. This mock therefore
 * never rounds. All arithmetic is exact on scaled BigInt integers (scale 10^4).
 * If a computed value cannot be represented exactly at 4 dp, the mock throws
 * `Dr1InexactError` and the route answers 422 `DR1_ROUNDING_UNRESOLVED`
 * instead of silently choosing a rounding method.
 */
const SCALE = 10_000n;
export const DR1_ROUNDING_UNRESOLVED = "DR1_ROUNDING_UNRESOLVED";

class Dr1InexactError extends Error {}

/** Parses a non-negative decimal string (≤ 4 dp) into a scaled BigInt. */
function toScaled(v: string): bigint {
  const [int = "0", frac = ""] = v.split(".");
  return BigInt(int) * SCALE + BigInt((frac + "0000").slice(0, 4));
}

/** Formats a scaled BigInt as a 4-dp decimal string. */
function fromScaled(v: bigint): string {
  const int = v / SCALE;
  const frac = (v % SCALE).toString().padStart(4, "0");
  return `${int}.${frac}`;
}

/** Exact division; throws Dr1InexactError rather than rounding. */
function exactDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator % denominator !== 0n) throw new Dr1InexactError();
  return numerator / denominator;
}

/**
 * Computes tax_amount and line_total exactly.
 *   base       = quantity × price
 *   tax_amount = base × tax_rate ÷ 100
 *   line_total = base + tax_amount
 * Throws Dr1InexactError if any value needs more than 4 dp.
 */
function computeLine(
  quantity: string,
  price: string,
  taxRate: string,
): { tax_amount: string; line_total: string } {
  const base = exactDiv(toScaled(quantity) * toScaled(price), SCALE);
  const tax = exactDiv(base * toScaled(taxRate), SCALE * 100n);
  return { tax_amount: fromScaled(tax), line_total: fromScaled(base + tax) };
}

/** Exact sum of 4-dp decimal strings. */
function sumScaled(values: string[]): bigint {
  return values.reduce((acc, v) => acc + toScaled(v), 0n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed Factory
// ─────────────────────────────────────────────────────────────────────────────

function buildSeedStore(): Erp3MockStore {
  const store: Erp3MockStore = {
    salesOrders: new Map(),
    invoices: new Map(),
    payments: new Map(),
    emittedEvents: [],
    orderCounter: 2,
    invoiceCounter: 2,
    paymentCounter: 1,
  };

  // ── Seed Sales Orders ──────────────────────────────────────────────────────

  const orderLine1: SalesOrderLine = {
    id: SEED_OLINE_1,
    order_id: SEED_ORDER_1,
    product_id: SEED_PRODUCT_1,
    quantity: "2.0000",
    price: "500.0000",
    tax_rate: "18.0000",
    tax_amount: "180.0000", // 2 × 500 = 1000; tax = 1000 × 0.18 = 180
    line_total: "1180.0000", // 1000 + 180
    created_at: SEED_TS,
  };

  const orderLine2: SalesOrderLine = {
    id: SEED_OLINE_2,
    order_id: SEED_ORDER_1,
    product_id: SEED_PRODUCT_2,
    quantity: "1.0000",
    price: "800.0000",
    tax_rate: "18.0000",
    tax_amount: "144.0000", // 800 × 0.18
    line_total: "944.0000", // 800 + 144
    created_at: SEED_TS,
  };

  const order1: SalesOrder = {
    id: SEED_ORDER_1,
    order_number: "SO-2026-0001",
    customer_golden_id: SEED_CUSTOMER_1,
    order_date: "2026-04-01",
    status: "Open",
    currency: "INR",
    total: "2124.0000", // 1180 + 944
    lines: [orderLine1, orderLine2],
    source_system: null,
    source_id: null,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  };

  const orderLine3: SalesOrderLine = {
    id: SEED_OLINE_3,
    order_id: SEED_ORDER_2,
    product_id: SEED_PRODUCT_3,
    quantity: "5.0000",
    price: "200.0000",
    tax_rate: "0.0000",
    tax_amount: "0.0000",
    line_total: "1000.0000", // 5 × 200 (zero tax)
    created_at: SEED_TS2,
  };

  const order2: SalesOrder = {
    id: SEED_ORDER_2,
    order_number: "SO-2026-0002",
    customer_golden_id: SEED_CUSTOMER_2,
    order_date: "2026-04-15",
    status: "Invoiced",
    currency: "INR",
    total: "1000.0000",
    lines: [orderLine3],
    source_system: "legacy-csv",
    source_id: "EXT-SO-7890",
    created_at: SEED_TS2,
    updated_at: SEED_TS2,
  };

  store.salesOrders.set(SEED_ORDER_1, order1);
  store.salesOrders.set(SEED_ORDER_2, order2);

  // ── Seed Invoices ──────────────────────────────────────────────────────────

  const invoiceLine1: InvoiceLine = {
    id: SEED_ILINE_1,
    invoice_id: SEED_INVOICE_1,
    product_id: SEED_PRODUCT_3,
    quantity: "5.0000",
    price: "200.0000",
    tax_rate: "0.0000",
    tax_amount: "0.0000",
    line_total: "1000.0000",
    created_at: SEED_TS2,
  };

  const invoice1: Invoice = {
    id: SEED_INVOICE_1,
    invoice_number: "INV-2026-0001",
    order_id: SEED_ORDER_2,
    customer_golden_id: SEED_CUSTOMER_2,
    invoice_date: "2026-04-15",
    due_date: "2026-05-15",
    status: "Open",
    currency: "INR",
    total: "1000.0000",
    lines: [invoiceLine1],
    source_system: null,
    source_id: null,
    created_at: SEED_TS2,
    updated_at: SEED_TS2,
  };

  const invoiceLine2: InvoiceLine = {
    id: SEED_ILINE_2,
    invoice_id: SEED_INVOICE_2,
    product_id: SEED_PRODUCT_1,
    quantity: "1.0000",
    price: "500.0000",
    tax_rate: "18.0000",
    tax_amount: "90.0000",
    line_total: "590.0000",
    created_at: SEED_TS,
  };

  const invoice2: Invoice = {
    id: SEED_INVOICE_2,
    invoice_number: "INV-2026-0002",
    order_id: null,
    customer_golden_id: SEED_CUSTOMER_1,
    invoice_date: "2026-04-10",
    due_date: "2026-05-10",
    status: "Paid",
    currency: "INR",
    total: "590.0000",
    lines: [invoiceLine2],
    source_system: null,
    source_id: null,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  };

  store.invoices.set(SEED_INVOICE_1, invoice1);
  store.invoices.set(SEED_INVOICE_2, invoice2);

  // ── Seed Payments ──────────────────────────────────────────────────────────

  const payment1: Payment = {
    id: SEED_PAYMENT_1,
    invoice_id: SEED_INVOICE_2,
    amount: "590.0000",
    paid_at: SEED_TS,
    method: "bank",
    created_at: SEED_TS,
  };

  store.payments.set(SEED_PAYMENT_1, payment1);

  return store;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Registration
// ─────────────────────────────────────────────────────────────────────────────

function buildErrorReply(
  statusCode: number,
  errorClass: string,
  code: string,
  message: string,
  details?: unknown[],
) {
  const body: Record<string, unknown> = {
    statusCode,
    error: errorClass,
    code,
    message,
  };
  if (details) body["details"] = details;
  return body;
}

/** 422 reply used when exact 4-dp arithmetic is impossible (DR-1 unresolved). */
function dr1Reply() {
  return buildErrorReply(
    422,
    "Unprocessable Entity",
    DR1_ROUNDING_UNRESOLVED,
    "Computed amount requires more than 4 decimal places; rounding rule (DR-1) is unresolved.",
  );
}

/** Runs computeLine for each line; returns null if any value is inexact (DR-1). */
function tryComputeLines<
  T extends { quantity: string; price: string; tax_rate: string },
>(lines: T[]): Array<T & { tax_amount: string; line_total: string }> | null {
  try {
    return lines.map((l) => ({
      ...l,
      ...computeLine(l.quantity, l.price, l.tax_rate),
    }));
  } catch (err) {
    if (err instanceof Dr1InexactError) return null;
    throw err;
  }
}

function registerRoutes(app: FastifyInstance, store: Erp3MockStore): void {
  const CORRELATION_ID = "mock-erp-3-correlation";

  // ── GET /api/v1/erp-orders/sales-orders ────────────────────────────────────
  app.get("/api/v1/erp-orders/sales-orders", async (request, reply) => {
    const queryResult = SalesOrderListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      const firstIssue = queryResult.error.issues[0];
      return reply.status(400).send(
        buildErrorReply(
          400,
          "Bad Request",
          "VALIDATION_ERROR",
          firstIssue?.message ?? "Invalid query parameter",
          queryResult.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        ),
      );
    }
    const {
      page,
      pageSize,
      status,
      customer_golden_id,
      currency,
      from_date,
      to_date,
      search,
    } = queryResult.data;

    let orders = Array.from(store.salesOrders.values());

    if (status) orders = orders.filter((o) => o.status === status);
    if (customer_golden_id)
      orders = orders.filter(
        (o) => o.customer_golden_id === customer_golden_id,
      );
    if (currency) orders = orders.filter((o) => o.currency === currency);
    if (from_date) orders = orders.filter((o) => o.order_date >= from_date);
    if (to_date) orders = orders.filter((o) => o.order_date <= to_date);
    if (search) {
      const q = search.toLowerCase();
      orders = orders.filter((o) => o.order_number.toLowerCase().includes(q));
    }

    // Sort by order_date desc, then id asc
    orders.sort((a, b) => {
      const dateCmp = b.order_date.localeCompare(a.order_date);
      return dateCmp !== 0 ? dateCmp : a.id.localeCompare(b.id);
    });

    const total = orders.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (page - 1) * pageSize;
    const data = orders.slice(start, start + pageSize);

    return reply.status(200).send(
      SalesOrderListResponseSchema.parse({
        data,
        total,
        page,
        pageSize,
        totalPages,
      }),
    );
  });

  // ── POST /api/v1/erp-orders/sales-orders ───────────────────────────────────
  app.post("/api/v1/erp-orders/sales-orders", async (request, reply) => {
    const bodyResult = CreateSalesOrderRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      const firstIssue = bodyResult.error.issues[0];
      return reply
        .status(400)
        .send(
          buildErrorReply(
            400,
            "Bad Request",
            "VALIDATION_ERROR",
            firstIssue?.message ?? "Validation error",
            bodyResult.error.issues.map((i) => ({
              field: i.path.join("."),
              message: i.message,
              code: i.code,
            })),
          ),
        );
    }

    const body = bodyResult.data;

    // BR-ERP3-03: customer_golden_id already enforced by schema (non-optional UUID)

    // Duplicate order_number check
    if (body.order_number) {
      const exists = Array.from(store.salesOrders.values()).some(
        (o) => o.order_number === body.order_number,
      );
      if (exists) {
        return reply
          .status(409)
          .send(
            buildErrorReply(
              409,
              "Conflict",
              ERP3_RELATIONSHIP_ERROR_CODES.ORDER_NUMBER_EXISTS,
              `A sales order with order_number '${body.order_number}' already exists.`,
            ),
          );
      }
    }

    // Auto-generate order_number if omitted
    store.orderCounter += 1;
    const order_number =
      body.order_number ??
      `SO-2026-${String(store.orderCounter).padStart(4, "0")}`;

    // Compute lines server-side (exact; no rounding — DR-1)
    const computed = tryComputeLines(body.lines);
    if (!computed) return reply.status(422).send(dr1Reply());
    const now = new Date().toISOString();
    const orderId = randomUUID();
    const computedLines: SalesOrderLine[] = computed.map((l) => ({
      id: randomUUID(),
      order_id: orderId,
      product_id: l.product_id,
      quantity: l.quantity,
      price: l.price,
      tax_rate: l.tax_rate,
      tax_amount: l.tax_amount,
      line_total: l.line_total,
      created_at: now,
    }));

    // Compute total from lines (BR-ERP3-01)
    const total = fromScaled(sumScaled(computedLines.map((l) => l.line_total)));

    const order: SalesOrder = {
      id: orderId,
      order_number,
      customer_golden_id: body.customer_golden_id,
      order_date: body.order_date,
      status: "Open",
      currency: body.currency,
      total,
      lines: computedLines,
      source_system: body.source_system ?? null,
      source_id: body.source_id ?? null,
      created_at: now,
      updated_at: now,
    };

    store.salesOrders.set(orderId, order);

    // Emit domain event
    store.emittedEvents.push(
      createErp3Event({
        event_type: ERP3_EVENT_TYPES.SALES_ORDER_CREATED,
        correlation_id: CORRELATION_ID,
        entity_type: "sales_order",
        entity_id: orderId,
        payload: {
          id: orderId,
          order_number,
          customer_golden_id: body.customer_golden_id,
          order_date: body.order_date,
          status: "Open" as const,
          currency: body.currency,
          total,
          line_count: computedLines.length,
        },
      }),
    );

    return reply.status(201).send(order);
  });

  // ── GET /api/v1/erp-orders/sales-orders/:id ─────────────────────────────────
  // ⚠️ Implied — not in SDS §4.8 table. Flagged for Integration Lead confirmation.
  app.get("/api/v1/erp-orders/sales-orders/:id", async (request, reply) => {
    const params = Erp3IdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply
        .status(400)
        .send(
          buildErrorReply(
            400,
            "Bad Request",
            "VALIDATION_ERROR",
            "Invalid UUID format",
          ),
        );
    }

    const order = store.salesOrders.get(params.data.id);
    if (!order) {
      return reply
        .status(404)
        .send(
          buildErrorReply(
            404,
            "Not Found",
            ERP3_RELATIONSHIP_ERROR_CODES.ORDER_NOT_FOUND,
            "Sales order not found.",
          ),
        );
    }

    return reply.status(200).send(order);
  });

  // ── GET /api/v1/erp-orders/invoices ─────────────────────────────────────────
  app.get("/api/v1/erp-orders/invoices", async (request, reply) => {
    const queryResult = InvoiceListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      const firstIssue = queryResult.error.issues[0];
      return reply.status(400).send(
        buildErrorReply(
          400,
          "Bad Request",
          "VALIDATION_ERROR",
          firstIssue?.message ?? "Invalid query parameter",
          queryResult.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        ),
      );
    }

    const {
      page,
      pageSize,
      status,
      customer_golden_id,
      order_id,
      currency,
      from_date,
      to_date,
      search,
    } = queryResult.data;

    let invoices = Array.from(store.invoices.values());
    if (status) invoices = invoices.filter((i) => i.status === status);
    if (customer_golden_id)
      invoices = invoices.filter(
        (i) => i.customer_golden_id === customer_golden_id,
      );
    if (order_id) invoices = invoices.filter((i) => i.order_id === order_id);
    if (currency) invoices = invoices.filter((i) => i.currency === currency);
    if (from_date)
      invoices = invoices.filter((i) => i.invoice_date >= from_date);
    if (to_date) invoices = invoices.filter((i) => i.invoice_date <= to_date);
    if (search) {
      const q = search.toLowerCase();
      invoices = invoices.filter((i) =>
        i.invoice_number.toLowerCase().includes(q),
      );
    }

    // Sort by invoice_date desc, then id asc
    invoices.sort((a, b) => {
      const dateCmp = b.invoice_date.localeCompare(a.invoice_date);
      return dateCmp !== 0 ? dateCmp : a.id.localeCompare(b.id);
    });

    const total = invoices.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (page - 1) * pageSize;
    const data = invoices.slice(start, start + pageSize);

    return reply.status(200).send(
      InvoiceListResponseSchema.parse({
        data,
        total,
        page,
        pageSize,
        totalPages,
      }),
    );
  });

  // ── POST /api/v1/erp-orders/invoices ────────────────────────────────────────
  app.post("/api/v1/erp-orders/invoices", async (request, reply) => {
    const bodyResult = CreateInvoiceRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      const firstIssue = bodyResult.error.issues[0];
      return reply
        .status(400)
        .send(
          buildErrorReply(
            400,
            "Bad Request",
            "VALIDATION_ERROR",
            firstIssue?.message ?? "Validation error",
            bodyResult.error.issues.map((i) => ({
              field: i.path.join("."),
              message: i.message,
              code: i.code,
            })),
          ),
        );
    }

    const body = bodyResult.data;

    // Duplicate invoice_number check
    if (body.invoice_number) {
      const exists = Array.from(store.invoices.values()).some(
        (i) => i.invoice_number === body.invoice_number,
      );
      if (exists) {
        return reply
          .status(409)
          .send(
            buildErrorReply(
              409,
              "Conflict",
              ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_NUMBER_EXISTS,
              `An invoice with invoice_number '${body.invoice_number}' already exists.`,
            ),
          );
      }
    }

    // order_id cross-reference check
    if (body.order_id) {
      if (!store.salesOrders.has(body.order_id)) {
        return reply
          .status(422)
          .send(
            buildErrorReply(
              422,
              "Unprocessable Entity",
              ERP3_RELATIONSHIP_ERROR_CODES.ORDER_REF_NOT_FOUND,
              `Referenced sales order '${body.order_id}' does not exist.`,
            ),
          );
      }
    }

    // Auto-generate invoice_number if omitted
    store.invoiceCounter += 1;
    const invoice_number =
      body.invoice_number ??
      `INV-2026-${String(store.invoiceCounter).padStart(4, "0")}`;

    const computed = tryComputeLines(body.lines);
    if (!computed) return reply.status(422).send(dr1Reply());
    const now = new Date().toISOString();
    const invoiceId = randomUUID();

    // Compute lines (exact; no rounding — DR-1)
    const computedLines: InvoiceLine[] = computed.map((l) => ({
      id: randomUUID(),
      invoice_id: invoiceId,
      product_id: l.product_id,
      quantity: l.quantity,
      price: l.price,
      tax_rate: l.tax_rate,
      tax_amount: l.tax_amount,
      line_total: l.line_total,
      created_at: now,
    }));

    const total = fromScaled(sumScaled(computedLines.map((l) => l.line_total)));

    const invoice: Invoice = {
      id: invoiceId,
      invoice_number,
      order_id: body.order_id ?? null,
      customer_golden_id: body.customer_golden_id,
      invoice_date: body.invoice_date,
      due_date: body.due_date,
      status: "Open",
      currency: body.currency,
      total,
      lines: computedLines,
      source_system: body.source_system ?? null,
      source_id: body.source_id ?? null,
      created_at: now,
      updated_at: now,
    };

    store.invoices.set(invoiceId, invoice);

    // Emit domain event
    store.emittedEvents.push(
      createErp3Event({
        event_type: ERP3_EVENT_TYPES.INVOICE_CREATED,
        correlation_id: CORRELATION_ID,
        entity_type: "invoice",
        entity_id: invoiceId,
        payload: {
          id: invoiceId,
          invoice_number,
          order_id: body.order_id ?? null,
          customer_golden_id: body.customer_golden_id,
          invoice_date: body.invoice_date,
          due_date: body.due_date,
          status: "Open" as const,
          currency: body.currency,
          total,
          line_count: computedLines.length,
        },
      }),
    );

    return reply.status(201).send(invoice);
  });

  // ── GET /api/v1/erp-orders/invoices/:id ─────────────────────────────────────
  // ⚠️ Implied — not in SDS §4.8 table. Flagged for Integration Lead confirmation.
  app.get("/api/v1/erp-orders/invoices/:id", async (request, reply) => {
    const params = Erp3IdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply
        .status(400)
        .send(
          buildErrorReply(
            400,
            "Bad Request",
            "VALIDATION_ERROR",
            "Invalid UUID format",
          ),
        );
    }

    const invoice = store.invoices.get(params.data.id);
    if (!invoice) {
      return reply
        .status(404)
        .send(
          buildErrorReply(
            404,
            "Not Found",
            ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_NOT_FOUND,
            "Invoice not found.",
          ),
        );
    }

    return reply.status(200).send(invoice);
  });

  // ── POST /api/v1/erp-orders/payments ────────────────────────────────────────
  app.post("/api/v1/erp-orders/payments", async (request, reply) => {
    const bodyResult = CreatePaymentRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      const firstIssue = bodyResult.error.issues[0];
      return reply
        .status(400)
        .send(
          buildErrorReply(
            400,
            "Bad Request",
            "VALIDATION_ERROR",
            firstIssue?.message ?? "Validation error",
            bodyResult.error.issues.map((i) => ({
              field: i.path.join("."),
              message: i.message,
              code: i.code,
            })),
          ),
        );
    }

    const body = bodyResult.data;

    // Invoice existence check
    const invoice = store.invoices.get(body.invoice_id);
    if (!invoice) {
      return reply
        .status(404)
        .send(
          buildErrorReply(
            404,
            "Not Found",
            ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_NOT_FOUND,
            `Invoice '${body.invoice_id}' not found.`,
          ),
        );
    }

    // FR-ERP3-04: reject payment on already-Paid invoice
    if (invoice.status === "Paid") {
      return reply
        .status(422)
        .send(
          buildErrorReply(
            422,
            "Unprocessable Entity",
            ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_ALREADY_PAID,
            "Invoice is already paid. No further payments are accepted.",
          ),
        );
    }

    // Sum existing payments for this invoice (exact)
    const existingPaid = sumScaled(
      Array.from(store.payments.values())
        .filter((p) => p.invoice_id === body.invoice_id)
        .map((p) => p.amount),
    );

    // Check overflow (exact integer comparison)
    const newPaidScaled = existingPaid + toScaled(body.amount);
    const invoiceTotalScaled = toScaled(invoice.total);
    const newTotal = fromScaled(newPaidScaled);
    if (newPaidScaled > invoiceTotalScaled) {
      return reply
        .status(422)
        .send(
          buildErrorReply(
            422,
            "Unprocessable Entity",
            ERP3_RELATIONSHIP_ERROR_CODES.PAYMENT_EXCEEDS_INVOICE_TOTAL,
            "Payment amount would exceed the invoice total.",
          ),
        );
    }

    const now = new Date().toISOString();
    const paymentId = randomUUID();
    store.paymentCounter += 1;

    const payment: Payment = {
      id: paymentId,
      invoice_id: body.invoice_id,
      amount: body.amount,
      paid_at: body.paid_at ?? now,
      method: body.method,
      created_at: now,
    };
    store.payments.set(paymentId, payment);

    // FR-ERP3-04: Auto-transition invoice to Paid when sum of payments >= total
    let newInvoiceStatus: InvoiceStatus = invoice.status;
    if (newPaidScaled >= invoiceTotalScaled) {
      newInvoiceStatus = "Paid";
    }

    // Update invoice in store
    const updatedInvoice: Invoice = {
      ...invoice,
      status: newInvoiceStatus,
      updated_at: now,
    };
    store.invoices.set(body.invoice_id, updatedInvoice);

    // Emit payment event
    store.emittedEvents.push(
      createErp3Event({
        event_type: ERP3_EVENT_TYPES.PAYMENT_CREATED,
        correlation_id: CORRELATION_ID,
        entity_type: "payment",
        entity_id: paymentId,
        payload: {
          id: paymentId,
          invoice_id: body.invoice_id,
          amount: body.amount,
          paid_at: payment.paid_at,
          method: body.method,
          invoice_status_after: newInvoiceStatus,
        },
      }),
    );

    // Emit invoice status changed event if invoice became Paid
    if (newInvoiceStatus !== invoice.status) {
      store.emittedEvents.push(
        createErp3Event({
          event_type: ERP3_EVENT_TYPES.INVOICE_STATUS_CHANGED,
          correlation_id: CORRELATION_ID,
          entity_type: "invoice",
          entity_id: body.invoice_id,
          payload: {
            id: body.invoice_id,
            invoice_number: invoice.invoice_number,
            previous_status: invoice.status,
            new_status: newInvoiceStatus,
            changed_at: now,
            total_paid: newTotal,
            currency: invoice.currency,
          },
        }),
      );
    }

    return reply.status(201).send(payment);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Mock Server Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp3MockServerInstance {
  app: FastifyInstance;
  store: Erp3MockStore;
  /** Resets store to deterministic seed state. Call between tests to prevent state bleed. */
  reset: () => void;
  /** Gracefully stops the Fastify server. */
  stop: () => Promise<void>;
}

/**
 * Creates and returns a ready-to-inject ERP-3 mock server.
 *
 * Usage in tests:
 * ```ts
 * const mock = createErp3MockServer();
 * const res = await mock.app.inject({ method: 'GET', url: '/api/v1/erp-orders/sales-orders' });
 * mock.reset(); // between test cases
 * await mock.stop(); // in afterAll
 * ```
 *
 * Exposes ERP3_MOCK_DEFAULT_PORT (4013) for callers that choose to listen.
 */
export function createErp3MockServer(): Erp3MockServerInstance {
  const store = buildSeedStore();

  const app = fastify({ logger: false });

  registerRoutes(app, store);

  // 404 fallback for unregistered routes
  app.setNotFoundHandler((_request, reply) => {
    reply
      .status(404)
      .send(
        buildErrorReply(
          404,
          "Not Found",
          "ROUTE_NOT_FOUND",
          "Route not found in ERP-3 mock.",
        ),
      );
  });

  // 500 error handler
  app.setErrorHandler((error, _request, reply) => {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    reply
      .status(500)
      .send(
        buildErrorReply(
          500,
          "Internal Server Error",
          "INTERNAL_SERVER_ERROR",
          message,
        ),
      );
  });

  function reset(): void {
    // Route handlers close over `store`, so reset must mutate it in place.
    const fresh = buildSeedStore();
    store.salesOrders = fresh.salesOrders;
    store.invoices = fresh.invoices;
    store.payments = fresh.payments;
    store.emittedEvents = fresh.emittedEvents;
    store.orderCounter = fresh.orderCounter;
    store.invoiceCounter = fresh.invoiceCounter;
    store.paymentCounter = fresh.paymentCounter;
  }

  async function stop(): Promise<void> {
    await app.close();
  }

  return { app, store, reset, stop };
}
