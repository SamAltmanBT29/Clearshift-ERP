/**
 * ERP-2 Vendors & Purchasing — Domain Event Contracts
 *
 * Strongly-typed domain event schemas conforming to ClearShift Transactional
 * Event Envelope Schema (PLT-04 / PLT-09).
 *
 * Implements:
 *   - Vendor lifecycle events (created, updated)
 *   - Purchase order lifecycle events (created, status_changed)
 *   - Purchase order received event (triggers ERP-1 stock increase)
 *   - Inbound cross-module event payload definitions:
 *       - erp.vendor_bill.posted (to ERP-4: creates vendor bill journal entry)
 *
 * Traceability:
 *   - SDS ClearShift ERP v2.0 §4.3 (FR-ERP2-01..06, BR-ERP2-01)
 *   - SDS §3.2: event naming <noun>.<past_verb>
 *   - ADR-002: standard event envelope fields
 *   - Issue #130 ([ERP2-14])
 *
 * @module contracts/erp-2-events
 */

import { z } from 'zod';
import { CurrencyCode, UuidSchema } from './erp-4.js';
import { PurchaseOrderStatusEnum, MoneyAmount2Dp, IsoDateString } from './erp-2.js';
import {
  createEventEnvelopeSchema,
  createEventEnvelope,
  type EventEnvelope,
} from './events.js';

// ─────────────────────────────────────────────────────────────────────────────
// Event Type Constants
// ─────────────────────────────────────────────────────────────────────────────

export const ERP2_EVENT_TYPES = {
  // Produced by ERP-2
  VENDOR_CREATED: 'erp.vendor.created',
  VENDOR_UPDATED: 'erp.vendor.updated',
  PURCHASE_ORDER_CREATED: 'erp.purchase_order.created',
  PURCHASE_ORDER_STATUS_CHANGED: 'erp.purchase_order.status_changed',
  PURCHASE_ORDER_RECEIVED: 'erp.purchase_order.received',
  // Inbound cross-module event types consumed or projected by ERP-2
  INBOUND_VENDOR_BILL_POSTED: 'erp.vendor_bill.posted',
} as const;

export type Erp2EventType = (typeof ERP2_EVENT_TYPES)[keyof typeof ERP2_EVENT_TYPES];

// ─────────────────────────────────────────────────────────────────────────────
// Event Payload Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload for erp.vendor.created
 * Emitted whenever a new vendor is added to the master catalog.
 * bank_masked is always in XXXX-XXXX-7890 format; raw bank details are never published.
 */
export const VendorCreatedPayloadSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(255),
  tax_number: z.string().min(1).max(64),
  email: z.string().email(),
  phone: z.string().max(32).nullable().optional(),
  address_line: z.string().max(255).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(64).nullable().optional(),
  /** Bank details always pre-masked: XXXX-XXXX-7890. Raw value never emitted. */
  bank_masked: z
    .string()
    .regex(/^XXXX-XXXX-\d{4}$/)
    .nullable(),
  currency: CurrencyCode,
  source_system: z.string().max(64).nullable().optional(),
  source_id: z.string().max(128).nullable().optional(),
  created_at: z.string().datetime(),
});
export type VendorCreatedPayload = z.infer<typeof VendorCreatedPayloadSchema>;

/**
 * Payload for erp.vendor.updated
 * Emitted whenever mutable vendor fields are changed.
 */
export const VendorUpdatedPayloadSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(32).nullable().optional(),
  address_line: z.string().max(255).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(64).nullable().optional(),
  /** Bank details always pre-masked: XXXX-XXXX-7890. Raw value never emitted. */
  bank_masked: z
    .string()
    .regex(/^XXXX-XXXX-\d{4}$/)
    .nullable()
    .optional(),
  currency: CurrencyCode.optional(),
  updated_at: z.string().datetime(),
  updated_by_user_id: UuidSchema.optional(),
});
export type VendorUpdatedPayload = z.infer<typeof VendorUpdatedPayloadSchema>;

/**
 * Inline PO line summary for event payloads.
 * Uses string-encoded decimal amounts to avoid floating point.
 */
export const PurchaseOrderEventLineSchema = z.object({
  id: UuidSchema,
  product_id: UuidSchema,
  quantity: MoneyAmount2Dp,
  price: MoneyAmount2Dp,
  line_total: MoneyAmount2Dp,
});
export type PurchaseOrderEventLine = z.infer<typeof PurchaseOrderEventLineSchema>;

/**
 * Payload for erp.purchase_order.created
 * Emitted on successful PO creation. Total is server-computed.
 */
