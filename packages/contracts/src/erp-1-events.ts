/**
 * ERP-1 Products & Inventory — Domain Event Contracts
 *
 * Strongly-typed domain event schemas conforming to ClearShift Transactional
 * Event Envelope Schema (PLT-04 / PLT-09).
 *
 * Implements:
 *   - Product lifecycle events (created, updated)
 *   - Category lifecycle events (created, updated)
 *   - Warehouse lifecycle events (created)
 *   - Physical inventory adjustments (stock_level.adjusted)
 *   - Cross-module inbound event payload definitions:
 *       - erp.purchase_order.received (from ERP-2: increases stock)
 *       - erp.sales_order.fulfilled (from ERP-3: decreases stock)
 *
 * Traceability:
 *   - SDS ClearShift ERP v2.0 §4.2 (Products & Inventory)
 *   - SDS §3.2: event naming <noun>.<past_verb>
 *   - ADR-002: standard event envelope fields
 *   - Issue #110 ([ERP1-14])
 *
 * @module contracts/erp-1-events
 */

import { z } from 'zod';
import {
  UnitOfMeasureSchema,
  ERP1_STOCK_STATUSES,
  ERP1_PRODUCT_STATUSES,
} from './erp-1.js';
import {
  createEventEnvelopeSchema,
  createEventEnvelope,
  type EventEnvelope,
} from './events.js';

const UuidSchema = z.string().uuid({ message: 'Must be a valid UUID' });
const Decimal4Schema = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a valid non-negative decimal string with up to 4 decimal places');
const SignedDecimal4Schema = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Must be a valid decimal string with up to 4 decimal places');
const CurrencyCodeSchema = z.string().length(3).default('USD');
const StockStatusEnumSchema = z.enum(ERP1_STOCK_STATUSES);
const ProductStatusEnumSchema = z.enum(ERP1_PRODUCT_STATUSES);

// ─────────────────────────────────────────────────────────────────────────────
// Event Type Constants
// ─────────────────────────────────────────────────────────────────────────────

export const ERP1_EVENT_TYPES = {
  // Produced by ERP-1
  PRODUCT_CREATED: 'erp.product.created',
  PRODUCT_UPDATED: 'erp.product.updated',
  CATEGORY_CREATED: 'erp.category.created',
  CATEGORY_UPDATED: 'erp.category.updated',
  WAREHOUSE_CREATED: 'erp.warehouse.created',
  STOCK_ADJUSTED: 'erp.stock_level.adjusted',
  // Inbound cross-module events consumed or projected by ERP-1
  INBOUND_PO_RECEIVED: 'erp.purchase_order.received',
  INBOUND_SO_FULFILLED: 'erp.sales_order.fulfilled',
} as const;

export type Erp1EventType = (typeof ERP1_EVENT_TYPES)[keyof typeof ERP1_EVENT_TYPES];

// ─────────────────────────────────────────────────────────────────────────────
// Event Payload Schemas
// ─────────────────────────────────────────────────────────────────────────────

/** Payload for erp.product.created */
export const ProductCreatedPayloadSchema = z.object({
  id: UuidSchema,
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  categoryId: UuidSchema.nullable().optional(),
  unitOfMeasure: UnitOfMeasureSchema,
  price: Decimal4Schema,
  currency: CurrencyCodeSchema,
  status: ProductStatusEnumSchema.default('active'),
  sourceSystem: z.string().max(64).nullable().optional(),
  sourceId: z.string().max(128).nullable().optional(),
  createdAt: z.string().datetime(),
});
export type ProductCreatedPayload = z.infer<typeof ProductCreatedPayloadSchema>;

/** Payload for erp.product.updated */
export const ProductUpdatedPayloadSchema = z.object({
  id: UuidSchema,
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  previousPrice: Decimal4Schema.optional(),
  newPrice: Decimal4Schema.optional(),
  categoryId: UuidSchema.nullable().optional(),
  status: ProductStatusEnumSchema.optional(),
  updatedAt: z.string().datetime(),
  updatedByUserId: UuidSchema.optional(),
});
export type ProductUpdatedPayload = z.infer<typeof ProductUpdatedPayloadSchema>;

