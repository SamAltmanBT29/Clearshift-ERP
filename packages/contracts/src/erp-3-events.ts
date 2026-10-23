/**
 * ERP-3 Sales Orders & Invoices — Domain Event Contracts
 *
 * Strongly-typed domain event schemas conforming to ClearShift Transactional
 * Event Envelope Schema (PLT-04 / PLT-09).
 *
 * Implements:
 *   - Sales order lifecycle events (created, status_changed)
 *   - Invoice lifecycle events (created, status_changed)
 *   - Payment created event
 *   - Inbound: deal.won from CRM-2 (SDS EV-09: creates a sales order)
 *
 * Traceability:
 *   - SDS §4.10 EV-09 (deal.won consumed by ERP-3)
 *   - SDS §3.2: event naming <noun>.<past_verb>
 *   - V1_30 plan §8 ERP-3 overlay
 *   - ADR-002: standard event envelope fields
 *   - Issue #150 ([ERP3-14])
 *
 * @module contracts/erp-3-events
 */

import { z } from "zod";
import { CurrencyCode, MoneyAmount, UuidSchema } from "./erp-4.js";
import {
  SalesOrderStatusEnum,
  InvoiceStatusEnum,
  PaymentMethodEnum,
  Erp3IsoDateString,
} from "./erp-3.js";
import {
  createEventEnvelopeSchema,
  createEventEnvelope,
  type EventEnvelope,
} from "./events.js";

// ─────────────────────────────────────────────────────────────────────────────
// Event Type Constants
// ─────────────────────────────────────────────────────────────────────────────

export const ERP3_EVENT_TYPES = {
  // Produced by ERP-3
  SALES_ORDER_CREATED: "erp.sales_order.created",
  SALES_ORDER_STATUS_CHANGED: "erp.sales_order.status_changed",
  INVOICE_CREATED: "erp.invoice.created",
  INVOICE_STATUS_CHANGED: "erp.invoice.status_changed",
  PAYMENT_CREATED: "erp.payment.created",
  // Inbound: consumed by ERP-3 from CRM-2 (SDS §4.10 EV-09)
  INBOUND_DEAL_WON: "deal.won",
} as const;

export type Erp3EventType =
  (typeof ERP3_EVENT_TYPES)[keyof typeof ERP3_EVENT_TYPES];

// ─────────────────────────────────────────────────────────────────────────────
// Event Payload Schemas
// ─────────────────────────────────────────────────────────────────────────────

/** Payload for erp.sales_order.created */
export const SalesOrderCreatedPayloadSchema = z.object({
  id: UuidSchema,
  order_number: z.string().min(1).max(64),
  customer_golden_id: UuidSchema,
  order_date: Erp3IsoDateString,
  status: z.literal("Open"),
  currency: CurrencyCode,
  /** ⚠️ DR-1: Rounding rule not confirmed — stored as 4 dp string. */
  total: MoneyAmount,
  line_count: z.number().int().min(1),
});
export type SalesOrderCreatedPayload = z.infer<
  typeof SalesOrderCreatedPayloadSchema
>;

/** Payload for erp.sales_order.status_changed */
export const SalesOrderStatusChangedPayloadSchema = z.object({
  id: UuidSchema,
  order_number: z.string().min(1).max(64),
  previous_status: SalesOrderStatusEnum,
  new_status: SalesOrderStatusEnum,
  changed_at: z.string().datetime(),
  changed_by_user_id: UuidSchema.optional(),
});
export type SalesOrderStatusChangedPayload = z.infer<
  typeof SalesOrderStatusChangedPayloadSchema
>;

/** Payload for erp.invoice.created */
export const InvoiceCreatedPayloadSchema = z.object({
  id: UuidSchema,
  invoice_number: z.string().min(1).max(64),
  order_id: UuidSchema.nullable(),
  customer_golden_id: UuidSchema,
  invoice_date: Erp3IsoDateString,
  due_date: Erp3IsoDateString,
  status: z.literal("Open"),
  currency: CurrencyCode,
  /** ⚠️ DR-1: Rounding rule not confirmed — stored as 4 dp string. */
  total: MoneyAmount,
  line_count: z.number().int().min(1),
  /**
   * Account IDs for ERP-4 AR posting.
   * These are optional at event emission time; ERP-4 consumers provide them
   * via their own configuration.
   */
  receivable_account_id: UuidSchema.optional().nullable(),
  revenue_account_id: UuidSchema.optional().nullable(),
});
export type InvoiceCreatedPayload = z.infer<typeof InvoiceCreatedPayloadSchema>;

