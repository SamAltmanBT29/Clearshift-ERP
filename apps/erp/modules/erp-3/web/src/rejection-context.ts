/**
 * ERP-3 Sales Orders & Invoices — Web Rejection Context (KIT-16 / ERP3-23)
 *
 * Configures client-side module context for the shared RejectionReviewScreen.
 *
 * @module erp3/web/rejection-context
 */

import type { RejectedRow } from '@cs/kit';

export {
  erp3OrdersRejectionContext,
  erp3InvoicesRejectionContext,
  erp3FailureExplanations,
} from '../../src/kit/rejection-context.js';

/**
 * Synthetic mock rejected rows for preview, simulator, and testing.
 * Contains 100% synthetic fixtures demonstrating:
 * - Duplicate Order Number error (BR-ERP3-01 / FR-ERP3-01)
 * - Missing Customer Golden ID error (BR-ERP3-03 / ADR-003)
 * - Invalid Order Status lifecycle error (FR-ERP3-05)
 * - Negative Line Quantity error (BR-ERP3-01)
 * - Sensitive financial / bank details (bank_account_number, tax_id) that must be masked (AC3)
 * - Potential formula injection strings neutralized by formula-safe export (AC4)
 */
export const SYNTHETIC_ERP3_REJECTIONS: readonly RejectedRow[] = [
  {
    id: 'rej_so_01',
    batchId: 'BATCH_2026_01',
    sourceRow: 4,
    entity: 'sales_orders',
    errorCode: 'DUPLICATE_ORDER_NUMBER',
    failureReason: 'Order number SO-2026-0001 already exists in active order database',
    field: 'order_number',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      order_number: 'SO-2026-0001',
      customer_golden_id: '55555555-0003-4000-8000-000000000001',
      source_id: 'LEG_ORD_1001',
      currency: 'USD',
      order_date: '2026-10-24',
      status: 'Open',
      total: '1200.00',
      notes: 'Standard delivery',
      // Sensitive financial details in raw payload:
      bank_account_number: '123456789012',
      tax_id: '999-88-7777',
      salary: 95000,
    },
  },
  {
    id: 'rej_so_02',
    batchId: 'BATCH_2026_01',
    sourceRow: 12,
    entity: 'sales_orders',
    errorCode: 'MISSING_CUSTOMER_GOLDEN_ID',
    failureReason: 'Customer reference could not be mapped to a canonical CRM-1 Golden ID',
    field: 'customer_golden_id',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      order_number: 'SO-2026-0002',
      customer_golden_id: '',
      source_id: 'LEG_ORD_1002',
      currency: 'EUR',
      order_date: '2026-10-24',
      status: 'Open',
      total: '450.00',
      iban: 'GB29NWBK60161331926819',
    },
  },
  {
    id: 'rej_so_03',
    batchId: 'BATCH_2026_01',
    sourceRow: 19,
    entity: 'sales_orders',
    errorCode: 'INVALID_ORDER_STATUS',
    failureReason: 'Order status "Archived" is not in approved forward-only lifecycle (Open, Invoiced, Closed)',
    field: 'status',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      order_number: 'SO-2026-0003',
      customer_golden_id: '55555555-0003-4000-8000-000000000002',
      source_id: 'LEG_ORD_1003',
      currency: 'USD',
      order_date: '2026-10-24',
      status: 'Archived',
      total: '890.00',
      routing_number: '021000021',
      account_number: '9876543210',
    },
  },
  {
    id: 'rej_so_04',
    batchId: 'BATCH_2026_01',
    sourceRow: 27,
    entity: 'sales_orders',
    errorCode: 'NEGATIVE_QUANTITY',
    failureReason: 'Ordered quantity -5.0000 is negative or zero',
    field: 'quantity',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      order_number: 'SO-2026-0004',
      customer_golden_id: '55555555-0003-4000-8000-000000000003',
      source_id: 'LEG_ORD_1004',
      currency: 'USD',
      order_date: '2026-10-24',
      status: 'Open',
      quantity: '-5.0000',
      total: '-250.00',
      ssn: '123-45-6789',
    },
  },
  {
    id: 'rej_so_05',
    batchId: 'BATCH_2026_01',
    sourceRow: 38,
    entity: 'sales_orders',
    errorCode: 'DUPLICATE_ORDER_NUMBER',
    failureReason: 'Order number =cmd|’ /C calc’!A0 already exists',
    field: 'order_number',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      order_number: '=cmd|’ /C calc’!A0', // Potential formula injection cell
      customer_golden_id: '55555555-0003-4000-8000-000000000004',
      source_id: '@HYPERLINK("http://attacker.synthetic")',
      notes: '+SUM(1,2) Expedited Priority',
      currency: 'USD',
      order_date: '2026-10-24',
      status: 'Open',
      total: '99.00',
    },
  },
];
