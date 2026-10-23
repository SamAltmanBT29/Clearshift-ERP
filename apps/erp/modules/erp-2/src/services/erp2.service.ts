/**
 * ERP-2 Vendors & Purchasing — Domain Service
 *
 * Implements business invariants and orchestration for:
 *   - FR-ERP2-01: Vendor listing with search and bounded pagination
 *   - FR-ERP2-02, FR-ERP2-06: Vendor CRUD with server-side bank details masking (XXXX-XXXX-7890)
 *   - FR-ERP2-03: Purchase orders with line items
 *   - FR-ERP2-04: Strict unidirectional status transitions (Draft -> Sent -> Received -> Closed)
 *   - FR-ERP2-05: Server-side calculated totals using Decimal arithmetic
 *   - BR-ERP2-01: Line product verification via ERP-1 ReferenceResolver
 *   - KIT-08 / Decision C4: Atomic dual-write import with deterministic idempotency
 *   - ERP2-11: loadBatch UPSERT support — when upsert=true and natural key already exists,
 *              update vendor in-place and store receipt with kind='linked'.
 *
 * @module erp2/services/erp2.service
 */

import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { AppError } from '@cs/kernel';
import type { ReferenceResolver } from '@cs/kernel';
import type {
  Vendor,
  CreateVendorRequest,
  UpdateVendorRequest,
  VendorListQuery,
  PurchaseOrder,
  CreatePurchaseOrderRequest,
  PurchaseOrderListQuery,
  PurchaseOrderStatus,
  ImportRowRequest,
  ImportRowResponse,
} from '@clearshift/contracts';

/**
 * Extended import row request with optional upsert semantics (ERP2-11).
 * When upsert=true the adapter will UPDATE an existing record rather than
 * rejecting with DUPLICATE_TAX_NUMBER, and the receipt will carry kind='linked'.
 */
export interface ImportRowRequestExtended extends ImportRowRequest {
  /** When true, existing record with matching natural key will be updated (UPSERT). */
  upsert?: boolean;
}
import {
  type Erp2Repository,
  computeRequestHash,
  maskBankDetails,
} from './repository.js';

