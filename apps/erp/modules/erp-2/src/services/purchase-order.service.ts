/**
 * ERP-2 Purchase Order Domain Service
 *
 * Implements business operations for purchase orders:
 *   - FR-ERP2-03: Purchase order with lines (vendor link, date, status, lines)
 *   - FR-ERP2-04: Status lifecycle FSM (Draft -> Sent -> Received -> Closed)
 *   - FR-ERP2-05: Server-side order total recomputation from lines using Money arithmetic
 *   - BR-ERP2-01: Product existence validation via ERP-1 ReferenceResolver
 *   - Audit trail emission
 *
 * @module erp2/services/purchase-order.service
 */

import { AppError, type ReferenceResolver } from '@cs/kernel';
import { Money } from '@cs/core';
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  CreatePurchaseOrderRequest,
  PurchaseOrderListQuery,
  PurchaseOrderListResponse,
} from '@clearshift/contracts';
import type { Erp2Repository, ServiceContext } from './repository.js';
import { AuditService, defaultAuditService } from './audit.js';
import { validateStatusTransition } from '../policies/status-transitions.js';
import { erp1Resolver } from '@cs/mod-erp1';

export class PurchaseOrderService {
  constructor(
    private repository: Erp2Repository,
    private referenceResolver: ReferenceResolver = erp1Resolver,
    private auditService: AuditService = defaultAuditService
  ) {}

  async listPurchaseOrders(query: PurchaseOrderListQuery): Promise<PurchaseOrderListResponse> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const { items, total } = await this.repository.listPurchaseOrders({
      vendorId: query.vendor_id,
      status: query.status,
      page,
      pageSize,
    });

    const hasMore = page * pageSize < total;

    return {
      items,
      total,
      page,
      pageSize,
      hasMore,
    };
  }

  async getPurchaseOrderById(id: string): Promise<PurchaseOrder> {
    const po = await this.repository.getPurchaseOrderById(id);
    if (!po) {
      throw new AppError('NOT_FOUND', `Purchase order with ID '${id}' not found.`, 404);
    }
    return po;
  }

  async createPurchaseOrder(
    data: CreatePurchaseOrderRequest,
    context: ServiceContext
  ): Promise<PurchaseOrder> {
    // 1. Idempotency check if idempotency_key is provided
    if (data.idempotency_key) {
      const existingReceipt = await this.repository.getImportReceipt(data.idempotency_key);
      if (existingReceipt) {
        const existing = await this.repository.getPurchaseOrderById(existingReceipt.entityId);
        if (existing) {
          return existing;
        }
      }
    }

    // 2. Validate vendor exists
    const vendor = await this.repository.getVendorById(data.vendor_id);
    if (!vendor) {
      throw new AppError(
        'NOT_FOUND',
        `Referenced vendor with ID '${data.vendor_id}' does not exist.`,
        404,
        [{ field: 'vendor_id', message: 'Vendor does not exist' }]
      );
    }

    // 3. BR-ERP2-01: Every purchase line must reference a valid existing product
    if (!data.lines || data.lines.length === 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        'A purchase order must contain at least one line item.',
        400,
        [{ field: 'lines', message: 'Lines array cannot be empty' }]
      );
    }

    const currency = data.currency_code ?? 'USD';
    let runningTotal = new Money('0.00', currency);
    const computedLines: Omit<PurchaseOrderLine, 'id' | 'po_id' | 'created_at'>[] = [];

    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i]!;

      // Cross-module assertion via ERP-1 ReferenceResolver
      const productExists = await this.referenceResolver.exists('product', line.product_id);
      if (!productExists) {
        throw new AppError(
          'INVALID_PRODUCT_REFERENCE',
          `BR-ERP2-01: Purchase order line at index ${i} references unknown product ID '${line.product_id}'. Row rejected.`,
          422,
          [{ field: `lines[${i}].product_id`, message: 'Unknown product ID' }]
        );
      }

      // FR-ERP2-05: Server-side calculation from lines
      const lineTotalMoney = new Money(line.price, currency).multiply(line.quantity).round();
      const lineTotal = lineTotalMoney.toFixed();

      runningTotal = runningTotal.add(lineTotalMoney);

      computedLines.push({
        product_id: line.product_id,
        quantity: line.quantity,
        price: line.price,
        line_total: lineTotal,
      });
    }

    const poTotal = runningTotal.toFixed();
    const poNumber = `PO-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;

    const created = await this.repository.createPurchaseOrder({
      po_number: poNumber,
      vendor_id: data.vendor_id,
      order_date: data.order_date,
      status: 'Draft',
      currency_code: currency,
      total: poTotal,
      lines: computedLines as PurchaseOrderLine[],
      idempotency_key: data.idempotency_key,
      batch_id: data.batch_id,
      source_row: data.source_row,
    });

    // Record audit event
    await this.auditService.log({
      actor: context.actor,
      action: 'PO_CREATED',
      entity: 'erp2_purchase_orders',
      entityId: created.id,
      diff: {
        po_number: created.po_number,
        vendor_id: created.vendor_id,
        status: created.status,
        total: created.total,
        currency_code: created.currency_code,
        line_count: created.lines.length,
      },
      correlationId: context.correlationId,
    });

    return created;
  }

  async updatePurchaseOrderStatus(
    id: string,
    targetStatus: PurchaseOrderStatus,
    context: ServiceContext
  ): Promise<PurchaseOrder> {
    const existing = await this.getPurchaseOrderById(id);

    // FR-ERP2-04: Validate allowed forward transition
    const transitionCheck = validateStatusTransition(existing.status, targetStatus);
    if (!transitionCheck.valid) {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
        transitionCheck.message || 'Forbidden status transition',
        422,
        [{ field: 'status', message: transitionCheck.message || 'Invalid transition' }]
      );
    }

    const updated = await this.repository.updatePurchaseOrderStatus(id, targetStatus);
    if (!updated) {
      throw new AppError('NOT_FOUND', `Purchase order with ID '${id}' not found.`, 404);
    }

    // Record audit event
    await this.auditService.log({
      actor: context.actor,
      action: 'PO_STATUS_CHANGED',
      entity: 'erp2_purchase_orders',
      entityId: updated.id,
      diff: {
        previous_status: existing.status,
        new_status: targetStatus,
      },
      correlationId: context.correlationId,
    });

    return updated;
  }
}
