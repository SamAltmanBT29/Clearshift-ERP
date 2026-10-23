import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateLineTotal,
  calculateOrderTotal,
  maskBankDetails,
  isValidPoStatusTransition,
  assertValidPoStatusTransition,
  CreatePurchaseOrderRequestSchema,
  CreatePurchaseOrderLineRequestSchema,
  VendorSchema,
} from '@clearshift/contracts';
import { fetchVendors, fetchPurchaseOrders } from '../src/api/erp-2.js';

describe('ERP-2 Vendors & Purchasing — Domain Invariants & Web Logic', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Domain Invariant: Every PO line references a valid product (BR-ERP2-01)', () => {
    it('accepts valid UUID product reference in line schema', () => {
      const validLine = {
        product_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        quantity: '5.00',
        price: '20.00',
      };
      const result = CreatePurchaseOrderLineRequestSchema.safeParse(validLine);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.product_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      }
    });

    it('rejects invalid or malformed product reference in line schema', () => {
      const invalidLine = {
        product_id: 'not-a-valid-uuid',
        quantity: '5.00',
        price: '20.00',
      };
      const result = CreatePurchaseOrderLineRequestSchema.safeParse(invalidLine);
      expect(result.success).toBe(false);
    });

    it('asserts that empty lines array is rejected', () => {
      const poPayload = {
        vendor_id: '00000000-0000-0000-0000-000000000001',
        order_date: '2026-10-23',
        currency: 'USD',
        lines: [],
      };
      const result = CreatePurchaseOrderRequestSchema.safeParse(poPayload);
      expect(result.success).toBe(false);
    });
  });

  describe('Domain Invariant: Order total is recomputed server-side from lines (FR-ERP2-03, FR-ERP2-05)', () => {
    it('calculates line total using exact decimal arithmetic', () => {
      expect(calculateLineTotal('10.50', '2.00')).toBe('21.00');
      expect(calculateLineTotal('3.33', '10.00')).toBe('33.30');
      expect(calculateLineTotal('1.00', '19.99')).toBe('19.99');
    });

    it('calculates order total across multiple lines', () => {
      const lines = [
        { line_total: '21.00' },
        { line_total: '33.30' },
        { line_total: '19.99' },
      ];
      expect(calculateOrderTotal(lines)).toBe('74.29');
    });
  });

  describe('Domain Invariant: Bank details server-side masking format (FR-ERP2-02)', () => {
    it('masks raw account numbers to XXXX-XXXX-7890 format', () => {
      expect(maskBankDetails('1234567890')).toBe('XXXX-XXXX-7890');
      expect(maskBankDetails('US12345678901234')).toBe('XXXX-XXXX-1234');
      expect(maskBankDetails(null)).toBeNull();
      expect(maskBankDetails(undefined)).toBeNull();
    });

    it('VendorSchema enforces bank_masked format XXXX-XXXX-####', () => {
      const valid = {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Acme LLC',
        tax_number: 'TAX-001',
        email: 'acme@example.com',
        bank_masked: 'XXXX-XXXX-7890',
        currency: 'USD',
        created_at: '2026-10-23T00:00:00Z',
        updated_at: '2026-10-23T00:00:00Z',
      };
      expect(VendorSchema.safeParse(valid).success).toBe(true);

      const invalidMask = {
        ...valid,
        bank_masked: '1234-5678-7890', // Unmasked digits at front
      };
      expect(VendorSchema.safeParse(invalidMask).success).toBe(false);
    });
  });

  describe('Domain Invariant: Purchase order unidirectional status state machine (FR-ERP2-04)', () => {
    it('allows valid forward transitions: Draft -> Sent -> Received -> Closed', () => {
      expect(isValidPoStatusTransition('Draft', 'Sent')).toBe(true);
      expect(isValidPoStatusTransition('Sent', 'Received')).toBe(true);
      expect(isValidPoStatusTransition('Received', 'Closed')).toBe(true);
    });

    it('rejects backward or skip transitions', () => {
      expect(isValidPoStatusTransition('Sent', 'Draft')).toBe(false);
      expect(isValidPoStatusTransition('Received', 'Sent')).toBe(false);
      expect(isValidPoStatusTransition('Closed', 'Received')).toBe(false);
      expect(isValidPoStatusTransition('Draft', 'Closed')).toBe(false);
      expect(() => assertValidPoStatusTransition('Sent', 'Draft')).toThrow();
    });
  });

  describe('API Client Query Builder Verification', () => {
    it('fetchVendors builds proper relative query parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      });
      globalThis.fetch = mockFetch;

      await fetchVendors({ page: 2, pageSize: 50, search: 'Acme Supply' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/erp-vendors/vendors?page=2&pageSize=50&search=Acme+Supply',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/json',
          }),
        })
      );
    });

    it('fetchPurchaseOrders builds proper relative query parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      });
      globalThis.fetch = mockFetch;

      await fetchPurchaseOrders({
        page: 1,
        pageSize: 10,
        status: 'Sent',
        vendor_id: '00000000-0000-0000-0000-000000000001',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/erp-vendors/purchase-orders?page=1&pageSize=10&vendor_id=00000000-0000-0000-0000-000000000001&status=Sent',
        expect.anything()
      );
    });
  });
});