/** Payload for erp.invoice.status_changed */
export const InvoiceStatusChangedPayloadSchema = z.object({
  id: UuidSchema,
  invoice_number: z.string().min(1).max(64),
  previous_status: InvoiceStatusEnum,
  new_status: InvoiceStatusEnum,
  changed_at: z.string().datetime(),
  /** Total payments received at time of status change (for Paid transition). */
  total_paid: MoneyAmount.optional(),
  currency: CurrencyCode.optional(),
});
export type InvoiceStatusChangedPayload = z.infer<
  typeof InvoiceStatusChangedPayloadSchema
>;

/** Payload for erp.payment.created */
export const PaymentCreatedPayloadSchema = z.object({
  id: UuidSchema,
  invoice_id: UuidSchema,
  amount: MoneyAmount,
  paid_at: z.string().datetime(),
  method: PaymentMethodEnum,
  /** Invoice status after this payment (may have become Paid). */
  invoice_status_after: InvoiceStatusEnum,
});
export type PaymentCreatedPayload = z.infer<typeof PaymentCreatedPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Inbound Event Payload: deal.won consumed from CRM-2 (SDS §4.10 EV-09)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload for the inbound deal.won event produced by CRM-2.
 * SDS §4.10 EV-09: "deal.won (consumed) — A deal was won in the CRM — ERP-3 creates a sales order."
 * SDS §8 Interfaces: "ClearShift CRM → CRM-2 → ERP-3: deal.won event (creates a sales order) via the Hub."
 */
export const InboundDealWonPayloadSchema = z.object({
  deal_id: UuidSchema,
  deal_number: z.string().min(1).optional(),
  /** CRM-1 customer Golden ID UUID — becomes customer_golden_id on the new sales order. */
  customer_golden_id: UuidSchema,
  currency: CurrencyCode,
  /**
   * Line items from the won deal/quote.
   * Product IDs are ERP-1 product UUIDs resolved at time of deal closure.
   */
  lines: z.array(
    z.object({
      product_id: UuidSchema,
      quantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
      price: MoneyAmount,
      tax_rate: z
        .string()
        .regex(/^\d+(\.\d{1,4})?$/)
        .optional(),
    }),
  ),
  won_at: z.string().datetime(),
});
export type InboundDealWonPayload = z.infer<typeof InboundDealWonPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Event Envelope Schemas (PLT-04 / PLT-09)
// ─────────────────────────────────────────────────────────────────────────────

export const SalesOrderCreatedEventSchema = createEventEnvelopeSchema(
  SalesOrderCreatedPayloadSchema,
);
export const SalesOrderStatusChangedEventSchema = createEventEnvelopeSchema(
  SalesOrderStatusChangedPayloadSchema,
);
export const InvoiceCreatedEventSchema = createEventEnvelopeSchema(
  InvoiceCreatedPayloadSchema,
);
export const InvoiceStatusChangedEventSchema = createEventEnvelopeSchema(
  InvoiceStatusChangedPayloadSchema,
);
export const PaymentCreatedEventSchema = createEventEnvelopeSchema(
  PaymentCreatedPayloadSchema,
);

// Inbound envelope (consumed from CRM-2)
export const InboundDealWonEventSchema = createEventEnvelopeSchema(
  InboundDealWonPayloadSchema,
);

// ─────────────────────────────────────────────────────────────────────────────
// Event Helper Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Factory helper to construct an ERP-3 EventEnvelope.
 * Mirrors createErp4Event from erp-4-events.ts.
 *
 * Defaults:
 *   - event_id: crypto.randomUUID()
 *   - schema_version: '1.0.0'
 *   - occurred_at: new Date().toISOString()
 *   - producer: 'erp-3'
 */
export function createErp3Event<T>(params: {
  event_id?: string;
  event_type: Erp3EventType;
  schema_version?: string;
  occurred_at?: string;
  correlation_id: string;
  entity_type: "sales_order" | "invoice" | "payment" | "deal";
  entity_id: string;
  batch_id?: string;
  payload: T;
  metadata?: Record<string, unknown>;
}): EventEnvelope {
  const envelopeParams: Parameters<typeof createEventEnvelope>[0] = {
    event_id: params.event_id ?? crypto.randomUUID(),
    event_type: params.event_type,
    correlation_id: params.correlation_id,
    producer: "erp-3",
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    payload: params.payload,
  };
  if (params.schema_version !== undefined) {
    envelopeParams.schema_version = params.schema_version;
  }
  if (params.occurred_at !== undefined) {
    envelopeParams.occurred_at = params.occurred_at;
  }
  if (params.batch_id !== undefined) {
    envelopeParams.batch_id = params.batch_id;
  }
  if (params.metadata !== undefined) {
    envelopeParams.metadata = params.metadata;
  }
  return createEventEnvelope(envelopeParams);
}
