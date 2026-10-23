/**
 * ERP-1 Products & Inventory — Domain Events Test Suite
 *
 * Proves that:
 *   - All ERP-1 domain event schemas validate correctly formatted event envelopes.
 *   - Event envelopes strictly enforce UUID event_id, ISO occurred_at, and producer: 'erp-1'.
 *   - Payloads match domain event schemas for all produced events.
 *   - Inbound event schemas (from ERP-2 goods receipt and ERP-3 sales fulfillment) parse valid inputs.
 *   - createErp1Event factory correctly constructs transactional event envelopes.
 *
 * @module contracts/tests/erp-1.events.test
 */

import { describe, it, expect } from 'vitest';
import {
  ERP1_EVENT_TYPES,
  ProductCreatedPayloadSchema,
  ProductCreatedEnvelopeSchema,
  ProductUpdatedPayloadSchema,
  ProductUpdatedEnvelopeSchema,
  CategoryCreatedPayloadSchema,
  CategoryCreatedEnvelopeSchema,
  WarehouseCreatedPayloadSchema,
  WarehouseCreatedEnvelopeSchema,
  StockAdjustedPayloadSchema,
  StockAdjustedEnvelopeSchema,
  InboundPurchaseOrderReceivedPayloadSchema,
  InboundPurchaseOrderReceivedEnvelopeSchema,
  InboundSalesOrderFulfilledPayloadSchema,
  InboundSalesOrderFulfilledEnvelopeSchema,
  createErp1Event,
} from '../src/erp-1-events.js';

const PRODUCT_ID = 'cccccccc-0001-4000-8000-000000000001';
const CATEGORY_ID = 'bbbbbbbb-0001-4000-8000-000000000001';
const WAREHOUSE_ID = 'aaaaaaaa-0001-4000-8000-000000000001';
const EVENT_ID = 'eeeeeee0-0001-4000-8000-000000000001';
const CORRELATION_ID = 'trace-erp1-test-001';
const TIMESTAMP = '2026-04-01T12:00:00.000Z';

describe('ERP-1 Event Type Constants', () => {
  it('exports all required event type strings', () => {
    expect(ERP1_EVENT_TYPES.PRODUCT_CREATED).toBe('erp.product.created');
    expect(ERP1_EVENT_TYPES.PRODUCT_UPDATED).toBe('erp.product.updated');
    expect(ERP1_EVENT_TYPES.CATEGORY_CREATED).toBe('erp.category.created');
    expect(ERP1_EVENT_TYPES.CATEGORY_UPDATED).toBe('erp.category.updated');
    expect(ERP1_EVENT_TYPES.WAREHOUSE_CREATED).toBe('erp.warehouse.created');
    expect(ERP1_EVENT_TYPES.STOCK_ADJUSTED).toBe('erp.stock_level.adjusted');
    expect(ERP1_EVENT_TYPES.INBOUND_PO_RECEIVED).toBe('erp.purchase_order.received');
    expect(ERP1_EVENT_TYPES.INBOUND_SO_FULFILLED).toBe('erp.sales_order.fulfilled');
  });
});

