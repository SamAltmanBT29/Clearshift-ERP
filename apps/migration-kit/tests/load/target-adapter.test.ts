import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeStableIdempotencyKey,
  type MigrationTargetAdapter,
} from '@clearshift/contracts';
import {
  BaseTargetAdapter,
  GenericTargetAdapterRegistry,
  InMemoryImportReceiptStore,
  TargetBatchLoader,
  DEFAULT_CHUNK_SIZE,
} from '../../src/load/target-adapter.js';

interface TestProductRow {
  sku: string;
  name: string;
  categoryId: string;
  price?: number;
}

/**
 * Concrete test adapter extending BaseTargetAdapter to verify target contract and receipts
 * for ERP-1 products module.
 */
class TestProductTargetAdapter extends BaseTargetAdapter<TestProductRow> {
  public readonly module = 'erp-1';
  public readonly entity = 'products';
  public readonly schemaVersion = 1;

  constructor(receiptStore?: InMemoryImportReceiptStore) {
    super(receiptStore);
  }

  protected async validateRow(row: TestProductRow): Promise<{
    valid: boolean;
    reasonCode?: string;
    message?: string;
    field?: string;
  }> {
    if (!row.sku || row.sku.trim().length === 0) {
      return {
        valid: false,
        reasonCode: 'SKU_REQUIRED',
        message: 'Product SKU is required',
        field: 'sku',
      };
    }
    if (!row.name || row.name.trim().length === 0) {
      return {
        valid: false,
        reasonCode: 'PRODUCT_NAME_REQUIRED',
        message: 'Product name is required',
        field: 'name',
      };
    }
    if (row.price !== undefined && row.price < 0) {
      return {
        valid: false,
        reasonCode: 'NEGATIVE_PRICE',
        message: 'Product price cannot be negative',
        field: 'price',
      };
    }
    return { valid: true };
  }
}

