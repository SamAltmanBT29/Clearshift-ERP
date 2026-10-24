/**
 * ERP-3 Sales Orders & Invoices — Domain Mutation Service
 *
 * Implements business invariants and transactional orchestration for Issue #28 (ERP3-03):
 *   - FR-ERP3-01 / BR-ERP3-01 / BR-ERP3-02 / BR-ERP3-03: Sales order creation with mandatory
 *     customer Golden ID (UUID), product reference verification via ERP-1 ReferenceResolver,
 *     unique order_number (409), and server-computed 4-dp line taxes and totals.
 *   - FR-ERP3-05: Forward-only sales order status transitions (`ALLOWED_ORDER_STATUS_TRANSITIONS`).
 *   - FR-ERP3-02: Invoice creation with unique invoice_number (409), mandatory due_date (>= invoice_date),
 *     at-most-one V1 invoice per sales order (409 ORDER_ALREADY_INVOICED), order_id existence check
 *     (422 ORDER_REF_NOT_FOUND), customer match check, and derived status (`Open` / `Overdue` / `Paid`).
 *   - FR-ERP3-03 / FR-ERP3-04: Single full-payment settlement per invoice (`amount == invoice.total`);
 *     rejects partial payments, overpayments, and payments on already-Paid invoices with 422;
 *     transitions invoice status to `Paid` atomically in the same transaction.
 *   - KIT-08 / Decision C4: Atomic import dual-write (`batch_id`, `source_row`, `idempotency_key`)
 *     persisting target mutation and durable import receipt in a single transaction, returning the
 *     prior result on identical replay and 409 Conflict on payload mismatch.
 *
 * Scope note: Paginated list/search endpoints (`GET /sales-orders`, `GET /invoices`) belong to
 * Issue #27 (`ERP3-02`) and are not duplicated here.
 *
 * @module erp3/services/erp3.service
 */

import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AppError, type ReferenceResolver } from "@cs/kernel";
import {
  CreateInvoiceRequestSchema,
  CreatePaymentRequestSchema,
  CreateSalesOrderRequestSchema,
  type CreateInvoiceRequest,
  type CreatePaymentRequest,
  type CreateSalesOrderRequest,
  type ImportRowRequest,
  type ImportRowResponse,
  type Invoice,
  type InvoiceLine,
  type InvoiceListQuery,
  type InvoiceListResponse,
  type Payment,
  type PaymentListQuery,
  type PaymentListResponse,
  type SalesOrder,
  type SalesOrderLine,
  type SalesOrderListQuery,
  type SalesOrderListResponse,
  type SalesOrderStatus,
  type Erp3CheckDuplicatesRequest,
  type Erp3CheckDuplicatesResponse,
  type Erp3DuplicateCandidateRecord,
  type Erp3ReviewDuplicateRequest,
  type Erp3ReviewDuplicateResponse,
} from "@clearshift/contracts";
import {
  ERP3_DOMAIN_ERROR_CODES,
  Erp3DomainError,
  assertValidFullPayment,
  assertValidInvoiceDates,
  calculateDocumentLinesAndTotal,
  formatScaledDecimal4Dp,
  parseScaledDecimal4Dp,
  resolveInvoiceStatus,
} from "../domain/rules.js";
import {
  classifySalesOrderCandidate,
  classifyInvoiceCandidate,
  classifyPaymentCandidate,
  assertNoFuzzyAutoMerge,
  assertValidHumanMergeDecision,
} from "../domain/duplicate-policy.js";
import {
  assertInvoiceReadConsistency,
  assertInvoiceStatusTransition,
  assertOrderInvoiceCurrencyConsistency,
  assertPaymentReadConsistency,
  assertSalesOrderReadConsistency,
  assertSalesOrderStatusTransition,
  assertSourceIdentityIsComplete,
  assertValidCurrencyCode,
  assertValidPaymentMethod,
  handleOptionalRelationship,
  validateCrossModuleReference,
} from "../domain/relationships.js";
import {
  computeRequestHash,
  type Erp3Repository,
} from "./repository.js";
import type { Erp3AuditService } from "./audit.js";

