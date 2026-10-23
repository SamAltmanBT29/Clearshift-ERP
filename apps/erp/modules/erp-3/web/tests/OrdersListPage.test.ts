import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchSalesOrders,
  fetchInvoices,
  fetchPayments,
  createSalesOrder,
  createInvoice,
  createPayment,
  ApiError,
} from '../src/api/erp-3.js';
import {
  calculateLineAmounts,
  validateOrderLineTotals,
  deriveInvoiceStatus,
  CustomerGoldenIdSchema,
} from '@clearshift/contracts';

describe('ERP-3 Frontend API Client & View Logic Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchSalesOrders() and Query Construction', () => {
    it('constructs correct query params and returns paginated sales orders', async () => {
      const mockResponse = {
        items: [
          {
            id: 'so-1',
            orderNumber: 'SO-1001',
            customerGoldenId: 'gid-cust-001',
            orderDate: '2026-10-23',
            status: 'open',
            subtotal: '1000.00',
            taxTotal: '100.00',
            total: '1100.00',
            currencyCode: 'USD',
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
        search: 'SO-1001',
        status: 'open',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/erp-orders/sales-orders?page=1&pageSize=20&search=SO-1001&status=open',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        })
      );
      expect(result.items.length).toBe(1);
      expect(result.items[0]?.orderNumber).toBe('SO-1001');
    });

    it('formats query string properly with pagination and search parameters', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }),
      });

      await fetchSalesOrders({ page: 1, pageSize: 50, search: 'GID-CUST-001', status: 'invoiced' });
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/erp-orders/sales-orders?page=1&pageSize=50&search=GID-CUST-001&status=invoiced',
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
        items: [
          {
            id: 'inv-1',
            invoiceNumber: 'INV-2026-001',
            orderId: 'so-1',
            customerGoldenId: 'gid-cust-001',
            invoiceDate: '2026-10-23',
            dueDate: '2026-11-23',
            total: '1100.00',
            paidAmount: '0.00',
            currencyCode: 'USD',
            status: 'open',
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

      const result = await fetchInvoices({ page: 1, pageSize: 20, status: 'open' });
      expect(result.items.length).toBe(1);
      expect(result.items[0]?.status).toBe('open');
    });
  });

  describe('Domain Invariants: ERP-3 Sales Orders & Invoices', () => {
    it('asserts BR-ERP3-03: Every order has a valid customer Golden ID (case-insensitive)', () => {
      expect(CustomerGoldenIdSchema.safeParse('gid-cust-001').success).toBe(true);
      expect(CustomerGoldenIdSchema.safeParse('GID-CUST-001').success).toBe(true);
      expect(CustomerGoldenIdSchema.safeParse('Gid-12345').success).toBe(true);
      expect(CustomerGoldenIdSchema.safeParse('gid-12345').success).toBe(true);
      expect(CustomerGoldenIdSchema.safeParse('').success).toBe(false);
      expect(CustomerGoldenIdSchema.safeParse('regular-user-id').success).toBe(false);
    });

    it('asserts BR-ERP3-02: Tax per line equals line amount multiplied by product tax rate, rounded to 2 decimals', () => {
      const result = calculateLineAmounts(10, '12.50', '0.10');
      expect(result.subtotal).toBe('125.00');
      expect(result.taxAmount).toBe('12.50');
      expect(result.lineTotal).toBe('137.50');
    });

    it('asserts BR-ERP3-01: Line totals must equal the order total', () => {
      const lines = [
        { lineTotal: '137.50' },
        { lineTotal: '262.50' },
      ];
      expect(validateOrderLineTotals(lines, '400.00')).toBe(true);
      expect(validateOrderLineTotals(lines, '405.00')).toBe(false);
    });

    it('asserts Invoice status derivation: Paid when full payment equals total', () => {
      const status = deriveInvoiceStatus('1375.00', '1375.00', '2026-11-23', '2026-10-23');
      expect(status).toBe('paid');
    });

    it('asserts Invoice status derivation: Overdue when current UTC date > due date and unpaid', () => {
      const status = deriveInvoiceStatus('1375.00', '0.00', '2026-10-15', '2026-10-23');
      expect(status).toBe('overdue');
    });

    it('asserts Invoice status derivation: Open when unpaid but not past due date', () => {
      const status = deriveInvoiceStatus('1375.00', '0.00', '2026-11-15', '2026-10-23');
      expect(status).toBe('open');
    });
  });
});