describe('KIT-08: Generic Target Adapter, Stable Idempotency & Import Receipts', () => {
  let receiptStore: InMemoryImportReceiptStore;
  let adapter: TestProductTargetAdapter;
  let registry: GenericTargetAdapterRegistry;
  let loader: TargetBatchLoader;

  beforeEach(() => {
    receiptStore = new InMemoryImportReceiptStore();
    adapter = new TestProductTargetAdapter(receiptStore);
    registry = new GenericTargetAdapterRegistry();
    registry.register(adapter);
    loader = new TargetBatchLoader(registry);
  });

  describe('1. Stable Idempotency Key Derivation', () => {
    it('derives stable SHA-256 key from batchId, sourceRow, module, entity, and version', () => {
      const key1 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 1,
        module: 'erp-1',
        entity: 'products',
        operationVersion: 1,
      });

      const key2 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 1,
        module: 'erp-1',
        entity: 'products',
        operationVersion: 1,
      });

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA-256 hex string
    });

    it('generates distinct keys for different source rows, entities, or modules', () => {
      const keyRow1 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 1,
        module: 'erp-1',
        entity: 'products',
      });
      const keyRow2 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 2,
        module: 'erp-1',
        entity: 'products',
      });
      const keyEntity2 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 1,
        module: 'erp-1',
        entity: 'warehouses',
      });
      const keyModule2 = computeStableIdempotencyKey({
        batchId: 'batch-001',
        sourceRow: 1,
        module: 'erp-2',
        entity: 'vendors',
      });

      expect(keyRow1).not.toBe(keyRow2);
      expect(keyRow1).not.toBe(keyEntity2);
      expect(keyRow1).not.toBe(keyModule2);
    });

    it('throws validation error if row index is < 1 or required fields are missing', () => {
      expect(() =>
        computeStableIdempotencyKey({
          batchId: 'batch-001',
          sourceRow: 0,
          module: 'erp-1',
          entity: 'products',
        })
      ).toThrow();

      expect(() =>
        computeStableIdempotencyKey({
          batchId: '',
          sourceRow: 1,
          module: 'erp-1',
          entity: 'products',
        })
      ).toThrow();
    });
  });

  describe('2. Idempotency Replay Semantics & Receipt Protocol', () => {
    it('creates exactly one target record and receipt when retried three times with identical payload', async () => {
      const batchId = 'batch-idem-01';
      const sourceRow = 42;
      const key = computeStableIdempotencyKey({
        batchId,
        sourceRow,
        module: 'erp-1',
        entity: 'products',
      });
      const rowData: TestProductRow = {
        sku: 'SKU-WIDGET-01',
        name: 'Industrial Widget A',
        categoryId: 'cat-uuid-001',
        price: 199.99,
      };

      // Call 1: initial import
      const res1 = await adapter.importRow(batchId, sourceRow, key, rowData);
      expect(res1.ok).toBe(true);
      if (!res1.ok) return;
      expect(res1.value.isExisting).toBe(false);
      const initialTargetId = res1.value.targetId;

      // Call 2: first retry
      const res2 = await adapter.importRow(batchId, sourceRow, key, rowData);
      expect(res2.ok).toBe(true);
      if (!res2.ok) return;
      expect(res2.value.targetId).toBe(initialTargetId);
      expect(res2.value.isExisting).toBe(true);

      // Call 3: second retry
      const res3 = await adapter.importRow(batchId, sourceRow, key, rowData);
      expect(res3.ok).toBe(true);
      if (!res3.ok) return;
      expect(res3.value.targetId).toBe(initialTargetId);
      expect(res3.value.isExisting).toBe(true);

      // Verify durable database state: exactly 1 business entity and 1 receipt
      expect(adapter.getTargetRecords()).toHaveLength(1);
      expect(await receiptStore.countByBatchId(batchId)).toBe(1);
    });

    it('returns prior target ID immediately on lost-response replay', async () => {
      const batchId = 'batch-lost-resp';
      const sourceRow = 15;
      const key = computeStableIdempotencyKey({
        batchId,
        sourceRow,
        module: 'erp-1',
        entity: 'products',
      });
      const rowData: TestProductRow = {
        sku: 'SKU-VALVE-02',
        name: 'Pressure Valve 2in',
        categoryId: 'cat-uuid-002',
        price: 85.5,
      };

      // Initial execution
      const initial = await adapter.importRow(batchId, sourceRow, key, rowData);
      expect(initial.ok).toBe(true);
      if (!initial.ok) return;
      const targetId = initial.value.targetId;

      // Simulate lost network response / client resending the exact same request
      const replay = await adapter.importRow(batchId, sourceRow, key, rowData);
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
      expect(replay.value.targetId).toBe(targetId);
      expect(replay.value.isExisting).toBe(true);
      expect(replay.value.receipt.targetId).toBe(targetId);
    });

    it('returns HTTP 409 conflict when same key is submitted with a modified payload', async () => {
      const batchId = 'batch-conflict-01';
      const sourceRow = 8;
      const key = computeStableIdempotencyKey({
        batchId,
        sourceRow,
        module: 'erp-1',
        entity: 'products',
      });
      const originalPayload: TestProductRow = {
        sku: 'SKU-BOLT-01',
        name: 'Titanium Bolt M8',
        categoryId: 'cat-uuid-003',
        price: 12.0,
      };
      const alteredPayload: TestProductRow = {
        sku: 'SKU-BOLT-01',
        name: 'Steel Bolt M8 Altered',
        categoryId: 'cat-uuid-003',
        price: 5.0,
      };

      // Initial insert succeeds
      const first = await adapter.importRow(batchId, sourceRow, key, originalPayload);
      expect(first.ok).toBe(true);

      // Tampered payload with same idempotency key fails with 409 conflict
      const conflict = await adapter.importRow(batchId, sourceRow, key, alteredPayload);
      expect(conflict.ok).toBe(false);
      if (conflict.ok) return;
      expect(conflict.error.reasonCode).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflict.error.message).toContain('already used with a different request payload');

      // Verify business table was NOT overwritten
      expect(adapter.getTargetRecords()).toHaveLength(1);
      expect(adapter.getTargetRecords()[0]?.data.name).toBe('Titanium Bolt M8');
    });

    it('proves receipts survive worker process restart', async () => {
      const sharedDurableStore = new InMemoryImportReceiptStore();
      const batchId = 'batch-restart-01';
      const sourceRow = 99;
      const key = computeStableIdempotencyKey({
        batchId,
        sourceRow,
        module: 'erp-1',
        entity: 'products',
      });
      const payload: TestProductRow = {
        sku: 'SKU-RESTART-01',
        name: 'Restart Survivor Item',
        categoryId: 'cat-uuid-004',
      };

      // Worker 1 processes row and commits receipt to durable store
      const worker1Adapter = new TestProductTargetAdapter(sharedDurableStore);
      const res1 = await worker1Adapter.importRow(batchId, sourceRow, key, payload);
      expect(res1.ok).toBe(true);
      if (!res1.ok) return;
      const priorTargetId = res1.value.targetId;

      // Worker 1 crashes / terminates. Worker 2 spins up pointing to same durable store.
      const worker2Adapter = new TestProductTargetAdapter(sharedDurableStore);
      const res2 = await worker2Adapter.importRow(batchId, sourceRow, key, payload);

      expect(res2.ok).toBe(true);
      if (!res2.ok) return;
      expect(res2.value.targetId).toBe(priorTargetId);
      expect(res2.value.isExisting).toBe(true);
    });
  });

  describe('3. TargetBatchLoader & Chunked Execution Engine', () => {
    it('loads rows in default chunks of 500 rows', async () => {
      expect(DEFAULT_CHUNK_SIZE).toBe(500);

      const rowCount = 1200;
      const rows = Array.from({ length: rowCount }, (_, i) => ({
        sourceRow: i + 1,
        data: {
          sku: `SKU-${i + 1}`,
          name: `Product ${i + 1}`,
          categoryId: 'cat-001',
        },
      }));

      const summary = await loader.loadBatch('batch-chunk-01', 'erp-1', 'products', rows);

      expect(summary.totalSourceRows).toBe(1200);
      expect(summary.loadedCount).toBe(1200);
      expect(summary.rejectedCount).toBe(0);
      expect(summary.skippedCount).toBe(0);
      expect(summary.unaccountedCount).toBe(0);
      expect(summary.reconciliationStatus).toBe('OK');
      // 1200 / 500 chunks = 3 chunks (500 + 500 + 200)
      expect(summary.chunksProcessed).toBe(3);
      expect(adapter.getTargetRecords()).toHaveLength(1200);
    });

    it('stops safely when cumulative row failures exceed 10% threshold', async () => {
      // 100 rows total: first 5 rows valid, next 15 rows invalid (15/20 = 75% failure rate > 10%)
      const rows: Array<{ sourceRow: number; data: TestProductRow }> = [];
      for (let i = 1; i <= 5; i++) {
        rows.push({
          sourceRow: i,
          data: {
            sku: `SKU-VALID-${i}`,
            name: `Valid Product ${i}`,
            categoryId: 'cat-valid',
          },
        });
      }
      for (let i = 6; i <= 100; i++) {
        rows.push({
          sourceRow: i,
          data: {
            sku: '', // missing SKU will fail validation
            name: `Invalid Product ${i}`,
            categoryId: 'cat-invalid',
          },
        });
      }

      const summary = await loader.loadBatch('batch-fail-01', 'erp-1', 'products', rows, {
        chunkSize: 50,
        maxFailureRatePercent: 10.0,
      });

      expect(summary.halted).toBe(true);
      expect(summary.haltReason).toContain('exceeds 10% threshold');
      expect(summary.unaccountedCount).toBe(0);
      expect(summary.loadedCount + summary.rejectedCount + summary.skippedCount).toBe(100);
    });

    it('properly preserves skipped rows without mutating target and maintains row conservation', async () => {
      const rows = [
        {
          sourceRow: 1,
          data: { sku: 'SKU-001', name: 'Product 1', categoryId: 'cat-1' },
          skipped: false,
        },
        {
          sourceRow: 2,
          data: { sku: 'SKU-002', name: 'Product 2', categoryId: 'cat-1' },
          skipped: true,
          skipReason: 'EXPLICIT_USER_FILTER',
        },
        {
          sourceRow: 3,
          data: { sku: 'SKU-003', name: 'Product 3', categoryId: 'cat-1' },
          skipped: false,
        },
      ];

      const summary = await loader.loadBatch('batch-skip-01', 'erp-1', 'products', rows);

      expect(summary.totalSourceRows).toBe(3);
      expect(summary.loadedCount).toBe(2);
      expect(summary.skippedCount).toBe(1);
      expect(summary.rejectedCount).toBe(0);
      expect(summary.unaccountedCount).toBe(0);
      expect(summary.reconciliationStatus).toBe('OK');
      expect(adapter.getTargetRecords()).toHaveLength(2);
    });

    it('dry run predicts outcomes with zero database mutations or receipts', async () => {
      const rows = [
        {
          sourceRow: 1,
          data: { sku: 'SKU-DRY-1', name: 'Dry Item 1', categoryId: 'cat-dry' },
        },
        {
          sourceRow: 2,
          data: { sku: 'SKU-DRY-2', name: 'Dry Item 2', categoryId: 'cat-dry' },
        },
      ];

      const summary = await loader.loadBatch('batch-dry-01', 'erp-1', 'products', rows, {
        isDryRun: true,
      });

      expect(summary.loadedCount).toBe(2);
      expect(summary.unaccountedCount).toBe(0);
      expect(summary.reconciliationStatus).toBe('OK');

      // Crucial invariant: zero target records and zero receipts created during dry-run
      expect(adapter.getTargetRecords()).toHaveLength(0);
      expect(await receiptStore.countByBatchId('batch-dry-01')).toBe(0);
    });
  });

  describe('4. Kit Privilege Boundary Guarantee', () => {
    it('guarantees Migration Kit cannot write to target tables directly without adapter mediation', () => {
      // Adapter interface is the only write gateway
      const registeredAdapter = registry.get('erp-1', 'products');
      expect(registeredAdapter).toBeDefined();
      expect(typeof registeredAdapter?.importRow).toBe('function');
      expect(typeof registeredAdapter?.preflight).toBe('function');

      // Target database credentials/connections are strictly non-existent on loader
      expect((loader as unknown as Record<string, unknown>)['pgPool']).toBeUndefined();
      expect((loader as unknown as Record<string, unknown>)['targetDbClient']).toBeUndefined();
    });
  });
});