// ─────────────────────────────────────────────────────────────────────────────
// Service Options
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp2ServiceOptions {
  repository: Erp2Repository;
  referenceResolver?: ReferenceResolver | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain Errors
// ─────────────────────────────────────────────────────────────────────────────

export class DomainError extends AppError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(code, message, 422, [
      {
        code,
        message,
        field: typeof details['field'] === 'string' ? details['field'] : undefined,
      },
    ]);
    this.name = 'DomainError';
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(code, message, 409, [
      {
        code,
        message,
        field: typeof details['field'] === 'string' ? details['field'] : undefined,
      },
    ]);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with ID '${id}' not found`, 404, [
      { code: 'NOT_FOUND', message: `${resource} '${id}' not found` },
    ]);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super('VALIDATION_ERROR', message, 400, [
      { code: 'VALIDATION_ERROR', message, field },
    ]);
    this.name = 'ValidationError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Erp2Service Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class Erp2Service {
  private readonly repo: Erp2Repository;
  private readonly resolver?: ReferenceResolver | undefined;

  constructor(options: Erp2ServiceOptions) {
    this.repo = options.repository;
    this.resolver = options.referenceResolver;
  }

  // ── Vendors ────────────────────────────────────────────────────────────────

  async listVendors(query: VendorListQuery): Promise<{ vendors: Vendor[]; total: number }> {
    return this.repo.listVendors(query);
  }

  async getVendorById(id: string): Promise<Vendor> {
    const vendor = await this.repo.getVendorById(id);
    if (!vendor) {
      throw new NotFoundError('Vendor', id);
    }
    return vendor;
  }

  async createVendor(data: CreateVendorRequest): Promise<Vendor> {
    // Check duplicate tax number
    const existing = await this.repo.getVendorByTaxNumber(data.tax_number);
    if (existing) {
      throw new ConflictError(
        'DUPLICATE_TAX_NUMBER',
        `Vendor with tax number '${data.tax_number}' already exists`,
        { field: 'tax_number' }
      );
    }

    const maskedBank = maskBankDetails(data.bank_details);
    return this.repo.createVendor(data, maskedBank);
  }

  async updateVendor(id: string, updates: UpdateVendorRequest): Promise<Vendor> {
    const existing = await this.getVendorById(id);

    if (updates.tax_number && updates.tax_number !== existing.tax_number) {
      const duplicate = await this.repo.getVendorByTaxNumber(updates.tax_number);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictError(
          'DUPLICATE_TAX_NUMBER',
          `Vendor with tax number '${updates.tax_number}' already exists`,
          { field: 'tax_number' }
        );
      }
    }

    const updatePayload: Partial<Vendor> = {};
    if (updates.name !== undefined) updatePayload.name = updates.name;
    if (updates.tax_number !== undefined) updatePayload.tax_number = updates.tax_number;
    if (updates.email !== undefined) updatePayload.email = updates.email;
    if (updates.phone !== undefined) updatePayload.phone = updates.phone;
    if (updates.address_line !== undefined) updatePayload.address_line = updates.address_line;
    if (updates.city !== undefined) updatePayload.city = updates.city;
    if (updates.country !== undefined) updatePayload.country = updates.country;
    if (updates.bank_details !== undefined) {
      updatePayload.bank_masked = maskBankDetails(updates.bank_details);
    }
    if (updates.currency !== undefined) updatePayload.currency = updates.currency;

    return this.repo.updateVendor(id, updatePayload);
  }

  // ── Purchase Orders ────────────────────────────────────────────────────────

  async listPurchaseOrders(
    query: PurchaseOrderListQuery
  ): Promise<{ purchaseOrders: PurchaseOrder[]; total: number }> {
    return this.repo.listPurchaseOrders(query);
  }

  async getPurchaseOrderById(id: string): Promise<PurchaseOrder> {
    const po = await this.repo.getPurchaseOrderById(id);
    if (!po) {
      throw new NotFoundError('PurchaseOrder', id);
    }
    return po;
  }

  async createPurchaseOrder(data: CreatePurchaseOrderRequest): Promise<PurchaseOrder> {
    // 1. Verify vendor exists
    const vendor = await this.repo.getVendorById(data.vendor_id);
    if (!vendor) {
      throw new DomainError('VENDOR_NOT_FOUND', `Vendor with ID '${data.vendor_id}' not found`, {
        field: 'vendor_id',
      });
    }

    // 2. Verify all line product references via ERP-1 contract (BR-ERP2-01)
    if (this.resolver) {
      for (const line of data.lines) {
        const productExists = await this.resolver.exists('product', line.product_id);
        if (!productExists) {
          throw new DomainError(
            'UNKNOWN_PRODUCT',
            `Purchase line references unknown product ID '${line.product_id}'`,
            { field: 'lines.product_id', product_id: line.product_id }
          );
        }
      }
    }

    // 3. Recompute line totals and overall total server-side using Decimal (FR-ERP2-05)
    const poId = randomUUID();
    let computedTotal = new Decimal(0);

    const calculatedLines = data.lines.map((l) => {
      const qty = new Decimal(l.quantity);
      const price = new Decimal(l.price);
      const lineTotal = qty.times(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      computedTotal = computedTotal.plus(lineTotal);

      return {
        id: randomUUID(),
        po_id: poId,
        product_id: l.product_id,
        quantity: qty.toFixed(2),
        price: price.toFixed(2),
        line_total: lineTotal.toFixed(2),
      };
    });

    const poNumber = data.po_number ?? `PO-${Date.now()}-${randomUUID().slice(0, 4).toUpperCase()}`;

    // 4. Persist purchase order (default status: Draft)
    return this.repo.createPurchaseOrder({
      id: poId,
      po_number: poNumber,
      vendor_id: data.vendor_id,
      order_date: data.order_date,
      status: 'Draft',
      currency: data.currency ?? vendor.currency ?? 'USD',
      total: computedTotal.toFixed(2),
      lines: calculatedLines,
    });
  }

  async updatePurchaseOrderStatus(
    id: string,
    newStatus: PurchaseOrderStatus
  ): Promise<PurchaseOrder> {
    const po = await this.getPurchaseOrderById(id);

    // Enforce strict unidirectional transitions: Draft -> Sent -> Received -> Closed (FR-ERP2-04)
    const allowedTransitions: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
      Draft: ['Sent'],
      Sent: ['Received'],
      Received: ['Closed'],
      Closed: [],
    };

    const validNextStates = allowedTransitions[po.status] ?? [];
    if (!validNextStates.includes(newStatus)) {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        `Cannot transition purchase order from '${po.status}' to '${newStatus}'. Allowed forward flow is Draft -> Sent -> Received -> Closed.`,
        { currentStatus: po.status, requestedStatus: newStatus }
      );
    }

    // Changing status to Received does not mutate stock (goods receipts are V2)
    return this.repo.updatePurchaseOrderStatus(id, newStatus);
  }

  // ── Migration Kit Import (KIT-08 / Decision C4) ───────────────────────────

  /**
   * Commits domain mutation and durable receipt together in a single transaction.
   * Handles idempotent replays and detects key reuse with mismatched payloads.
   */
  async importRow(req: ImportRowRequest | ImportRowRequestExtended): Promise<ImportRowResponse> {
    const upsert = (req as ImportRowRequestExtended).upsert ?? false;
    const requestHash = computeRequestHash(req.record);

    // Check prior receipt
    const priorReceipt = await this.repo.getImportReceiptByKey(req.idempotency_key);
    if (priorReceipt) {
      if (priorReceipt.request_hash === requestHash) {
        // Idempotent replay: return prior result
        return {
          target_id: priorReceipt.target_id,
          target_version: 1,
          outcome: priorReceipt.outcome,
          receipt: priorReceipt,
          prior_result: true,
        };
      } else {
        // Key reuse with different payload: 409 Conflict
        throw new ConflictError(
          'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
          `Idempotency key '${req.idempotency_key}' was previously used with a different request payload`,
          { idempotency_key: req.idempotency_key }
        );
      }
    }

    // Execute atomic dual-write within local transaction
    return this.repo.executeTransactional(async (txRepo) => {
      let targetId: string;
      let responsePayload: unknown;
      let receiptKind: 'created' | 'linked' = 'created';

      if (req.entity === 'vendor') {
        const vendorData = req.record as unknown as CreateVendorRequest;
        // Duplicate key check — strict-create or UPSERT depending on options
        const existing = await txRepo.getVendorByTaxNumber(vendorData.tax_number);
        if (existing) {
          if (!upsert) {
            throw new ConflictError(
              'DUPLICATE_TAX_NUMBER',
              `Vendor with tax number '${vendorData.tax_number}' already exists`,
              { field: 'tax_number' }
            );
          }
          // UPSERT path: update existing vendor fields in-place (kind='linked')
          const maskedBank = maskBankDetails(vendorData.bank_details);
          const updatedVendor = await txRepo.updateVendor(existing.id, {
            name: vendorData.name,
            email: vendorData.email,
            phone: vendorData.phone ?? existing.phone,
            address_line: vendorData.address_line ?? existing.address_line,
            city: vendorData.city ?? existing.city,
            country: vendorData.country ?? existing.country,
            bank_masked: maskedBank ?? existing.bank_masked,
            currency: vendorData.currency ?? existing.currency,
            source_system: vendorData.source_system ?? existing.source_system,
            source_id: vendorData.source_id ?? existing.source_id,
          });
          targetId = updatedVendor.id;
          receiptKind = 'linked';
          responsePayload = updatedVendor;
        } else {
          // CREATE path
          const maskedBank = maskBankDetails(vendorData.bank_details);
          const createdVendor = await txRepo.createVendor(vendorData, maskedBank);
          targetId = createdVendor.id;
          responsePayload = createdVendor;
        }
      } else if (req.entity === 'purchase_order') {
        const poData = req.record as unknown as CreatePurchaseOrderRequest;

        // Verify vendor
        const vendor = await txRepo.getVendorById(poData.vendor_id);
        if (!vendor) {
          throw new DomainError('VENDOR_NOT_FOUND', `Vendor with ID '${poData.vendor_id}' not found`, {
            field: 'vendor_id',
          });
        }

        // Verify product references (BR-ERP2-01)
        if (this.resolver) {
          for (const line of poData.lines) {
            const productExists = await this.resolver.exists('product', line.product_id);
            if (!productExists) {
              throw new DomainError(
                'UNKNOWN_PRODUCT',
                `Purchase line references unknown product ID '${line.product_id}'`,
                { field: 'lines.product_id', product_id: line.product_id }
              );
            }
          }
        }

        // Recompute totals
        const poId = randomUUID();
        let total = new Decimal(0);
        const lines = poData.lines.map((l) => {
          const qty = new Decimal(l.quantity);
          const price = new Decimal(l.price);
          const lineTotal = qty.times(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          total = total.plus(lineTotal);
          return {
            id: randomUUID(),
            po_id: poId,
            product_id: l.product_id,
            quantity: qty.toFixed(2),
            price: price.toFixed(2),
            line_total: lineTotal.toFixed(2),
          };
        });

        const createdPo = await txRepo.createPurchaseOrder({
          id: poId,
          po_number: poData.po_number ?? `PO-${Date.now()}-${randomUUID().slice(0, 4).toUpperCase()}`,
          vendor_id: poData.vendor_id,
          order_date: poData.order_date,
          status: 'Draft',
          currency: poData.currency ?? vendor.currency ?? 'USD',
          total: total.toFixed(2),
          lines,
        });
        targetId = createdPo.id;
        responsePayload = createdPo;
      } else {
        throw new ValidationError(`Unsupported entity type for import: '${req.entity}'`, 'entity');
      }

      // Insert durable import receipt in SAME transaction
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
        kind: receiptKind,
        outcome: 'loaded',
        response_payload: responsePayload,
      });

      return {
        target_id: targetId,
        target_version: 1,
        outcome: 'loaded',
        receipt,
        prior_result: false,
      };
    });
  }
}
