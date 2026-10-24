/**
 * ERP-2 Vendors & Purchasing — Web Rejection Context (KIT-16 / ERP2-23)
 *
 * Configures client-side module context for the shared RejectionReviewScreen.
 *
 * @module erp2/web/rejection-context
 */

import type { RejectedRow } from '@cs/kit';

export {
  erp2VendorsRejectionContext,
  erp2PurchaseOrdersRejectionContext,
  erp2FailureExplanations,
} from '../../src/kit/rejection-context.js';

/**
 * Synthetic mock rejected rows for preview, simulator, and testing.
 * Contains 100% synthetic fixtures demonstrating:
 * - Duplicate Tax Number error (BR-ERP2-01)
 * - Invalid PO Status lifecycle error (FR-ERP2-04)
 * - Negative Line Quantity error (FR-ERP2-03 / BR-ERP2-03)
 * - Unresolved Vendor Reference error (FR-ERP2-03)
 * - Sensitive financial / bank details (bank_account, bank_masked, tax_id) that must be masked (AC3)
 * - Potential formula injection strings neutralized by formula-safe export (AC4)
 */
export const SYNTHETIC_ERP2_REJECTIONS: readonly RejectedRow[] = [
  {
    id: 'rej_v01',
    batchId: 'BATCH_ERP2_2026_01',
    sourceRow: 5,
    entity: 'vendors',
    errorCode: 'DUPLICATE_TAX_NUMBER',
    failureReason: 'Tax number TAX-ACME-9901 already exists in active vendor catalog',
    field: 'tax_number',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      tax_number: 'TAX-ACME-9901',
      name: 'Acme Industrial Supplies Ltd',
      source_id: 'VEND-8821',
      currency: 'USD',
      email: 'procurement@acme.synthetic',
      phone: '+1-555-0199',
      country: 'USA',
      // Sensitive financial details in raw payload:
      bank_account: '123456789012',
      tax_id: '999-88-7777',
      salary: 95000,
    },
  },
  {
    id: 'rej_v02',
    batchId: 'BATCH_ERP2_2026_01',
    sourceRow: 11,
    entity: 'vendors',
    errorCode: 'MISSING_REQUIRED_FIELD',
    failureReason: 'Required field "email" is missing or blank (FR-ERP2-01)',
    field: 'email',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      tax_number: 'TAX-GLOBEX-0042',
      name: 'Globex Components GmbH',
      source_id: 'VEND-0042',
      currency: 'EUR',
      email: '',
      phone: '+49-30-9000111',
      country: 'Germany',
      iban: 'DE89370400440532013000',
    },
  },
  {
    id: 'rej_po01',
    batchId: 'BATCH_ERP2_2026_01',
    sourceRow: 19,
    entity: 'purchase_orders',
    errorCode: 'INVALID_PO_STATUS',
    failureReason: 'PO status "Archived" is not in approved unidirectional lifecycle (Draft, Sent, Received, Closed)',
    field: 'status',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      po_number: 'PO-2026-0003',
      vendor_id: 'a1111111-1111-4111-8111-111111111111',
      source_id: 'PO-90021',
      currency: 'USD',
      order_date: '2026-10-20',
      status: 'Archived',
      total: '890.00',
      routing_number: '021000021',
      account_number: '9876543210',
    },
  },
  {
    id: 'rej_po02',
    batchId: 'BATCH_ERP2_2026_01',
    sourceRow: 27,
    entity: 'purchase_orders',
    errorCode: 'NEGATIVE_QUANTITY',
    failureReason: 'PO line quantity -5.0000 is negative or zero',
    field: 'quantity',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      po_number: 'PO-2026-0004',
      vendor_id: 'a1111111-1111-4111-8111-111111111112',
      source_id: 'PO-90022',
      currency: 'USD',
      order_date: '2026-10-21',
      status: 'Draft',
      quantity: '-5.0000',
      total: '-250.00',
      ssn: '123-45-6789',
    },
  },
  {
    id: 'rej_po03',
    batchId: 'BATCH_ERP2_2026_01',
    sourceRow: 38,
    entity: 'purchase_orders',
    errorCode: 'DUPLICATE_PO_NUMBER',
    failureReason: "PO number =cmd|' /C calc'!A0 already exists",
    field: 'po_number',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      po_number: "=cmd|' /C calc'!A0", // Potential formula injection cell
      vendor_id: 'a1111111-1111-4111-8111-111111111113',
      source_id: '@HYPERLINK("http://attacker.synthetic")',
      notes: '+SUM(1,2) Expedited Priority',
      currency: 'USD',
      order_date: '2026-10-22',
      status: 'Draft',
      total: '99.00',
    },
  },
];
