import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import {
  ProfileService,
  InMemoryProfileReportRepository,
  InMemoryOutboxRepository,
} from '../../src/profile/profile-service.js';
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
import { exportProfileReportCsv } from '../../src/profile/csv-export.js';

describe('ProfileService & Canonical 1,000-Row Fixture (KIT-03)', () => {
  let tempDir: string;
  let batchRepo: InMemoryBatchRepository;
  let ledgerRepo: InMemoryStepLedgerRepository;
  let batchService: BatchRegistryService;
  let storage: RestrictedLocalFileStorage;
  let rawRowsRepo: InMemoryRawRowsRepository;
  let reportRepo: InMemoryProfileReportRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let ingestService: IngestService;
  let profileService: ProfileService;

  const fixtureDir = path.resolve(process.cwd(), 'sample-data/dirty-data-pack');
  const csvPath = path.join(fixtureDir, 'dirty-data-v1.csv');
  const expectedProfilePath = path.join(fixtureDir, 'expected-profile.json');

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `kit-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    batchRepo = new InMemoryBatchRepository();
    ledgerRepo = new InMemoryStepLedgerRepository();
    batchService = new BatchRegistryService(batchRepo, ledgerRepo);
    storage = new RestrictedLocalFileStorage(tempDir);
    rawRowsRepo = new InMemoryRawRowsRepository();
    reportRepo = new InMemoryProfileReportRepository();
    outboxRepo = new InMemoryOutboxRepository();

    ingestService = new IngestService(batchService, storage, rawRowsRepo);
    profileService = new ProfileService(batchService, rawRowsRepo, reportRepo, outboxRepo);
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Canonical Fixture Integrity & Checksum
  // ---------------------------------------------------------------------------
  describe('Fixture Verification', () => {
    it('verifies that canonical dirty-data-v1.csv matches committed SHA-256 and size', () => {
      const csvBuf = fs.readFileSync(csvPath);
      const expected = JSON.parse(fs.readFileSync(expectedProfilePath, 'utf8'));

      const calculatedSha = crypto.createHash('sha256').update(csvBuf).digest('hex');
      expect(calculatedSha).toBe(expected.fixture.sha256);
      expect(csvBuf.length).toBe(expected.fixture.bytes);
      expect(expected.fixture.rows).toBe(1000);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. SDS TS-02 Known Problem Counts
  // ---------------------------------------------------------------------------
  describe('SDS TS-02 Expected Problem Manifest', () => {
    it('accurately profiles 1,000-row fixture finding exactly 80 duplicates, 60 format errors, 50 empty required fields', async () => {
      const csvBuf = fs.readFileSync(csvPath);
      const stream = Readable.from(csvBuf);

      // Step 1: Ingest into raw rows
      const ingestResult = await ingestService.ingestSourceStream(stream, 'dirty-data-v1.csv', {
        module: 'crm',
        sourceSystem: 'legacy_contacts',
        actor: 'operator-profile-test',
      });

      expect(ingestResult.totalDataRows).toBe(1000);

      // Verify raw rows are loaded
      const rawRowsBefore = await rawRowsRepo.findByBatchId(ingestResult.batchId);
      expect(rawRowsBefore).toHaveLength(1000);
      const rawHashBefore = crypto.createHash('sha256').update(JSON.stringify(rawRowsBefore)).digest('hex');

      // Step 2: Run Profile
      const report = await profileService.profileBatch(ingestResult.batchId, {
        keyFields: ['email'],
        actor: 'operator-profile-test',
      });

      // Verify TS-02:
      // 80 duplicates, 60 format errors, 50 empty required fields
      expect(report.totalRows).toBe(1000);
      expect(report.duplicates.totalDuplicates).toBe(80);
      expect(report.duplicates.uniqueDuplicateKeys).toBe(40);
      expect(report.summary.duplicateCount).toBe(80);
      expect(report.summary.invalidCount).toBe(60);
      expect(report.summary.emptyCount).toBe(50);

      // Verify specific column level problem counts
      const firstNameCol = report.columns.find((c) => c.columnName === 'first_name');
      const companyCol = report.columns.find((c) => c.columnName === 'company');
      const emailCol = report.columns.find((c) => c.columnName === 'email');
      const phoneCol = report.columns.find((c) => c.columnName === 'phone');
      const revenueCol = report.columns.find((c) => c.columnName === 'annual_revenue');

      expect(firstNameCol?.emptyCount).toBe(30);
      expect(companyCol?.emptyCount).toBe(20);
      expect((firstNameCol?.emptyCount || 0) + (companyCol?.emptyCount || 0)).toBe(50); // 50 empty required fields

      expect(emailCol?.invalidCount).toBe(25);
      expect(phoneCol?.invalidCount).toBe(20);
      expect(revenueCol?.invalidCount).toBe(15);
      expect((emailCol?.invalidCount || 0) + (phoneCol?.invalidCount || 0) + (revenueCol?.invalidCount || 0)).toBe(60); // 60 format errors

      // Verify raw table was NOT mutated (checksum comparison)
      const rawRowsAfter = await rawRowsRepo.findByBatchId(ingestResult.batchId);
      const rawHashAfter = crypto.createHash('sha256').update(JSON.stringify(rawRowsAfter)).digest('hex');
      expect(rawHashAfter).toBe(rawHashBefore);

      // Verify Batch status transitioned to 'profiled'
      const batch = await batchService.getBatch(ingestResult.batchId);
      expect(batch?.status).toBe('profiled');

      // Verify Outbox Event emitted: batch.profiled
      const outboxEvents = await outboxRepo.listByBatchId(ingestResult.batchId);
      expect(outboxEvents).toHaveLength(1);
      const event = outboxEvents[0];
      expect(event.eventType).toBe('batch.profiled');
      expect(event.payload).toMatchObject({
        batchId: ingestResult.batchId,
        module: 'crm',
        emptyCount: 50,
        invalidCount: 60,
        duplicateCount: 80,
        totalRows: 1000,
        columnsCount: 8,
      });

      // Verify CSV export
      const exportedCsv = exportProfileReportCsv(report);
      expect(exportedCsv).toContain('# Total Rows,1000');
      expect(exportedCsv).toContain('# Duplicate Candidates Total,80');
      expect(exportedCsv).toContain('# Empty Values Total,50');
      expect(exportedCsv).toContain('# Format Errors Total,60');
    });

    it('produces 100% deterministic results when rerun on identical raw data', async () => {
      const csvBuf = fs.readFileSync(csvPath);
      const stream = Readable.from(csvBuf);

      const ingestResult = await ingestService.ingestSourceStream(stream, 'dirty-data-v1.csv', {
        module: 'crm',
      });

      const report1 = await profileService.profileBatch(ingestResult.batchId);
      const csv1 = exportProfileReportCsv(report1);

      // Re-run
      const report2 = await profileService.profileBatch(ingestResult.batchId);
      const csv2 = exportProfileReportCsv(report2);

      expect(report1.summary).toEqual(report2.summary);
      expect(report1.columns).toEqual(report2.columns);
      expect(report1.duplicates).toEqual(report2.duplicates);
      // Strip dynamic timestamp for string match
      const stripDate = (s: string) => s.replace(/# Generated At,.*\n/, '');
      expect(stripDate(csv1)).toBe(stripDate(csv2));
    });
  });
});