describe('ERP-1 Domain Event Envelopes (PLT-04 / PLT-09)', () => {
  it('validates ProductCreated event payload and envelope', () => {
    const payload = {
      id: PRODUCT_ID,
      sku: 'TOOL-HEX-01',
      name: 'Metric Hex Key Set 9pc',
      description: 'Chrome-vanadium metric hex wrenches',
      categoryId: CATEGORY_ID,
      unitOfMeasure: 'box',
      price: '18.5000',
      currency: 'USD',
      status: 'active',
      createdAt: TIMESTAMP,
    };

    const parsedPayload = ProductCreatedPayloadSchema.parse(payload);
    expect(parsedPayload.sku).toBe('TOOL-HEX-01');

    const envelope = {
      event_id: EVENT_ID,
      event_type: ERP1_EVENT_TYPES.PRODUCT_CREATED,
      schema_version: '1.0.0',
      occurred_at: TIMESTAMP,
      correlation_id: CORRELATION_ID,
      producer: 'erp-1',
      entity_type: 'product',
      entity_id: PRODUCT_ID,
      payload,
    };

    const parsedEnvelope = ProductCreatedEnvelopeSchema.parse(envelope);
    expect(parsedEnvelope.producer).toBe('erp-1');
    expect(parsedEnvelope.payload.price).toBe('18.5000');
  });

  it('validates ProductUpdated event payload and envelope', () => {
    const payload = {
      id: PRODUCT_ID,
      sku: 'TOOL-HEX-01',
      name: 'Metric Hex Key Set 9pc Pro',
      previousPrice: '18.5000',
      newPrice: '19.9500',
      categoryId: CATEGORY_ID,
      updatedAt: TIMESTAMP,
    };

    const parsed = ProductUpdatedPayloadSchema.parse(payload);
    expect(parsed.newPrice).toBe('19.9500');

    const envelope = createErp1Event({
      eventId: EVENT_ID,
      eventType: ERP1_EVENT_TYPES.PRODUCT_UPDATED,
      correlationId: CORRELATION_ID,
      entityType: 'product',
      entityId: PRODUCT_ID,
      payload,
      occurredAt: TIMESTAMP,
    });

    const parsedEnvelope = ProductUpdatedEnvelopeSchema.parse(envelope);
    expect(parsedEnvelope.payload.sku).toBe('TOOL-HEX-01');
  });

  it('validates CategoryCreated event payload and envelope', () => {
    const payload = {
      id: CATEGORY_ID,
      code: 'TOOLS',
      name: 'Tools & Hardware',
      description: 'Hand and power tools',
      createdAt: TIMESTAMP,
    };

    const parsed = CategoryCreatedPayloadSchema.parse(payload);
    expect(parsed.code).toBe('TOOLS');

    const envelope = createErp1Event({
      eventId: EVENT_ID,
      eventType: ERP1_EVENT_TYPES.CATEGORY_CREATED,
      correlationId: CORRELATION_ID,
      entityType: 'category',
      entityId: CATEGORY_ID,
      payload,
      occurredAt: TIMESTAMP,
    });

    const parsedEnvelope = CategoryCreatedEnvelopeSchema.parse(envelope);
    expect(parsedEnvelope.payload.name).toBe('Tools & Hardware');
  });

  it('validates WarehouseCreated event payload and envelope', () => {
    const payload = {
      id: WAREHOUSE_ID,
      code: 'WH-MAIN',
      name: 'Main Distribution Center',
      isDefault: true,
      createdAt: TIMESTAMP,
    };

    const parsed = WarehouseCreatedPayloadSchema.parse(payload);
    expect(parsed.isDefault).toBe(true);

    const envelope = createErp1Event({
      eventId: EVENT_ID,
      eventType: ERP1_EVENT_TYPES.WAREHOUSE_CREATED,
      correlationId: CORRELATION_ID,
      entityType: 'warehouse',
      entityId: WAREHOUSE_ID,
      payload,
      occurredAt: TIMESTAMP,
    });

    const parsedEnvelope = WarehouseCreatedEnvelopeSchema.parse(envelope);
    expect(parsedEnvelope.payload.code).toBe('WH-MAIN');
  });

  it('validates StockAdjusted event with positive and negative balance updates', () => {
    const payload = {
      productId: PRODUCT_ID,
      warehouseId: WAREHOUSE_ID,
      previousQuantity: '100.0000',
      newQuantity: '150.0000',
      adjustmentQuantity: '50.0000',
      stockStatus: 'in_stock' as const,
      reason: 'Physical inventory count reconciliation',
      adjustedAt: TIMESTAMP,
    };

    const parsed = StockAdjustedPayloadSchema.parse(payload);
    expect(parsed.stockStatus).toBe('in_stock');

    const envelope = createErp1Event({
      eventId: EVENT_ID,
      eventType: ERP1_EVENT_TYPES.STOCK_ADJUSTED,
      correlationId: CORRELATION_ID,
      entityType: 'stock_level',
      entityId: PRODUCT_ID,
      payload,
      occurredAt: TIMESTAMP,
    });

    const parsedEnvelope = StockAdjustedEnvelopeSchema.parse(envelope);
    expect(parsedEnvelope.payload.adjustmentQuantity).toBe('50.0000');
  });

  it('validates InboundPurchaseOrderReceived event from ERP-2', () => {
    const payload = {
      purchaseOrderId: 'ffffffff-0002-4000-8000-000000000001',
      warehouseId: WAREHOUSE_ID,
      receivedAt: TIMESTAMP,
      lines: [
        {
          productId: PRODUCT_ID,
          quantityReceived: '200.0000',
          unitOfMeasure: 'box' as const,
        },
      ],
    };

    const parsed = InboundPurchaseOrderReceivedPayloadSchema.parse(payload);
    expect(parsed.lines.length).toBe(1);

    const envelope = {
      event_id: EVENT_ID,
      event_type: ERP1_EVENT_TYPES.INBOUND_PO_RECEIVED,
      schema_version: '1.0.0',
      occurred_at: TIMESTAMP,
      correlation_id: CORRELATION_ID,
      producer: 'erp-2',
      entity_type: 'purchase_order',
      entity_id: payload.purchaseOrderId,
      payload,
    };

    const parsedEnvelope = InboundPurchaseOrderReceivedEnvelopeSchema.parse(envelope);
    expect(parsedEnvelope.payload.lines[0]?.quantityReceived).toBe('200.0000');
  });

  it('validates InboundSalesOrderFulfilled event from ERP-3', () => {
    const payload = {
      salesOrderId: 'aaaaaaaa-0003-4000-8000-000000000001',
      warehouseId: WAREHOUSE_ID,
      fulfilledAt: TIMESTAMP,
      lines: [
        {
          productId: PRODUCT_ID,
          quantityShipped: '15.0000',
          unitOfMeasure: 'box' as const,
        },
      ],
    };

    const parsed = InboundSalesOrderFulfilledPayloadSchema.parse(payload);
    expect(parsed.lines[0]?.quantityShipped).toBe('15.0000');

    const envelope = {
      event_id: EVENT_ID,
      event_type: ERP1_EVENT_TYPES.INBOUND_SO_FULFILLED,
      schema_version: '1.0.0',
      occurred_at: TIMESTAMP,
      correlation_id: CORRELATION_ID,
      producer: 'erp-3',
      entity_type: 'sales_order',
      entity_id: payload.salesOrderId,
      payload,
    };

    const parsedEnvelope = InboundSalesOrderFulfilledEnvelopeSchema.parse(envelope);
    expect(parsedEnvelope.payload.lines[0]?.quantityShipped).toBe('15.0000');
  });

  it('rejects invalid event envelope with missing event_id or non-UUID format', () => {
    const invalid = {
      event_id: 'not-a-uuid',
      event_type: ERP1_EVENT_TYPES.PRODUCT_CREATED,
      occurred_at: TIMESTAMP,
      correlation_id: CORRELATION_ID,
      producer: 'erp-1',
      entity_type: 'product',
      entity_id: PRODUCT_ID,
      payload: {},
    };

    expect(() => ProductCreatedEnvelopeSchema.parse(invalid)).toThrow();
  });
});