/** Payload for erp.category.created */
export const CategoryCreatedPayloadSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  createdAt: z.string().datetime(),
});
export type CategoryCreatedPayload = z.infer<typeof CategoryCreatedPayloadSchema>;

/** Payload for erp.warehouse.created */
export const WarehouseCreatedPayloadSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(100),
  isDefault: z.boolean().default(true),
  createdAt: z.string().datetime(),
});
export type WarehouseCreatedPayload = z.infer<typeof WarehouseCreatedPayloadSchema>;

/** Payload for erp.stock_level.adjusted */
export const StockAdjustedPayloadSchema = z.object({
  productId: UuidSchema,
  warehouseId: UuidSchema,
  previousQuantity: Decimal4Schema,
  newQuantity: Decimal4Schema,
  adjustmentQuantity: SignedDecimal4Schema,
  stockStatus: StockStatusEnumSchema,
  reason: z.string().min(1).max(255),
  referenceId: z.string().max(128).nullable().optional(),
  adjustedAt: z.string().datetime(),
  adjustedByUserId: UuidSchema.optional(),
});
export type StockAdjustedPayload = z.infer<typeof StockAdjustedPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Module Inbound Event Payload Schemas
// ─────────────────────────────────────────────────────────────────────────────

/** Inbound payload from ERP-2 when goods are received */
export const InboundPurchaseOrderReceivedPayloadSchema = z.object({
  purchaseOrderId: UuidSchema,
  warehouseId: UuidSchema,
  receivedAt: z.string().datetime(),
  lines: z.array(
    z.object({
      productId: UuidSchema,
      quantityReceived: Decimal4Schema,
      unitOfMeasure: UnitOfMeasureSchema,
    })
  ).min(1),
});
export type InboundPurchaseOrderReceivedPayload = z.infer<
  typeof InboundPurchaseOrderReceivedPayloadSchema
>;

/** Inbound payload from ERP-3 when sales orders are fulfilled */
export const InboundSalesOrderFulfilledPayloadSchema = z.object({
  salesOrderId: UuidSchema,
  warehouseId: UuidSchema,
  fulfilledAt: z.string().datetime(),
  lines: z.array(
    z.object({
      productId: UuidSchema,
      quantityShipped: Decimal4Schema,
      unitOfMeasure: UnitOfMeasureSchema,
    })
  ).min(1),
});
export type InboundSalesOrderFulfilledPayload = z.infer<
  typeof InboundSalesOrderFulfilledPayloadSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Envelope Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const ProductCreatedEnvelopeSchema = createEventEnvelopeSchema(ProductCreatedPayloadSchema);
export const ProductUpdatedEnvelopeSchema = createEventEnvelopeSchema(ProductUpdatedPayloadSchema);
export const CategoryCreatedEnvelopeSchema = createEventEnvelopeSchema(CategoryCreatedPayloadSchema);
export const WarehouseCreatedEnvelopeSchema = createEventEnvelopeSchema(WarehouseCreatedPayloadSchema);
export const StockAdjustedEnvelopeSchema = createEventEnvelopeSchema(StockAdjustedPayloadSchema);
export const InboundPurchaseOrderReceivedEnvelopeSchema = createEventEnvelopeSchema(
  InboundPurchaseOrderReceivedPayloadSchema
);
export const InboundSalesOrderFulfilledEnvelopeSchema = createEventEnvelopeSchema(
  InboundSalesOrderFulfilledPayloadSchema
);

// ─────────────────────────────────────────────────────────────────────────────
// Event Factory Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function createErp1Event<T>(params: {
  eventId: string;
  eventType: Erp1EventType;
  correlationId: string;
  entityType: 'product' | 'category' | 'warehouse' | 'stock_level';
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
    producer: 'erp-1',
    entity_type: params.entityType,
    entity_id: params.entityId,
    ...(params.batchId ? { batch_id: params.batchId } : {}),
    payload: params.payload,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  });
}