export interface Erp3ServiceOptions {
  repository: Erp3Repository;
  referenceResolver?: ReferenceResolver | undefined;
  auditService?: Erp3AuditService | undefined;
  /**
   * Optional clock override (`YYYY-MM-DD`) for deterministic overdue status evaluation in tests.
   */
  nowUtcDate?: (() => string) | undefined;
  /**
   * Optional flag to require strict DR-1 exact 4-dp arithmetic (`422 DR1_ROUNDING_UNRESOLVED`
   * on sub-4-dp remainders). Defaults to `false` (uses provisional `calculateLineAmounts` helper).
   */
  strictDr1Exact4Dp?: boolean | undefined;
  /**
   * Optional flag controlling whether `Open -> Closed` direct transition is allowed
   * per `ALLOWED_ORDER_STATUS_TRANSITIONS`. Defaults to `true`.
   */
  allowDirectOpenToClosed?: boolean | undefined;
}

export class DomainError extends AppError {
  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(code, message, 422, [
      {
        code,
        message,
        ...(typeof details["field"] === "string"
          ? { field: details["field"] }
          : {}),
        ...details,
      },
    ]);
    this.name = "DomainError";
  }
}

export class ConflictError extends AppError {
  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(code, message, 409, [
      {
        code,
        message,
        ...(typeof details["field"] === "string"
          ? { field: details["field"] }
          : {}),
        ...details,
      },
    ]);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends AppError {
  constructor(code: string, message: string, id?: string) {
    super(code, message, 404, [
      {
        code,
        message,
        ...(id ? { id } : {}),
      },
    ]);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super("FORBIDDEN", message, 403, [
      {
        code: "FORBIDDEN",
        message,
      },
    ]);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super("VALIDATION_ERROR", message, 400, [
      {
        code: "VALIDATION_ERROR",
        message,
        ...(field ? { field } : {}),
      },
    ]);
    this.name = "ValidationError";
  }
}

/**
 * Strips any idempotency metadata fields from a create payload before computing
 * the canonical request hash so header vs. body idempotency keys hash identically.
 */
function stripImportMetadata(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === "idempotency_key" || k === "batch_id" || k === "source_row") {
      continue;
    }
    copy[k] = v;
  }
  return copy;
}

export class Erp3Service {
  private readonly repo: Erp3Repository;
  private readonly resolver?: ReferenceResolver | undefined;
  private readonly auditService?: Erp3AuditService | undefined;
  private readonly nowUtcDate: () => string;
  private readonly strictDr1Exact4Dp: boolean;
  private readonly allowDirectOpenToClosed: boolean;

  constructor(options: Erp3ServiceOptions) {
    this.repo = options.repository;
    this.resolver = options.referenceResolver;
    this.auditService = options.auditService;
    this.nowUtcDate =
      options.nowUtcDate ?? (() => new Date().toISOString().slice(0, 10));
    this.strictDr1Exact4Dp = options.strictDr1Exact4Dp ?? false;
    this.allowDirectOpenToClosed = options.allowDirectOpenToClosed ?? true;
  }


  private async verifyCustomerGoldenId(customerGoldenId: string): Promise<void> {
    try {
      await validateCrossModuleReference(
        this.resolver,
        "customer",
        customerGoldenId,
        true,
        "customer_golden_id",
        ERP3_DOMAIN_ERROR_CODES.CUSTOMER_NOT_FOUND,
      );
    } catch (err) {
      if (err instanceof Erp3DomainError) {
        throw new DomainError(err.code, err.message, {
          ...(err.field ? { field: err.field } : {}),
          ...err.context,
        });
      }
      throw err;
    }
  }