export const PurchaseOrderCreatedPayloadSchema = z.object({
  id: UuidSchema,
  po_number: z.string().min(1).max(64),
  vendor_id: UuidSchema,
  order_date: IsoDateString,
  status: z.literal('Draft'),
  currency: CurrencyCode,
  /** Server-computed sum of all line totals (decimal string). */
  total: MoneyAmount2Dp,
  line_count: z.number().int().min(1),
  lines: z.array(PurchaseOrderEventLineSchema),
  created_at: z.string().datetime(),
});
export type PurchaseOrderCreatedPayload = z.infer<typeof PurchaseOrderCreatedPayloadSchema>;

/**
 * Payload for erp.purchase_order.status_changed
 * Emitted on each strict forward status transition:
 *   Draft -> Sent -> Received -> Closed
 */
export const PurchaseOrderStatusChangedPayloadSchema = z.object({
  id: UuidSchema,
  po_number: z.string().min(1).max(64),
  vendor_id: UuidSchema,
  previous_status: PurchaseOrderStatusEnum,
  new_status: PurchaseOrderStatusEnum,
  changed_at: z.string().datetime(),
  changed_by_user_id: UuidSchema.optional(),
});
export type PurchaseOrderStatusChangedPayload = z.infer<
  typeof PurchaseOrderStatusChangedPayloadSchema
>;

/**
 * Payload for erp.purchase_order.received
 * Emitted when PO status transitions to 'Received'.
 * Consumed by ERP-1 (increases stock) and ERP-4 (creates vendor bill journal entry).
 */
export const PurchaseOrderReceivedPayloadSchema = z.object({
  purchaseOrderId: UuidSchema,
  poNumber: z.string().min(1).max(64),
  vendorId: UuidSchema,
  /** ISO-8601 datetime when goods were received. */
  receivedAt: z.string().datetime(),
  currency: CurrencyCode,
  total: MoneyAmount2Dp,
  lines: z
    .array(
      z.object({
        productId: UuidSchema,
        quantityReceived: MoneyAmount2Dp,
      })
    )
    .min(1),
});
export type PurchaseOrderReceivedPayload = z.infer<typeof PurchaseOrderReceivedPayloadSchema>;

/**
 * Inbound payload from ERP-4 when a vendor bill is posted.
 * ERP-2 consumes this to mark the associated PO as billed (reference only).
 *
 * Prefixed `Erp2` to distinguish from the ERP-4-owned `InboundVendorBillPostedPayloadSchema`
 * which carries accounting fields (expense_account_id, liability_account_id).
 */
export const Erp2InboundVendorBillPostedPayloadSchema = z.object({
  vendorBillId: UuidSchema,
  purchaseOrderId: UuidSchema.optional(),
  vendorId: UuidSchema,
  amount: MoneyAmount2Dp,
  currency: CurrencyCode,
  postedAt: z.string().datetime(),
  journalEntryId: UuidSchema.optional(),
});
export type Erp2InboundVendorBillPostedPayload = z.infer<typeof Erp2InboundVendorBillPostedPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Envelope Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const VendorCreatedEnvelopeSchema = createEventEnvelopeSchema(VendorCreatedPayloadSchema);
export const VendorUpdatedEnvelopeSchema = createEventEnvelopeSchema(VendorUpdatedPayloadSchema);
export const PurchaseOrderCreatedEnvelopeSchema = createEventEnvelopeSchema(
  PurchaseOrderCreatedPayloadSchema
);
export const PurchaseOrderStatusChangedEnvelopeSchema = createEventEnvelopeSchema(
  PurchaseOrderStatusChangedPayloadSchema
);
export const PurchaseOrderReceivedEnvelopeSchema = createEventEnvelopeSchema(
  PurchaseOrderReceivedPayloadSchema
);
export const Erp2InboundVendorBillPostedEnvelopeSchema = createEventEnvelopeSchema(
  Erp2InboundVendorBillPostedPayloadSchema
);

// ─────────────────────────────────────────────────────────────────────────────
// Event Factory Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructs a typed ERP-2 domain event envelope conforming to PLT-04/PLT-09.
 */
export function createErp2Event<T>(params: {
  eventId: string;
  eventType: Erp2EventType;
  correlationId: string;
  entityType: 'vendor' | 'purchase_order';
  entityId: string;
  batchId?: string | undefined;
  payload: T;
  occurredAt?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): EventEnvelope {
  return createEventEnvelope({
    event_id: params.eventId,
    event_type: params.eventType,
    schema_version: '1.0.0',
    occurred_at: params.occurredAt ?? new Date().toISOString(),
    correlation_id: params.correlationId,
    producer: 'erp-2',
    entity_type: params.entityType,
    entity_id: params.entityId,
    ...(params.batchId ? { batch_id: params.batchId } : {}),
    payload: params.payload,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  });
}
