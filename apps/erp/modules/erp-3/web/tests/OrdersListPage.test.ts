import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchSalesOrders,
  fetchInvoices,
  ApiError,
} from '../src/api/erp-3.js';
import {
  calculateLineAmounts,
  validateOrderLineTotals,
  deriveInvoiceStatus,
  CustomerGoldenIdSchema,
} from '@clearshift/contracts';

const ORDER_ID_1 = 'aaaaaaaa-0003-4000-8000-000000000001';
const INVOICE_ID_1 = 'cccccccc-0003-4000-8000-000000000001';
const CUSTOMER_GOLDEN_ID_1 = '55555555-0003-4000-8000-000000000001';

describe('ERP-3 Frontend API Client & View Logic Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchSalesOrders() and Query Construction', () => {
    it('constructs correct canonical query params and returns paginated sales orders', async () => {
      const mockResponse = {
        data: [
          {
            id: ORDER_ID_1,
            order_number: 'SO-2026-0001',
            customer_golden_id: CUSTOMER_GOLDEN_ID_1,
            order_date: '2026-10-23',
            status: 'Open',
            currency: 'USD',
            total: '1100.0000',
            lines: [],
            source_system: null,
            source_id: null,
            created_at: '2026-10-23T00:00:00.000Z',
            updated_at: '2026-10-23T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchSalesOrders({
        page: 1,
        pageSize: 20,
        search: 'SO-2026-0001',
        status: 'Open',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/erp-orders/sales-orders?page=1&pageSize=20&search=SO-2026-0001&status=Open',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        })
      );
      expect(result.items.length).toBe(1);
      expect(result.items[0]?.order_number).toBe('SO-2026-0001');
    });

    it('formats query string properly with pagination, customer_golden_id, and status parameters', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }),
      });

      await fetchSalesOrders({
        page: 1,
        pageSize: 50,
        search: 'SO-2026',
        status: 'Invoiced',
        customer_golden_id: CUSTOMER_GOLDEN_ID_1,
      });
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/v1/erp-orders/sales-orders?page=1&pageSize=50&search=SO-2026&status=Invoiced&customer_golden_id=${CUSTOMER_GOLDEN_ID_1}`,
        expect.anything()
      );
    });

    it('handles API errors gracefully with ApiError envelope', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          code: 'ORDER_NOT_FOUND',
          message: 'Sales order does not exist',
        }),
      });

      await expect(fetchSalesOrders()).rejects.toThrow(ApiError);
    });
  });

  describe('fetchInvoices() and Status Transitions', () => {
    it('constructs query and fetches paginated invoices', async () => {
      const mockResponse = {
        data: [
          {
            id: INVOICE_ID_1,
            invoice_number: 'INV-2026-0001',
            order_id: ORDER_ID_1,
            customer_golden_id: CUSTOMER_GOLDEN_ID_1,
            invoice_date: '2026-10-23',
            due_date: '2026-11-23',
            status: 'Open',
            currency: 'USD',
            total: '1100.0000',
            lines: [],
            source_system: null,
            source_id: null,
            created_at: '2026-10-23T00:00:00.000Z',
            updated_at: '2026-10-23T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchInvoices({ page: 1, pageSize: 20, status: 'Open' });
      expect(result.items.length).toBe(1);
      expect(result.items[0]?.status).toBe('Open');
    });
  });

  describe('Domain Invariants: ERP-3 Sales Orders & Invoices', () => {
    it('asserts BR-ERP3-03 & ADR-003: Every order has a valid UUID customer Golden ID and rejects gid-* strings', () => {
      expect(CustomerGoldenIdSchema.safeParse(CUSTOMER_GOLDEN_ID_1).success).toBe(true);
      expect(
        CustomerGoldenIdSchema.safeParse('55555555-0003-4000-8000-000000000002').success
      ).toBe(true);
      expect(CustomerGoldenIdSchema.safeParse('').success).toBe(false);
      expect(CustomerGoldenIdSchema.safeParse('gid-cust-001').success).toBe(false);
      expect(CustomerGoldenIdSchema.safeParse('regular-user-id').success).toBe(false);
    });

    it('asserts BR-ERP3-02: Tax per line equals line amount multiplied by percentage tax_rate (4-dp canonical format, DR-1 pending)', () => {
      const result = calculateLineAmounts(10, '12.5000', '10.0000');
      expect(result.subtotal).toBe('125.0000');
      expect(result.tax_amount).toBe('12.5000');
      expect(result.line_total).toBe('137.5000');
    });

    it('asserts BR-ERP3-01: Line totals must equal the order total', () => {
      const lines = [{ line_total: '137.5000' }, { line_total: '262.5000' }];
      expect(validateOrderLineTotals(lines, '400.0000')).toBe(true);
      expect(validateOrderLineTotals(lines, '405.0000')).toBe(false);
    });

    it('asserts Invoice status derivation: Paid when full payment equals total', () => {
      const status = deriveInvoiceStatus('1375.0000', '1375.0000', '2026-11-23', '2026-10-23');
      expect(status).toBe('Paid');
    });

    it('asserts Invoice status derivation: Overdue when current UTC date > due date and unpaid', () => {
      const status = deriveInvoiceStatus('1375.0000', '0.0000', '2026-10-15', '2026-10-23');
      expect(status).toBe('Overdue');
    });

    it('asserts Invoice status derivation: Open when unpaid but not past due date', () => {
      const status = deriveInvoiceStatus('1375.0000', '0.0000', '2026-11-15', '2026-10-23');
      expect(status).toBe('Open');
    });
  });
});