  private async verifyProductReferences(
    lines: ReadonlyArray<{ product_id: string }>,
  ): Promise<void> {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      try {
        await validateCrossModuleReference(
          this.resolver,
          "product",
          line.product_id,
          true,
          `lines.${i}.product_id`,
          ERP3_DOMAIN_ERROR_CODES.PRODUCT_NOT_FOUND,
        );
      } catch (err) {
        if (err instanceof Erp3DomainError) {
          throw new DomainError(err.code, err.message, {
            ...(err.field ? { field: err.field } : {}),
            ...err.context,
          });
        }
        throw err;
      }
    }
  }

  // ── Sales Orders ───────────────────────────────────────────────────────────

  async listSalesOrders(query: SalesOrderListQuery): Promise<SalesOrderListResponse> {
    return this.repo.listSalesOrders(query);
  }

  async getSalesOrderById(id: string): Promise<SalesOrder> {
    const order = await this.repo.getSalesOrderById(id);
    if (!order) {
      throw new NotFoundError(
        ERP3_DOMAIN_ERROR_CODES.ORDER_NOT_FOUND,
        `Sales order '${id}' not found.`,
        id,
      );
    }
    assertSalesOrderReadConsistency(order);
    return order;
  }

  async createSalesOrder(data: CreateSalesOrderRequest): Promise<SalesOrder> {
    return this.repo.executeTransactional((txRepo) =>
      this.createSalesOrderInTx(txRepo, data),
    );
  }

  private async createSalesOrderInTx(
    txRepo: Erp3Repository,
    data: CreateSalesOrderRequest,
  ): Promise<SalesOrder> {
    // 1. BR-ERP3-03: Verify customer Golden ID format & existence
    await this.verifyCustomerGoldenId(data.customer_golden_id);

    // 2. Verify currency & source provenance completeness (ERP3-06)
    const currency = data.currency ?? "USD";
    assertValidCurrencyCode(currency);
    assertSourceIdentityIsComplete(data.source_system, data.source_id);

    // 3. Verify all line product references via ERP-1 resolver
    await this.verifyProductReferences(data.lines);

    // 4. Check duplicate order_number
    if (data.order_number) {
      const existing = await txRepo.getSalesOrderByNumber(data.order_number);
      if (existing) {
        throw new ConflictError(
          ERP3_DOMAIN_ERROR_CODES.ORDER_NUMBER_EXISTS,
          `A sales order with order_number '${data.order_number}' already exists.`,
          { field: "order_number", order_number: data.order_number },
        );
      }
    }

    // 5. BR-ERP3-01 & BR-ERP3-02: Compute line taxes and totals server-side
    const calculated = calculateDocumentLinesAndTotal(data.lines, {
      strictDr1Exact4Dp: this.strictDr1Exact4Dp,
    });

    const orderId = randomUUID();
    const now = new Date().toISOString();
    const orderNumber = data.order_number ?? (await txRepo.nextOrderNumber());

    const orderLines: SalesOrderLine[] = calculated.lines.map((line) => ({
      id: randomUUID(),
      order_id: orderId,
      product_id: line.product_id,
      quantity: line.quantity,
      price: line.price,
      tax_rate: line.tax_rate,
      tax_amount: line.tax_amount,
      line_total: line.line_total,
      created_at: now,
    }));

    const createdOrder = await txRepo.createSalesOrder({
      id: orderId,
      order_number: orderNumber,
      customer_golden_id: data.customer_golden_id,
      order_date: data.order_date,
      status: "Open",
      currency,
      total: calculated.total,
      lines: orderLines,
      source_system: data.source_system ?? null,
      source_id: data.source_id ?? null,
      created_at: now,
      updated_at: now,
    });

    assertSalesOrderReadConsistency(createdOrder);
    return createdOrder;
  }

  async updateSalesOrderStatus(
    id: string,
    targetStatus: SalesOrderStatus,
  ): Promise<SalesOrder> {
    return this.repo.executeTransactional(async (txRepo) => {
      const existing = await txRepo.getSalesOrderById(id);
      if (!existing) {
        throw new NotFoundError(
          ERP3_DOMAIN_ERROR_CODES.ORDER_NOT_FOUND,
          `Sales order '${id}' not found.`,
          id,
        );
      }

      assertSalesOrderStatusTransition(existing.status, targetStatus, {
        allowDirectOpenToClosed: this.allowDirectOpenToClosed,
      });

      const updated = await txRepo.updateSalesOrderStatus(id, targetStatus);
      assertSalesOrderReadConsistency(updated);
      return updated;
    });
  }

  // ── Invoices ───────────────────────────────────────────────────────────────

  async listInvoices(query: InvoiceListQuery): Promise<InvoiceListResponse> {
    const res = await this.repo.listInvoices(query);
    // dynamically ensure overdue status is accurately evaluated against today's date
    const today = this.nowUtcDate();
    const data = await Promise.all(
      res.data.map(async (inv: Invoice) => {
        if (inv.status === "Paid") return inv;
        const payments = await this.repo.listPaymentsByInvoiceId(inv.id);
        const paidScaled = payments.reduce(
          (sum, p) => sum + parseScaledDecimal4Dp(p.amount),
          0n,
        );
        const resolved = resolveInvoiceStatus(
          inv.total,
          formatScaledDecimal4Dp(paidScaled),
          inv.due_date,
          today,
        );
        return { ...inv, status: resolved };
      }),
    );
    return { ...res, data };
  }

  async getInvoiceById(id: string): Promise<Invoice> {
    const invoice = await this.repo.getInvoiceById(id);
    if (!invoice) {
      throw new NotFoundError(
        ERP3_DOMAIN_ERROR_CODES.INVOICE_NOT_FOUND,
        `Invoice '${id}' not found.`,
        id,
      );
    }

    // Re-evaluate dynamic Overdue/Open/Paid status using stored payments and current UTC date
    const payments = await this.repo.listPaymentsByInvoiceId(id);
    const paidScaled = payments.reduce(
      (sum, p) => sum + parseScaledDecimal4Dp(p.amount),
      0n,
    );
    const nowDate = this.nowUtcDate();
    const derivedStatus = resolveInvoiceStatus(
      invoice.total,
      formatScaledDecimal4Dp(paidScaled),
      invoice.due_date,
      nowDate,
    );

    const projectedInvoice =
      derivedStatus !== invoice.status
        ? {
            ...invoice,
            status: derivedStatus,
          }
        : invoice;

    assertInvoiceReadConsistency(projectedInvoice, payments, nowDate);
    return projectedInvoice;
  }

  async createInvoice(data: CreateInvoiceRequest): Promise<Invoice> {
    return this.repo.executeTransactional((txRepo) =>
      this.createInvoiceInTx(txRepo, data),
    );
  }

  private async createInvoiceInTx(
    txRepo: Erp3Repository,
    data: CreateInvoiceRequest,
  ): Promise<Invoice> {
    // 1. BR-ERP3-03: Verify customer Golden ID
    await this.verifyCustomerGoldenId(data.customer_golden_id);

    // 2. Verify currency & source provenance completeness (ERP3-06)
    const currency = data.currency ?? "USD";
    assertValidCurrencyCode(currency);
    assertSourceIdentityIsComplete(data.source_system, data.source_id);

    // 3. FR-ERP3-02: Validate mandatory due_date >= invoice_date
    assertValidInvoiceDates(data.invoice_date, data.due_date);

    // 4. Verify all line product references via ERP-1 resolver
    await this.verifyProductReferences(data.lines);

    // 5. Unique invoice_number check
    if (data.invoice_number) {
      const existingByNumber = await txRepo.getInvoiceByNumber(
        data.invoice_number,
      );
      if (existingByNumber) {
        throw new ConflictError(
          ERP3_DOMAIN_ERROR_CODES.INVOICE_NUMBER_EXISTS,
          `An invoice with invoice_number '${data.invoice_number}' already exists.`,
          { field: "invoice_number", invoice_number: data.invoice_number },
        );
      }
    }

    // 6. Optional sales order reference & 1:1 V1 invoice constraint
    const optionalOrderRef = handleOptionalRelationship(
      data.order_id,
      "order_id",
      "INVOICE_ORDER",
    );

    if (optionalOrderRef.value) {
      const linkedOrder = await txRepo.getSalesOrderById(
        optionalOrderRef.value,
      );
      if (!linkedOrder) {
        throw new DomainError(
          ERP3_DOMAIN_ERROR_CODES.ORDER_REF_NOT_FOUND,
          `Referenced sales order '${optionalOrderRef.value}' does not exist.`,
          { field: "order_id", order_id: optionalOrderRef.value },
        );
      }

      if (linkedOrder.customer_golden_id !== data.customer_golden_id) {
        throw new DomainError(
          ERP3_DOMAIN_ERROR_CODES.CUSTOMER_MISMATCH,
          `Invoice customer_golden_id '${data.customer_golden_id}' does not match sales order customer_golden_id '${linkedOrder.customer_golden_id}'.`,
          {
            field: "customer_golden_id",
            invoice_customer_golden_id: data.customer_golden_id,
            order_customer_golden_id: linkedOrder.customer_golden_id,
          },
        );
      }

      assertOrderInvoiceCurrencyConsistency(linkedOrder.currency, currency);

      const existingOrderInvoice = await txRepo.getInvoiceByOrderId(
        optionalOrderRef.value,
      );
      if (existingOrderInvoice) {
        throw new ConflictError(
          ERP3_DOMAIN_ERROR_CODES.ORDER_ALREADY_INVOICED,
          `Sales order '${optionalOrderRef.value}' already has a V1 invoice ('${existingOrderInvoice.invoice_number}'). Split invoicing is out of scope.`,
          {
            field: "order_id",
            order_id: optionalOrderRef.value,
            existing_invoice_id: existingOrderInvoice.id,
          },
        );
      }

      // Transition Open order to Invoiced when its V1 invoice is created
      if (linkedOrder.status === "Open") {
        assertSalesOrderStatusTransition(linkedOrder.status, "Invoiced");
        await txRepo.updateSalesOrderStatus(linkedOrder.id, "Invoiced");
      }
    }

    // 7. Compute line taxes and invoice total server-side
    const calculated = calculateDocumentLinesAndTotal(data.lines, {
      strictDr1Exact4Dp: this.strictDr1Exact4Dp,
    });

    const invoiceId = randomUUID();
    const now = new Date().toISOString();
    const invoiceNumber =
      data.invoice_number ?? (await txRepo.nextInvoiceNumber());

    const invoiceLines: InvoiceLine[] = calculated.lines.map((line) => ({
      id: randomUUID(),
      invoice_id: invoiceId,
      product_id: line.product_id,
      quantity: line.quantity,
      price: line.price,
      tax_rate: line.tax_rate,
      tax_amount: line.tax_amount,
      line_total: line.line_total,
      created_at: now,
    }));

    const nowDate = this.nowUtcDate();
    const initialStatus = resolveInvoiceStatus(
      calculated.total,
      "0.0000",
      data.due_date,
      nowDate,
    );

    const createdInvoice = await txRepo.createInvoice({
      id: invoiceId,
      invoice_number: invoiceNumber,
      order_id: optionalOrderRef.value,
      customer_golden_id: data.customer_golden_id,
      invoice_date: data.invoice_date,
      due_date: data.due_date,
      status: initialStatus,
      currency,
      total: calculated.total,
      lines: invoiceLines,
      source_system: data.source_system ?? null,
      source_id: data.source_id ?? null,
      created_at: now,
      updated_at: now,
    });

    assertInvoiceReadConsistency(createdInvoice, [], nowDate);
    return createdInvoice;
  }

  // ── Payments ───────────────────────────────────────────────────────────────

  async listPayments(query: PaymentListQuery): Promise<PaymentListResponse> {
    return this.repo.listPayments(query);
  }

  async createPayment(data: CreatePaymentRequest): Promise<Payment> {
    return this.repo.executeTransactional((txRepo) =>
      this.createPaymentInTx(txRepo, data),
    );
  }

  private async createPaymentInTx(
    txRepo: Erp3Repository,
    data: CreatePaymentRequest,
  ): Promise<Payment> {
    assertValidPaymentMethod(data.method);

    const invoice = await txRepo.getInvoiceById(data.invoice_id);
    if (!invoice) {
      throw new NotFoundError(
        ERP3_DOMAIN_ERROR_CODES.INVOICE_NOT_FOUND,
        `Invoice '${data.invoice_id}' not found.`,
        data.invoice_id,
      );
    }

    const existingPayments = await txRepo.listPaymentsByInvoiceId(
      data.invoice_id,
    );
    const existingPaidScaled = existingPayments.reduce(
      (sum, p) => sum + parseScaledDecimal4Dp(p.amount),
      0n,
    );
    const existingPaidTotal = formatScaledDecimal4Dp(existingPaidScaled);

    const { nextInvoiceStatus } = assertValidFullPayment({
      invoiceStatus: invoice.status,
      invoiceTotal: invoice.total,
      existingPaidTotal,
      paymentAmount: data.amount,
    });

    assertInvoiceStatusTransition(invoice.status, nextInvoiceStatus);

    const now = new Date().toISOString();
    const paymentId = randomUUID();
    const normalizedAmount = formatScaledDecimal4Dp(
      parseScaledDecimal4Dp(data.amount),
    );

    const payment = await txRepo.createPayment({
      id: paymentId,
      invoice_id: data.invoice_id,
      amount: normalizedAmount,
      paid_at: data.paid_at ?? now,
      method: data.method,
      created_at: now,
    });

    // FR-ERP3-04: Automatically transition invoice status to Paid in the same transaction
    const updatedInvoice = await txRepo.updateInvoiceStatus(
      data.invoice_id,
      nextInvoiceStatus,
    );

    assertPaymentReadConsistency(payment, updatedInvoice);
    assertInvoiceReadConsistency(
      updatedInvoice,
      [...existingPayments, payment],
      this.nowUtcDate(),
    );

    return payment;
  }

  // ── Atomic Import Dual-Write (KIT-08 / Decision C4) ────────────────────────

  /**
   * Executes an import write (`sales_order`, `invoice`, or `payment`) atomically
   * alongside a durable import receipt in a single transaction.
   *
   * - Same `idempotency_key` + identical canonical payload -> returns prior receipt (`prior_result: true`).
   * - Same `idempotency_key` + different payload -> throws `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.
   */
  async importRow(req: ImportRowRequest): Promise<ImportRowResponse> {
    const canonicalRecord = stripImportMetadata(req.record);
    const requestHash = computeRequestHash({
      entity: req.entity,
      record: canonicalRecord,
    });

    const priorReceipt = await this.repo.getImportReceiptByKey(
      req.idempotency_key,
    );
    if (priorReceipt) {
      if (priorReceipt.request_hash === requestHash) {
        return {
          target_id: priorReceipt.target_id,
          target_version: 1,
          outcome: priorReceipt.outcome,
          receipt: priorReceipt,
          prior_result: true,
        };
      }
      throw new ConflictError(
        "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
        `Idempotency key '${req.idempotency_key}' was already used with a different payload.`,
        { field: "idempotency_key", idempotency_key: req.idempotency_key },
      );
    }

    return this.repo.executeTransactional(async (txRepo) => {
      let targetId: string;
      let responsePayload: unknown;

      try {
        if (req.entity === "sales_order") {
          const validatedOrder =
            CreateSalesOrderRequestSchema.parse(canonicalRecord);
          const created = await this.createSalesOrderInTx(
            txRepo,
            validatedOrder,
          );
          targetId = created.id;
          responsePayload = created;
        } else if (req.entity === "invoice") {
          const validatedInvoice =
            CreateInvoiceRequestSchema.parse(canonicalRecord);
          const created = await this.createInvoiceInTx(
            txRepo,
            validatedInvoice,
          );
          targetId = created.id;
          responsePayload = created;
        } else if (req.entity === "payment") {
          const validatedPayment =
            CreatePaymentRequestSchema.parse(canonicalRecord);
          const created = await this.createPaymentInTx(
            txRepo,
            validatedPayment,
          );
          targetId = created.id;
          responsePayload = created;
        } else {
          throw new ValidationError(
            `Unsupported ERP-3 import entity type: '${req.entity}'`,
            "entity",
          );
        }
      } catch (err) {
        if (err instanceof Erp3DomainError) {
          throw new DomainError(err.code, err.message, {
            ...(err.field ? { field: err.field } : {}),
            ...err.context,
          });
        }
        if (err instanceof ZodError) {
          const first = err.issues[0];
          throw new ValidationError(
            first?.message ?? "Invalid import row data",
            first?.path.join("."),
          );
        }
        throw err;
      }

      const receipt = await txRepo.createImportReceipt({
        batch_id: req.batch_id,
        source_row: req.source_row,
        source_system: req.source_system ?? null,
        source_id: req.source_id ?? null,
        entity: req.entity,
        schema_version: 1,
        idempotency_key: req.idempotency_key,
        request_hash: requestHash,
        target_id: targetId,
        kind: "created",
        outcome: "loaded",
        response_payload: responsePayload,
      });

      return {
        target_id: targetId,
        target_version: 1,
        outcome: "loaded",
        receipt,
        prior_result: false,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Exact Duplicate Key Policy & Human Review (ERP3-12 / KIT-10 / Issue #148)
  // ─────────────────────────────────────────────────────────────────────────────

  public duplicateCandidates = new Map<string, Erp3DuplicateCandidateRecord>();

  seedDuplicateCandidate(candidate: Erp3DuplicateCandidateRecord): void {
    this.duplicateCandidates.set(candidate.candidate_id, candidate);
  }

  async getDuplicateCandidates(
    entity?: "sales_order" | "invoice" | "payment",
  ): Promise<Erp3DuplicateCandidateRecord[]> {
    const all = Array.from(this.duplicateCandidates.values());
    if (!entity) return all;
    return all.filter((c) => c.entity === entity);
  }

  async getDuplicateCandidateById(
    candidateId: string,
  ): Promise<Erp3DuplicateCandidateRecord | null> {
    return this.duplicateCandidates.get(candidateId) ?? null;
  }

  async checkDuplicates(
    request: Erp3CheckDuplicatesRequest,
  ): Promise<Erp3CheckDuplicatesResponse> {
    assertNoFuzzyAutoMerge({ isAutoMerge: false, confidence: 1.0 });

    const foundCandidates: Erp3DuplicateCandidateRecord[] = [];

    if (request.entity === "sales_order") {
      const res = await this.listSalesOrders({
        page: 1,
        pageSize: 100,
      });
      const existingOrders = res.data ?? [];
      for (const record of request.records) {
        const result = classifySalesOrderCandidate(record, existingOrders);
        if (result.candidate) {
          this.duplicateCandidates.set(
            result.candidate.candidate_id,
            result.candidate,
          );
          foundCandidates.push(result.candidate);
        }
      }
    } else if (request.entity === "invoice") {
      const res = await this.listInvoices({
        page: 1,
        pageSize: 100,
      });
      const existingInvoices = res.data ?? [];
      for (const record of request.records) {
        const result = classifyInvoiceCandidate(record, existingInvoices);
        if (result.candidate) {
          this.duplicateCandidates.set(
            result.candidate.candidate_id,
            result.candidate,
          );
          foundCandidates.push(result.candidate);
        }
      }
    } else if (request.entity === "payment") {
      const res = await this.listPayments({
        page: 1,
        pageSize: 100,
      });
      const existingPayments = res.data ?? [];
      for (const record of request.records) {
        const result = classifyPaymentCandidate(record, existingPayments);
        if (result.candidate) {
          this.duplicateCandidates.set(
            result.candidate.candidate_id,
            result.candidate,
          );
          foundCandidates.push(result.candidate);
        }
      }
    } else {

      throw new ValidationError(
        `Unsupported entity for duplicate check: '${request.entity}'`,
        "entity",
      );
    }

    return {
      entity: request.entity,
      total_checked: request.records.length,
      duplicates_found: foundCandidates.length,
      candidates: foundCandidates,
    };
  }

  async reviewDuplicateCandidate(
    request: Erp3ReviewDuplicateRequest,
    operator: {
      id: string;
      role?: string | undefined;
      correlationId?: string | undefined;
    },
  ): Promise<Erp3ReviewDuplicateResponse> {
    const allowedRoles = ["admin", "migration_runner", "editor", "system"];
    if (operator.role && !allowedRoles.includes(operator.role)) {
      throw new ForbiddenError(
        `Role '${operator.role}' is not authorized to decide duplicate merges. Required: admin, migration_runner, or editor.`,
      );
    }

    assertNoFuzzyAutoMerge({ isAutoMerge: false, confidence: 1.0 });
    assertValidHumanMergeDecision(request);

    const candidate = this.duplicateCandidates.get(request.candidate_id);
    if (!candidate) {
      throw new NotFoundError("Duplicate candidate", request.candidate_id);
    }

    const correlationId = operator.correlationId ?? randomUUID();
    const nowIso = new Date().toISOString();
    const auditRecordId = randomUUID();

    const newStatus =
      request.decision === "MERGE"
        ? "MERGED"
        : request.decision === "REJECT"
          ? "REJECTED"
          : "KEPT_BOTH";

    candidate.status = newStatus;
    candidate.decided_at = nowIso;
    candidate.decided_by = operator.id;
    candidate.decision = request.decision;
    candidate.rationale = request.rationale;

    await this.auditService.record({
      actor: operator.id,
      actorRole: operator.role ?? "editor",
      action: "merge.decided",
      targetEntity: `erp3_${candidate.entity}`,
      targetId: request.kept_id ?? candidate.candidate_id,
      correlationId,
      result: "success",
      metadata: {
        candidate_id: candidate.candidate_id,
        decision: request.decision,
        kept_id: request.kept_id,
        merged_id: request.merged_id,
        match_kind: candidate.match_kind,
        matching_key: candidate.matching_key,
        rationale: request.rationale,
      },
    });

    return {
      candidate_id: candidate.candidate_id,
      decision: request.decision,
      status: newStatus,
      kept_id: request.kept_id,
      merged_id: request.merged_id,
      actor_id: operator.id,
      timestamp: nowIso,
      audit_record_id: auditRecordId,
    };
  }
}

