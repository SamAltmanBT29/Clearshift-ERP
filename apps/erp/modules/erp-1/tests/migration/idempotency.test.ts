/**
 * ERP-1 Idempotency & Migration Target Adapter Test Suite
 *
 * Verifies Acceptance Criteria for Issue #107 (ERP1-11 / loadBatch UPSERT & durable receipt):
 *   AC1. Target adapter implements loadBatch executing type-safe UPSERT operations.
 *   AC2. Target record and durable import receipt commit atomically in one local database transaction.
 *   AC3. Import receipt stores batch_id, source_row, target_id, idempotency_key, and timestamp.
 *   AC4. Re-running the same source row with identical idempotency key returns existing receipt without duplication.
 *
 * Also verifies:
 *   - Preflight validation (dry run, zero writes).
 *   - Idempotency key payload mismatch returns 409 Conflict.
 *   - Single row import via HTTP POST /api/v1/erp-products/import.
 *   - Batch import via HTTP POST /api/v1/erp-products/import/batch.
 *
 * @module erp1/tests/migration/idempotency.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemoryErp1Repository } from '../../src/services/repository.js';
import { Erp1Service } from '../../src/services/erp1.service.js';
import { Erp1TargetAdapter } from '../../src/migration/target-adapter.js';

describe('ERP-1 Migration Kit Adapter & Durable Import Receipts (Issue #107 / ERP1-11)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp1Repository;
  let service: Erp1Service;

  beforeEach(() => {
    repo = new InMemoryErp1Repository();
    service = new Erp1Service(repo);
    app = buildApp({ repository: repo, erp1Service: service, authRequired: false });
  });

  describe('1. In-Process TargetAdapter (KIT-08 Contract & ERP1-11)', () => {
    it('executes preflight dry-run validation without mutating the database', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');

      const rows = [
        {
          name: 'Steel Bolt M8',
          sku: 'BOLT-M8-001',
          unitOfMeasure: 'pcs',
          price: '2.50',
        },
        {
          name: 'Invalid Product',
          sku: '',
          unitOfMeasure: 'invalid_uom',
          price: '-5.00',
        },
      ];

      const res = await adapter.preflight('00000000-0000-0000-0000-000000000001', rows);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.validCount).toBe(1);
        expect(res.value.rejectCount).toBe(1);
      }

      // Assert no database mutation occurred during dry-run
      const { total } = await repo.listProducts({});
      expect(total).toBe(0);
    });

    it('commits target business record and durable receipt atomically', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = '00000000-0000-0000-0000-000000000010';
      const key = 'idem-product-001';

      const res = await adapter.importRow(batchId, 0, key, {
        name: 'Hex Nut M8',
        sku: 'NUT-M8-001',
        unitOfMeasure: 'pcs',
        price: '0.85',
        currency: 'USD',
        taxRate: '10.00',
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.targetId).toBeDefined();
        expect(res.value.receipt.idempotencyKey).toBe(key);
        expect(res.value.receipt.entity).toBe('product');
        expect(res.value.receipt.batchId).toBe(batchId);
        expect(res.value.receipt.sourceRow).toBe(0);
        expect(res.value.receipt.kind).toBe('created');
        expect(res.value.receipt.createdAt).toBeInstanceOf(Date);
      }

      // Verify product was persisted
      const product = await repo.getProductByNormalizedSku('NUT-M8-001');
      expect(product).not.toBeNull();
      expect(product?.name).toBe('Hex Nut M8');

      // Verify receipt was persisted in repo
      const receipt = await repo.getImportReceiptByKey(key);
      expect(receipt).not.toBeNull();
      expect(receipt?.targetId).toBe(product?.id);
    });

    it('returns existing receipt on identical idempotency key replay without duplication (3x replay)', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = '00000000-0000-0000-0000-000000000010';
      const key = 'idem-replay-001';
      const payload = {
        name: 'Washer M8',
        sku: 'WASH-M8-001',
        unitOfMeasure: 'pcs',
        price: '0.15',
      };

      // 1st attempt: fresh creation
      const res1 = await adapter.importRow(batchId, 1, key, payload);
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.value.priorResult).toBe(false);
      }

      // 2nd attempt: idempotent replay
      const res2 = await adapter.importRow(batchId, 1, key, payload);
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value.priorResult).toBe(true);
        if (res1.ok) {
          expect(res2.value.targetId).toBe(res1.value.targetId);
        }
      }

      // 3rd attempt: idempotent replay
      const res3 = await adapter.importRow(batchId, 1, key, payload);
      expect(res3.ok).toBe(true);
      if (res3.ok) {
        expect(res3.value.priorResult).toBe(true);
      }

      // Exactly 1 product and 1 receipt in repository
      const { total } = await repo.listProducts({});
      expect(total).toBe(1);
    });

    it('rejects idempotency key reuse with different payload (409 Conflict)', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = '00000000-0000-0000-0000-000000000010';
      const key = 'idem-reuse-conflict';

      const res1 = await adapter.importRow(batchId, 0, key, {
        name: 'Item A',
        sku: 'SKU-AAA',
        unitOfMeasure: 'pcs',
        price: '10.00',
      });
      expect(res1.ok).toBe(true);

      // Attempt reuse with different payload
      const res2 = await adapter.importRow(batchId, 0, key, {
        name: 'Item B (Changed)',
        sku: 'SKU-BBB',
        unitOfMeasure: 'kg',
        price: '20.00',
      });

      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.error.reasonCode).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
      }
    });

    it('updates in-place with kind=linked when upsert=true on matching normalized SKU', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = '00000000-0000-0000-0000-000000000010';

      // First create initial product
      const res1 = await adapter.importRow(batchId, 0, 'key-orig-1', {
        name: 'Initial Product',
        sku: 'SKU-UPSERT-01',
        unitOfMeasure: 'box',
        price: '50.00',
      });
      expect(res1.ok).toBe(true);
      const originalId = res1.ok ? res1.value.targetId : '';

      // Second import with upsert=true: matching normalized SKU, updated name & price
      const res2 = await adapter.importRow(
        batchId,
        1,
        'key-upsert-2',
        {
          name: 'Updated Product Name',
          sku: 'sku-upsert-01', // lowercase normalized match
          unitOfMeasure: 'box',
          price: '55.00',
        },
        { upsert: true }
      );

      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value.targetId).toBe(originalId);
        expect(res2.value.receipt.kind).toBe('linked');
      }

      // Total products remains 1
      const { total } = await repo.listProducts({});
      expect(total).toBe(1);

      const updated = await repo.getProductById(originalId);
      expect(updated?.name).toBe('Updated Product Name');
      expect(updated?.price).toBe('55.00');
    });
  });

  describe('2. Batch Execution via loadBatch (ERP1-11)', () => {
    it('processes a batch of rows collecting individual outcomes and receipts', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = '00000000-0000-0000-0000-000000000020';

      const rows = [
        {
          sourceRow: 0,
          idempotencyKey: 'batch-row-0',
          data: { name: 'Batch Item 1', sku: 'BATCH-001', unitOfMeasure: 'pcs', price: '1.00' },
        },
        {
          sourceRow: 1,
          idempotencyKey: 'batch-row-1',
          data: { name: 'Batch Item 2', sku: 'BATCH-002', unitOfMeasure: 'kg', price: '12.50' },
        },
        {
          sourceRow: 2,
          idempotencyKey: 'batch-row-2',
          data: { name: 'Invalid Item', sku: '', unitOfMeasure: 'pcs', price: '-1' }, // Rejected
        },
      ];

      const result = await adapter.loadBatch(batchId, rows, { minAttemptedRows: 10 });
      expect(result.status).toBe('COMPLETED');
      expect(result.total).toBe(3);
      expect(result.loaded).toBe(2);
      expect(result.rejected).toBe(1);
      expect(result.unattempted).toBe(0);

      expect(result.rows[0]?.outcome).toBe('loaded');
      expect(result.rows[1]?.outcome).toBe('loaded');
      expect(result.rows[2]?.outcome).toBe('rejected');
    });

    it('loadBatch replays already-committed rows without creating duplicate entities', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = '00000000-0000-0000-0000-000000000030';

      const rows = [
        {
          sourceRow: 0,
          idempotencyKey: 'batch-idem-0',
          data: { name: 'Replay 1', sku: 'RPL-01', unitOfMeasure: 'box', price: '99.00' },
        },
      ];

      // Run 1
      const res1 = await adapter.loadBatch(batchId, rows);
      expect(res1.loaded).toBe(1);
      expect(res1.rows[0]?.priorResult).toBe(false);

      // Run 2: same batch and rows
      const res2 = await adapter.loadBatch(batchId, rows);
      expect(res2.loaded).toBe(1);
      expect(res2.rows[0]?.priorResult).toBe(true);

      const { total } = await repo.listProducts({});
      expect(total).toBe(1);
    });
  });

  describe('3. Public HTTP Routes (/api/v1/erp-products/import and /batch)', () => {
    it('POST /import creates a product with 201 and durable receipt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: { 'idempotency-key': 'http-import-001' },
        payload: {
          batch_id: '00000000-0000-0000-0000-000000000040',
          source_row: 0,
          entity: 'product',
          record: {
            name: 'API Product 1',
            sku: 'API-PROD-01',
            unitOfMeasure: 'pcs',
            price: '15.00',
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.target_id).toBeDefined();
      expect(body.outcome).toBe('loaded');
      expect(body.prior_result).toBe(false);
      expect(body.receipt.idempotency_key).toBe('http-import-001');

      // Replay returns HTTP 200
      const replayResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: { 'idempotency-key': 'http-import-001' },
        payload: {
          batch_id: '00000000-0000-0000-0000-000000000040',
          source_row: 0,
          entity: 'product',
          record: {
            name: 'API Product 1',
            sku: 'API-PROD-01',
            unitOfMeasure: 'pcs',
            price: '15.00',
          },
        },
      });

      expect(replayResponse.statusCode).toBe(200);
      const replayBody = JSON.parse(replayResponse.body);
      expect(replayBody.prior_result).toBe(true);
      expect(replayBody.target_id).toBe(body.target_id);
    });

    it('POST /import/batch executes batch import with UPSERT', async () => {
      const batchPayload = {
        batch_id: 'a5000000-0000-4000-8000-000000000050',
        entity: 'product',
        upsert: true,
        rows: [
          {
            source_row: 0,
            idempotency_key: 'http-batch-001',
            record: {
              name: 'Batch Product A',
              sku: 'HTTP-B-001',
              unitOfMeasure: 'pcs',
              price: '10.00',
            },
          },
          {
            source_row: 1,
            idempotency_key: 'http-batch-002',
            record: {
              name: 'Batch Product B',
              sku: 'HTTP-B-002',
              unitOfMeasure: 'metre',
              price: '5.50',
            },
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import/batch',
        payload: batchPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('COMPLETED');
      expect(body.total).toBe(2);
      expect(body.loaded).toBe(2);
      expect(body.rejected).toBe(0);
    });
  });
});
