/**
 * ERP-1 Idempotency & Migration Target Adapter Test Suite
 *
 * Verifies Acceptance Criteria for:
 *   - Issue #12 (KIT-08 / Decision C4 / ERP1-07):
 *       1. Fixture row loaded via public API; Kit has no direct target DB write privilege.
 *       2. Retrying identical row payload/key 3 times produces exactly 1 business record and 1 durable receipt.
 *       3. Reusing key with different payload returns HTTP 409 Conflict and does not mutate data.
 *       4. Business-rule rejection returns stable reason code; simulated 503 is retryable and not recorded as rejected.
 *       5. Receipt, target mutation commit or roll back together atomically.
 *       6. SKU is unique in database; UPSERT flag enables updating existing records with kind='linked'.
 *       7. Preflight dry run (zero mutations) and batch runner 10% stop threshold.
 *   - Issue #107 (ERP1-11 / loadBatch UPSERT & durable receipt):
 *       AC1. Target adapter implements loadBatch executing type-safe UPSERT operations.
 *       AC2. Target record and durable import receipt commit atomically in one local database transaction.
 *       AC3. Import receipt stores batch_id, source_row, target_id, idempotency_key, and timestamp.
 *       AC4. Re-running the same source row with identical idempotency key returns existing receipt without duplication.
 *
 * @module erp1/tests/migration/idempotency.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ERP1_DOMAIN_RULES } from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import {
  ERP1_DEFAULT_CATEGORY_ID,
  InMemoryErp1Repository,
} from '../../src/services/repository.js';
import { Erp1Service } from '../../src/services/erp1.service.js';
import { Erp1TargetAdapter } from '../../src/migration/target-adapter.js';

const MIGRATION_HEADERS = {
  authorization: 'Bearer role:migration_runner',
};

describe('ERP-1 Migration Kit Adapter & Durable Import Receipts (Issues #12 & #107)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp1Repository;
  let service: Erp1Service;

  beforeEach(() => {
    repo = new InMemoryErp1Repository(true); // seeds default category & warehouse
    service = new Erp1Service({ repository: repo });
    app = buildApp({ repository: repo, erp1Service: service, authRequired: true });
  });

  describe('1. In-Process TargetAdapter (KIT-08 Contract & ERP1-07)', () => {
    it('executes preflight dry-run validation without mutating the database', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');

      const rows = [
        {
          name: 'Precision Gear A',
          sku: 'GEAR-001',
          unitOfMeasure: 'pcs',
          price: 49.99,
          currency: 'USD',
        },
        {
          name: 'Invalid Item Without SKU',
          sku: '',
          unitOfMeasure: 'pcs',
          price: 10.0,
        },
        {
          name: 'Invalid Unit Item',
          sku: 'GEAR-002',
          unitOfMeasure: 'barrels', // invalid UoM
          price: 15.0,
        },
      ];

      const res = await adapter.preflight('00000000-0000-4000-8000-000000000010', rows);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.validCount).toBe(1);
        expect(res.value.rejectCount).toBe(2);
      }

      // Assert zero database mutations occurred during preflight
      const { total } = await repo.listProducts({ page: 1, pageSize: 20 });
      expect(total).toBe(0);
    });

    it('commits target business record and durable receipt atomically', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = '00000000-0000-4000-8000-000000000010';
      const key = 'idem-prod-001';

      const res = await adapter.importRow(batchId, 0, key, {
        name: 'Precision Bearing',
        sku: 'BRG-100',
        categoryId: ERP1_DEFAULT_CATEGORY_ID,
        unitOfMeasure: 'pcs',
        price: '24.50',
        currency: 'USD',
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.targetId).toBeDefined();
        expect(res.value.receipt.idempotencyKey).toBe(key);
        expect(res.value.receipt.entity).toBe('product');
        expect(res.value.receipt.batchId).toBe(batchId);
        expect(res.value.receipt.kind).toBe('created');
        expect(res.value.receipt.createdAt).toBeInstanceOf(Date);
      }

      // Assert business row exists
      const created = await repo.getProductBySku('BRG-100');
      expect(created).not.toBeNull();
      expect(created?.name).toBe('Precision Bearing');

      // Assert receipt exists
      const receipt = await repo.getImportReceiptByKey(key);
      expect(receipt).not.toBeNull();
      expect(receipt?.targetId).toBe(created?.id);
      expect(receipt?.kind).toBe('created');
    });

    it('returns existing receipt on identical idempotency key replay without duplication (3x replay)', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = '00000000-0000-4000-8000-000000000010';
      const key = 'idem-replay-001';
      const payload = {
        name: 'Washer M8',
        sku: 'WASH-M8-001',
        unitOfMeasure: 'pcs',
        price: '0.15',
        currency: 'USD',
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
      }

      // 3rd attempt: idempotent replay
      const res3 = await adapter.importRow(batchId, 1, key, payload);
      expect(res3.ok).toBe(true);
      if (res3.ok) {
        expect(res3.value.priorResult).toBe(true);
        expect(res3.value.targetId).toBe(res1.ok ? res1.value.targetId : '');
      }

      // Exactly 1 product created
      const { total } = await repo.listProducts({});
      expect(total).toBe(1);
    });
  });

  describe('2. Public Import API & 3x Identical Retries', () => {
    it('retrying identical row payload and key 3 times produces exactly 1 business record and 1 durable receipt', async () => {
      const payload = {
        batch_id: '00000000-0000-4000-8000-000000000020',
        source_row: 1,
        source_system: 'legacy_erp',
        source_id: 'LEG-PROD-99',
        idempotency_key: 'key-prod-retry-test',
        entity: 'product',
        record: {
          name: 'Steel Rod 10mm',
          sku: 'ROD-10-MM',
          categoryId: ERP1_DEFAULT_CATEGORY_ID,
          unitOfMeasure: 'metre',
          price: 18.25,
          currency: 'USD',
        },
      };

      // Call 1 (Fresh load)
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: {
          ...MIGRATION_HEADERS,
          'idempotency-key': payload.idempotency_key,
        },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const data1 = JSON.parse(res1.payload);
      expect(data1.prior_result).toBe(false);
      expect(data1.target_id).toBeDefined();
      expect(data1.receipt.kind).toBe('created');

      // Call 2 (Replay 1)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: {
          ...MIGRATION_HEADERS,
          'idempotency-key': payload.idempotency_key,
        },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.payload);
      expect(data2.prior_result).toBe(true);
      expect(data2.target_id).toBe(data1.target_id);

      // Call 3 (Replay 2)
      const res3 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: {
          ...MIGRATION_HEADERS,
          'idempotency-key': payload.idempotency_key,
        },
        payload,
      });
      expect(res3.statusCode).toBe(200);
      const data3 = JSON.parse(res3.payload);
      expect(data3.prior_result).toBe(true);
      expect(data3.target_id).toBe(data1.target_id);

      // Verify repository contains exactly 1 product and 1 receipt
      const { items, total } = await repo.listProducts({ page: 1, pageSize: 20 });
      expect(total).toBe(1);
      expect(items[0]?.sku).toBe('ROD-10-MM');

      const receipt = await repo.getImportReceiptByKey(payload.idempotency_key);
      expect(receipt).not.toBeNull();
      expect(receipt?.targetId).toBe(data1.target_id);
    });

    it('requires authentication or ingestion capability', async () => {
      const payload = {
        batch_id: '00000000-0000-4000-8000-000000000021',
        source_row: 1,
        idempotency_key: 'key-auth-test',
        entity: 'product',
        record: {
          name: 'Brass Fitting',
          sku: 'FIT-BRASS-01',
          unitOfMeasure: 'pcs',
          price: 5.5,
          currency: 'USD',
        },
      };

      // No token -> 401
      const resNoAuth = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        payload,
      });
      expect(resNoAuth.statusCode).toBe(401);

      // Viewer token (no module.write / kit.run) -> 403
      const resViewer = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: { authorization: 'Bearer role:viewer' },
        payload,
      });
      expect(resViewer.statusCode).toBe(403);
    });
  });

  describe('3. Idempotency Key Reuse with Different Payload (409 Conflict)', () => {
    it('reusing an idempotency key with a different payload returns HTTP 409 and does not mutate data', async () => {
      const key = 'idem-conflict-test-01';

      const payload1 = {
        batch_id: '00000000-0000-4000-8000-000000000030',
        source_row: 1,
        idempotency_key: key,
        entity: 'product',
        record: {
          name: 'Original Part',
          sku: 'ORIG-PART-1',
          unitOfMeasure: 'pcs',
          price: 10.0,
          currency: 'USD',
        },
      };

      // Fresh load succeeds
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: MIGRATION_HEADERS,
        payload: payload1,
      });
      expect(res1.statusCode).toBe(201);

      // Reusing the same key with different payload (price changed from 10 to 99)
      const payload2 = {
        batch_id: '00000000-0000-4000-8000-000000000030',
        source_row: 1,
        idempotency_key: key,
        entity: 'product',
        record: {
          name: 'Tampered Part With Mismatched Price',
          sku: 'ORIG-PART-1',
          unitOfMeasure: 'pcs',
          price: 99.0,
          currency: 'USD',
        },
      };

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: MIGRATION_HEADERS,
        payload: payload2,
      });

      expect(res2.statusCode).toBe(409);
      const body2 = JSON.parse(res2.payload);
      expect(body2.code).toBe(ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT);

      // Verify the product was NOT mutated
      const product = await repo.getProductBySku('ORIG-PART-1');
      expect(product?.name).toBe('Original Part');
      expect(Number(product?.price)).toBe(10.0);
    });
  });

  describe('4. Business Rule Rejection vs Transient Failure (503)', () => {
    it('business rule rejection returns stable reason code and does not record a loaded receipt', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');

      const res = await adapter.importRow(
        '00000000-0000-4000-8000-000000000040',
        1,
        'key-invalid-price',
        {
          name: 'Negative Price Item',
          sku: 'NEG-001',
          unitOfMeasure: 'pcs',
          price: -5.0,
          currency: 'USD',
        }
      );

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.reasonCode).toBe('VALIDATION_ERROR');
        expect(res.error.message).toBeDefined();
      }

      // Assert no receipt was created
      const receipt = await repo.getImportReceiptByKey('key-invalid-price');
      expect(receipt).toBeNull();
    });

    it('simulated 503 transient error is retried and not classified as bad data rejection', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      let calls = 0;

      const originalImportRow = service.importRow.bind(service);
      service.importRow = async (req) => {
        calls++;
        if (calls < 3) {
          const err = new Error('Service Unavailable: upstream database connection pool exhausted');
          (err as any).statusCode = 503;
          (err as any).retryable = true;
          throw err;
        }
        return originalImportRow(req);
      };

      const batchRows = [
        {
          sourceRow: 1,
          idempotencyKey: 'idem-retry-503-key',
          data: {
            name: 'Resilient Part',
            sku: 'RESILIENT-01',
            unitOfMeasure: 'pcs',
            price: 33.0,
            currency: 'USD',
          },
        },
      ];

      const batchResult = await adapter.loadBatch(
        '00000000-0000-4000-8000-000000000050',
        batchRows,
        { initialDelayMs: 5, maxRetries: 3 }
      );

      expect(calls).toBe(3);
      expect(batchResult.status).toBe('COMPLETED');
      expect(batchResult.loaded).toBe(1);
      expect(batchResult.rejected).toBe(0);
      expect(batchResult.rows[0]?.attempts).toBe(3);
      expect(batchResult.rows[0]?.outcome).toBe('loaded');
    });
  });

  describe('5. Atomic Transaction Rollback', () => {
    it('rolls back target entity and durable receipt together on unexpected failure', async () => {
      const key = 'idem-rollback-test-key';

      const originalCreateReceipt = repo.createImportReceipt.bind(repo);
      repo.createImportReceipt = async () => {
        throw new Error('Simulated disk/database failure writing import receipt');
      };

      await expect(
        service.importRow({
          batch_id: '00000000-0000-4000-8000-000000000060',
          source_row: 1,
          idempotency_key: key,
          entity: 'product',
          record: {
            name: 'Atomic Rollback Widget',
            sku: 'ATOMIC-001',
            unitOfMeasure: 'pcs',
            price: 15.0,
            currency: 'USD',
          },
        })
      ).rejects.toThrow('Simulated disk/database failure writing import receipt');

      repo.createImportReceipt = originalCreateReceipt;

      const product = await repo.getProductBySku('ATOMIC-001');
      expect(product).toBeNull();

      const receipt = await repo.getImportReceiptByKey(key);
      expect(receipt).toBeNull();
    });
  });

  describe('6. Domain Rules, Entity Types & UPSERT Semantics', () => {
    it('rejects duplicate normalized SKU when upsert=false (BR-ERP1-01)', async () => {
      await service.createProduct({
        name: 'Initial Product',
        sku: 'WIDGET-ABC',
        unitOfMeasure: 'pcs',
        price: '10.00',
        currency: 'USD',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: MIGRATION_HEADERS,
        payload: {
          batch_id: '00000000-0000-4000-8000-000000000070',
          source_row: 1,
          idempotency_key: 'idem-dup-sku-no-upsert',
          entity: 'product',
          record: {
            name: 'Duplicate Widget',
            sku: '  widget-abc  ',
            unitOfMeasure: 'pcs',
            price: 20.0,
            currency: 'USD',
          },
          upsert: false,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe(ERP1_DOMAIN_RULES.SKU_DUPLICATE);
    });

    it('updates existing product with kind="linked" when upsert=true', async () => {
      const initial = await service.createProduct({
        name: 'Initial Product',
        sku: 'WIDGET-UPSERT',
        unitOfMeasure: 'pcs',
        price: '10.00',
        currency: 'USD',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: MIGRATION_HEADERS,
        payload: {
          batch_id: '00000000-0000-4000-8000-000000000071',
          source_row: 1,
          idempotency_key: 'idem-dup-sku-upsert-true',
          entity: 'product',
          upsert: true,
          record: {
            name: 'Updated Product Name via Upsert',
            sku: 'widget-upsert',
            unitOfMeasure: 'box',
            price: 15.5,
            currency: 'USD',
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.target_id).toBe(initial.id);
      expect(body.receipt.kind).toBe('linked');

      const updated = await repo.getProductById(initial.id);
      expect(updated?.name).toBe('Updated Product Name via Upsert');
      expect(updated?.unitOfMeasure).toBe('box');
      expect(Number(updated?.price)).toBe(15.5);
    });

    it('imports category entity with upsert support', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: MIGRATION_HEADERS,
        payload: {
          batch_id: '00000000-0000-4000-8000-000000000072',
          source_row: 1,
          idempotency_key: 'idem-cat-01',
          entity: 'category',
          record: {
            name: 'Power Tools',
            code: 'PWR-TOOLS',
          },
        },
      });
      expect(res1.statusCode).toBe(201);
      const data1 = JSON.parse(res1.payload);
      expect(data1.receipt.kind).toBe('created');

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: MIGRATION_HEADERS,
        payload: {
          batch_id: '00000000-0000-4000-8000-000000000072',
          source_row: 2,
          idempotency_key: 'idem-cat-02',
          entity: 'category',
          upsert: true,
          record: {
            name: 'Heavy Power Tools',
            code: 'PWR-TOOLS',
          },
        },
      });
      expect(res2.statusCode).toBe(201);
      const data2 = JSON.parse(res2.payload);
      expect(data2.target_id).toBe(data1.target_id);
      expect(data2.receipt.kind).toBe('linked');

      const cat = await repo.getCategoryByCode('PWR-TOOLS');
      expect(cat?.name).toBe('Heavy Power Tools');
    });

    it('imports stock_level entity into default warehouse and enforces non-negative stock (BR-ERP1-02)', async () => {
      const prod = await service.createProduct({
        name: 'Stock Item',
        sku: 'STOCK-001',
        unitOfMeasure: 'pcs',
        price: '5.00',
        currency: 'USD',
      });

      const resValid = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: MIGRATION_HEADERS,
        payload: {
          batch_id: '00000000-0000-4000-8000-000000000073',
          source_row: 1,
          idempotency_key: 'idem-stock-01',
          entity: 'stock_level',
          record: {
            productId: prod.id,
            quantity: '150.00',
          },
        },
      });
      expect(resValid.statusCode).toBe(201);
      const dataValid = JSON.parse(resValid.payload);
      expect(dataValid.target_id).toBeDefined();

      const resNeg = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import',
        headers: MIGRATION_HEADERS,
        payload: {
          batch_id: '00000000-0000-4000-8000-000000000073',
          source_row: 2,
          idempotency_key: 'idem-stock-neg',
          entity: 'stock_level',
          record: {
            productId: prod.id,
            quantity: '-10.00',
          },
        },
      });
      expect(resNeg.statusCode).toBe(422);
      const bodyNeg = JSON.parse(resNeg.payload);
      expect(bodyNeg.code).toBe(ERP1_DOMAIN_RULES.NEGATIVE_STOCK);
    });
  });

  describe('7. Batch Runner Chunking & 10% Failure Rate Stop Threshold', () => {
    it('processes batch in sequential chunks via POST /api/v1/erp-products/import/batch', async () => {
      const rows = Array.from({ length: 15 }, (_, i) => ({
        source_row: i,
        idempotency_key: `batch-row-key-${i}`,
        record: {
          name: `Batch Item ${i}`,
          sku: `BATCH-SKU-${i}`,
          unitOfMeasure: 'pcs',
          price: (10 + i).toFixed(2),
          currency: 'USD',
        },
      }));

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import/batch',
        headers: MIGRATION_HEADERS,
        payload: {
          batch_id: '00000000-0000-4000-8000-000000000080',
          entity: 'product',
          chunk_size: 5,
          rows,
        },
      });

      expect(res.statusCode).toBe(200);
      const result = JSON.parse(res.payload);
      expect(result.status).toBe('COMPLETED');
      expect(result.total).toBe(15);
      expect(result.loaded).toBe(15);
      expect(result.rejected).toBe(0);
      expect(result.chunksProcessed).toBe(3);
    });

    it('halts batch execution immediately when failure rate exceeds 10% after min attempted rows', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');

      const rows = [
        ...Array.from({ length: 9 }, (_, i) => ({
          sourceRow: i,
          idempotencyKey: `halt-valid-${i}`,
          data: {
            name: `Halt Test Item ${i}`,
            sku: `HALT-SKU-${i}`,
            unitOfMeasure: 'pcs',
            price: 10.0,
            currency: 'USD',
          },
        })),
        {
          sourceRow: 9,
          idempotencyKey: 'halt-invalid-1',
          data: { name: 'Invalid 1', sku: '', unitOfMeasure: 'pcs', price: 10.0 },
        },
        {
          sourceRow: 10,
          idempotencyKey: 'halt-invalid-2',
          data: { name: 'Invalid 2', sku: '', unitOfMeasure: 'pcs', price: 10.0 },
        },
        ...Array.from({ length: 5 }, (_, i) => ({
          sourceRow: 11 + i,
          idempotencyKey: `halt-unattempted-${i}`,
          data: {
            name: `Should Not Be Attempted ${i}`,
            sku: `UNATTEMPTED-${i}`,
            unitOfMeasure: 'pcs',
            price: 10.0,
            currency: 'USD',
          },
        })),
      ];

      const res = await adapter.loadBatch(
        '00000000-0000-4000-8000-000000000090',
        rows,
        {
          chunkSize: 10,
          failureThreshold: 0.10,
          minAttemptedRows: 10,
        }
      );

      expect(res.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(res.stoppedReason).toContain('exceeded');
      expect(res.loaded).toBe(9);
      expect(res.rejected).toBe(2);
      expect(res.unattempted).toBe(5);
      expect(res.total).toBe(16);
      expect(res.attempted).toBe(11);
    });

    it('loadBatch error isolation: data-validation failure on row N does not abort subsequent valid rows', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = '00000000-0000-4000-8000-000000000020';

      const rows = [
        {
          sourceRow: 0,
          idempotencyKey: 'iso-batch-row-0',
          data: { name: 'Batch Item 1', sku: 'BATCH-ISO-001', unitOfMeasure: 'pcs', price: '1.00', currency: 'USD' },
        },
        {
          sourceRow: 1,
          idempotencyKey: 'iso-batch-row-1',
          data: { name: 'Batch Item 2', sku: 'BATCH-ISO-002', unitOfMeasure: 'kg', price: '12.50', currency: 'USD' },
        },
        {
          sourceRow: 2,
          idempotencyKey: 'iso-batch-row-2',
          data: { name: 'Invalid Item', sku: '', unitOfMeasure: 'pcs', price: '-1' },
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
  });
});
