/**
 * ERP-1 Products & Inventory — Web Rejection Context (ERP1-23)
 *
 * Configures client-side module context for the shared RejectionReviewScreen.
 *
 * @module erp1/web/rejection-context
 */

import type { ModuleRejectionContext, RejectedRow } from '@cs/kit';

export {
  erp1ProductsRejectionContext,
  erp1FailureExplanations,
} from '../../src/kit/rejection-context.js';

/**
 * Synthetic mock rejected rows for preview, simulator, and testing.
 * Contains 100% synthetic fixtures demonstrating:
 * - Duplicate SKU error (BR-ERP1-01)
 * - Invalid Unit of Measure error (FR-ERP1-04)
 * - Negative Price error (FR-ERP1-02)
 * - Invalid Tax Rate error (FR-ERP1-02)
 * - Sensitive financial / bank details (bank_account_number, tax_id) that must be masked (AC3)
 * - Potential formula injection strings neutralized by formula-safe export (AC4)
 */
export const SYNTHETIC_ERP1_REJECTIONS: readonly RejectedRow[] = [
  {
    id: 'rej_p01',
    batchId: 'BATCH_2026_01',
    sourceRow: 4,
    entity: 'products',
    errorCode: 'DUPLICATE_SKU',
    failureReason: 'SKU WIDGET-001 already exists in active product catalog',
    field: 'sku',
    createdAt: '2026-10-23T14:30:00Z',
    rawData: {
      sku: 'WIDGET-001',
      name: 'Steel Industrial Precision Widget M8',
      sourceId: 'LEGACY_P_1001',
      categoryCode: 'FASTENERS',
      unitOfMeasure: 'pcs',
      price: '14.50',
      taxRate: '0.1800',
      // Sensitive financial details in raw payload:
      bank_account_number: '123456789012',
      tax_id: '999-88-7777',
      salary: 95000,
    },
  },
  {
    id: 'rej_p02',
    batchId: 'BATCH_2026_01',
    sourceRow: 12,
    entity: 'products',
    errorCode: 'INVALID_UNIT_OF_MEASURE',
    failureReason: 'Unit of measure "litres_us" not in fixed V1 list',
    field: 'unitOfMeasure',
    createdAt: '2026-10-23T14:30:00Z',
    rawData: {
      sku: 'FLUID-CHEM-40',
      name: 'Synthetic Hydraulic Fluid Ultra-Grade',
      sourceId: 'LEGACY_P_1002',
      categoryCode: 'CHEMICALS',
      unitOfMeasure: 'litres_us',
      price: '185.00',
      taxRate: '0.1200',
      iban: 'GB29NWBK60161331926819',
    },
  },
  {
    id: 'rej_p03',
    batchId: 'BATCH_2026_01',
    sourceRow: 19,
    entity: 'products',
    errorCode: 'NEGATIVE_PRICE',
    failureReason: 'Product price -25.00 is negative',
    field: 'price',
    createdAt: '2026-10-23T14:30:00Z',
    rawData: {
      sku: 'HOSE-FLEX-20M',
      name: 'Reinforced Rubber Air Hose 20m',
      sourceId: 'LEGACY_P_1003',
      categoryCode: 'PNEUMATICS',
      unitOfMeasure: 'metre',
      price: '-25.00',
      taxRate: '0.1800',
      routing_number: '021000021',
      account_number: '9876543210',
    },
  },
  {
    id: 'rej_p04',
    batchId: 'BATCH_2026_01',
    sourceRow: 27,
    entity: 'products',
    errorCode: 'INVALID_TAX_RATE',
    failureReason: 'Tax rate 18.00 exceeds maximum allowable decimal value 1.0000',
    field: 'taxRate',
    createdAt: '2026-10-23T14:30:00Z',
    rawData: {
      sku: 'PUMP-DIAPH-01',
      name: 'Pneumatic Diaphragm Pump 1/2-inch',
      sourceId: 'LEGACY_P_1004',
      categoryCode: 'PUMPS',
      unitOfMeasure: 'pcs',
      price: '420.00',
      taxRate: '18.00', // Should be 0.1800
      ssn: '123-45-6789',
    },
  },
  {
    id: 'rej_p05',
    batchId: 'BATCH_2026_01',
    sourceRow: 38,
    entity: 'products',
    errorCode: 'DUPLICATE_SKU',
    failureReason: 'SKU =cmd|’ /C calc’!A0 already exists',
    field: 'sku',
    createdAt: '2026-10-23T14:30:00Z',
    rawData: {
      sku: '=cmd|’ /C calc’!A0', // Potential formula injection cell
      name: '+SUM(1,2) Valve Body Special',
      sourceId: 'LEGACY_P_1005',
      categoryCode: 'VALVES',
      unitOfMeasure: 'box',
      price: '89.50',
      taxRate: '0.0500',
    },
  },
];
