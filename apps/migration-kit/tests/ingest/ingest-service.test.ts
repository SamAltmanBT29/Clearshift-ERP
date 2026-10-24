import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  IngestService,
  InMemoryRawRowsRepository,
} from '../../src/ingest/ingest-service.js';
import { RestrictedLocalFileStorage } from '../../src/ingest/file-storage.js';
import {
  BatchRegistryService,
  InMemoryBatchRepository,
  InMemoryStepLedgerRepository,
} from '../../src/batches/batch-registry.js';
import {
  InvalidEncodingError,
  IngestionLimitError,
} from '@clearshift/contracts';

describe('IngestService Integration (KIT-02)', () => {
  let tempDir: string;
  let batchRepo: InMemoryBatchRepository;
  let ledgerRepo: InMemoryStepLedgerRepository;
  let batchService: BatchRegistryService;
  let storage: RestrictedLocalFileStorage;
  let rawRowsRepo: InMemoryRawRowsRepository;
  let ingestService: IngestService;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `kit-ingest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });

    batchRepo = new InMemoryBatchRepository();
    ledgerRepo = new InMemoryStepLedgerRepository();
    batchService = new BatchRegistryService(batchRepo, ledgerRepo);
    storage = new RestrictedLocalFileStorage(tempDir);
    rawRowsRepo = new InMemoryRawRowsRepository();
    ingestService = new IngestService(batchService, storage, rawRowsRepo);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('successfully ingests CSV, commits raw rows in chunks, and transitions batch to extracted', async () => {
    const csvContent = [
      'id,name,amount',
      '1,Alpha,100',
      '2,Beta,200',
      '3,Gamma,300',
    ].join('\n');

    const stream = Readable.from(Buffer.from(csvContent, 'utf8'));

    const result = await ingestService.ingestSourceStream(stream, 'customers.csv', {
      module: 'crm',
      sourceSystem: 'legacy_mysql',
      actor: 'operator-1',
      correlationId: 'corr-001',
      delimiter: ',',
    });

    expect(result.batchId).toBeDefined();
    expect(result.totalDataRows).toBe(3);
    expect(result.headers).toEqual(['id', 'name', 'amount']);
    expect(result.fileSizeBytes).toBe(Buffer.byteLength(csvContent, 'utf8'));
    expect(result.checksum).toHaveLength(64);

    // Verify batch state
    const batch = await batchService.getBatch(result.batchId);
    expect(batch?.status).toBe('extracted');
    const ledger = await batchService.getStepLedger(result.batchId);
    const lastStep = ledger[ledger.length - 1];
    expect(lastStep.recordsIn).toBe(3);
    expect(lastStep.recordsOut).toBe(3);

    // Verify raw rows in repository
    const rawRows = await ingestService.getRawRows(result.batchId);
    expect(rawRows).toHaveLength(3);
    expect(rawRows[0].sourceRow).toBe(1);
    expect(rawRows[0].payload).toEqual({ id: '1', name: 'Alpha', amount: '100' });
    expect(rawRows[0].headers).toEqual(['id', 'name', 'amount']);
    expect(rawRows[0].cells).toEqual(['1', 'Alpha', '100']);
    expect(rawRows[0].rowHash).toHaveLength(64);
  });

  it('correctly handles chunked insertion for batches exceeding 500 rows', async () => {
    const rowCount = 1250;
    const lines = ['idx,val'];
    for (let i = 1; i <= rowCount; i++) {
      lines.push(`${i},val_${i}`);
    }
    const csvContent = lines.join('\n');
    const stream = Readable.from(Buffer.from(csvContent, 'utf8'));

    const result = await ingestService.ingestSourceStream(stream, 'large_batch.csv', {
      module: 'erp',
      sourceSystem: 'sap',
      actor: 'migrator-chunk',
    });

    expect(result.totalDataRows).toBe(rowCount);

    const count = await rawRowsRepo.countByBatchId(result.batchId);
    expect(count).toBe(rowCount);

    // Verify first and last rows
    const firstRow = await rawRowsRepo.findByBatchId(result.batchId, 1, 0);
    expect(firstRow[0].payload).toEqual({ idx: '1', val: 'val_1' });

    const lastRow = await rawRowsRepo.findByBatchId(result.batchId, 1, rowCount - 1);
    expect(lastRow[0].payload).toEqual({ idx: '1250', val: 'val_1250' });
  });

  it('ignores fully blank physical rows without counting them as skipped business rows', async () => {
    const csvContent = [
      'id,name',
      '1,One',
      '',
      '   ',
      '2,Two',
      '',
    ].join('\n');

    const stream = Readable.from(Buffer.from(csvContent, 'utf8'));

    const result = await ingestService.ingestSourceStream(stream, 'with_blanks.csv', {
      module: 'crm',
      sourceSystem: 'salesforce',
      actor: 'cleaner',
    });

    expect(result.totalDataRows).toBe(2);
    expect(result.diagnostics.blankRowsCount).toBe(2);
    expect(result.diagnostics.dataRowsCount).toBe(2);

    const rows = await rawRowsRepo.findByBatchId(result.batchId);
    expect(rows).toHaveLength(2);
    expect(rows[0].sourceRow).toBe(1);
    expect(rows[1].sourceRow).toBe(2);
  });

  it('fails safely at file-level on invalid encoding without fabricating row outcomes', async () => {
    const invalidUtf8 = Buffer.concat([
      Buffer.from('col1,col2\n', 'utf8'),
      Buffer.from([0xff, 0xfe, 0xfd]),
    ]);

    const stream = Readable.from(invalidUtf8);

    await expect(
      ingestService.ingestSourceStream(stream, 'corrupt.csv', {
        module: 'crm',
        sourceSystem: 'legacy',
        actor: 'tester',
      })
    ).rejects.toThrow(InvalidEncodingError);

    // Verify batch was transitioned to failed
    const allBatches = await batchRepo.list();
    expect(allBatches).toHaveLength(1);
    const failedBatch = allBatches[0];
    expect(failedBatch.status).toBe('failed');
    expect(failedBatch.errorCode).toBe('INVALID_ENCODING');

    // Verify no rows were stored
    const rows = await rawRowsRepo.findByBatchId(failedBatch.id);
    expect(rows).toHaveLength(0);
  });

  it('fails safely when column limit is exceeded', async () => {
    const headers = Array.from({ length: 101 }, (_, i) => `col_${i + 1}`).join(',');
    const data = Array.from({ length: 101 }, (_, i) => `val_${i + 1}`).join(',');
    const csvContent = `${headers}\n${data}\n`;

    const stream = Readable.from(Buffer.from(csvContent, 'utf8'));

    await expect(
      ingestService.ingestSourceStream(stream, 'wide.csv', {
        module: 'erp',
        sourceSystem: 'oracle',
        actor: 'tester',
      })
    ).rejects.toThrow(IngestionLimitError);

    const allBatches = await batchRepo.list();
    expect(allBatches[0].status).toBe('failed');
    expect(allBatches[0].errorCode).toBe('MAX_COLUMNS');
  });

  it('enforces immutability: rejects update and delete on raw rows repository', () => {
    expect(() => rawRowsRepo.update()).toThrow('append-only');
    expect(() => rawRowsRepo.delete()).toThrow('append-only');
  });
});
