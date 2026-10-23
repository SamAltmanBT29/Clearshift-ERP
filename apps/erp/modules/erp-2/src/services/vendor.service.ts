/**
 * ERP-2 Vendor Domain Service
 *
 * Implements business operations for vendors:
 *   - FR-ERP2-01: Vendor list with search by name, paged
 *   - FR-ERP2-02: Create and edit vendor with masked bank details
 *   - FR-ERP2-06: Strict bank masking guarantee
 *   - Audit trail emission
 *
 * @module erp2/services/vendor.service
 */

import { AppError } from '@cs/kernel';
import type {
  Vendor,
  CreateVendorRequest,
  UpdateVendorRequest,
  VendorListQuery,
  VendorListResponse,
} from '@clearshift/contracts';
import type { Erp2Repository, ServiceContext } from './repository.js';
import { AuditService, defaultAuditService } from './audit.js';
import { maskBankDetails } from '../policies/field-masking.js';

export class VendorService {
  constructor(
    private repository: Erp2Repository,
    private auditService: AuditService = defaultAuditService
  ) {}

  async listVendors(query: VendorListQuery): Promise<VendorListResponse> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const res = await this.repository.listVendors({
      search: query.search,
      page,
      pageSize,
    });

    const items = res.items ?? res.vendors ?? [];
    const total = res.total ?? 0;
    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  async getVendorById(id: string): Promise<Vendor> {
    const vendor = await this.repository.getVendorById(id);
    if (!vendor) {
      throw new AppError('NOT_FOUND', `Vendor with ID '${id}' not found.`, 404);
    }
    return vendor;
  }

  async createVendor(
    data: CreateVendorRequest,
    context: ServiceContext
  ): Promise<Vendor> {
    // 1. Idempotency check if idempotency_key is provided
    if (data.idempotency_key) {
      const existingReceipt = await this.repository.getImportReceiptByKey(data.idempotency_key);
      if (existingReceipt) {
        const existing = await this.repository.getVendorById(
          (existingReceipt as any).target_id ?? (existingReceipt as any).entityId
        );
        if (existing) {
          return existing;
        }
      }
    }

    // 2. Uniqueness check on tax_number
    const existingTax = await this.repository.getVendorByTaxNumber(data.tax_number);
    if (existingTax) {
      throw new AppError(
        'DUPLICATE_TAX_NUMBER',
        `A vendor with tax number '${data.tax_number}' already exists.`,
        409,
        [{ field: 'tax_number', message: 'Tax number must be unique' }]
      );
    }

    // 3. Mask bank details server-side before persisting (FR-ERP2-06)
    const rawBank = data.bank_details;
    const bankMasked = maskBankDetails(rawBank);

    const created = await this.repository.createVendor(data, bankMasked);

    // 4. Record audit event
    await this.auditService.log({
      actor: context.actor,
      action: 'VENDOR_CREATED',
      entity: 'erp2_vendors',
      entityId: created.id,
      diff: {
        name: created.name,
        tax_number: created.tax_number,
        bank_masked: created.bank_masked,
      },
      correlationId: context.correlationId,
    });

    return created;
  }

  async updateVendor(
    id: string,
    updates: UpdateVendorRequest,
    context: ServiceContext
  ): Promise<Vendor> {
    const existing = await this.getVendorById(id);

    // If tax_number updated, verify uniqueness
    if (updates.tax_number && updates.tax_number !== existing.tax_number) {
      const conflict = await this.repository.getVendorByTaxNumber(updates.tax_number);
      if (conflict && conflict.id !== id) {
        throw new AppError(
          'DUPLICATE_TAX_NUMBER',
          `A vendor with tax number '${updates.tax_number}' already exists.`,
          409,
          [{ field: 'tax_number', message: 'Tax number must be unique' }]
        );
      }
    }

    // Field-level masking for updated bank details
    const cleanUpdates: Partial<Vendor> = {};
    if (updates.name !== undefined) cleanUpdates.name = updates.name;
    if (updates.tax_number !== undefined) cleanUpdates.tax_number = updates.tax_number;
    if (updates.email !== undefined) cleanUpdates.email = updates.email;
    if (updates.phone !== undefined) cleanUpdates.phone = updates.phone;
    if (updates.address_line !== undefined) cleanUpdates.address_line = updates.address_line;
    if (updates.city !== undefined) cleanUpdates.city = updates.city;
    if (updates.country !== undefined) cleanUpdates.country = updates.country;

    if (updates.bank_details !== undefined) {
      cleanUpdates.bank_masked = maskBankDetails(updates.bank_details);
    }

    const updated = await this.repository.updateVendor(id, cleanUpdates);
    if (!updated) {
      throw new AppError('NOT_FOUND', `Vendor with ID '${id}' not found.`, 404);
    }

    // Record audit event
    await this.auditService.log({
      actor: context.actor,
      action: 'VENDOR_UPDATED',
      entity: 'erp2_vendors',
      entityId: updated.id,
      diff: cleanUpdates,
      correlationId: context.correlationId,
    });

    return updated;
  }
}
