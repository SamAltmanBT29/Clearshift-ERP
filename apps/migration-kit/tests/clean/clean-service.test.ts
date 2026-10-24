import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import {
  CleanService,
  InMemoryCleanLogRepository,
  InMemoryKitRejectRepository,
  InMemoryStgRowsRepository,
  InMemoryOutboxRepository,
} from '../../src/clean/clean-service.js';
import {
  ProfileService,
  InMemoryProfileReportRepository,
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

describe('CleanService & Canonical 1,000-Row Fixture (KIT-04)', () => {
  let tempDir: string;
  let batchRepo: InMemoryBatchRepository;
  let ledgerRepo: InMemoryStepLedgerRepository;
  let batchService: BatchRegistryService;
  let storage: RestrictedLocalFileStorage;
  let rawRowsRepo: InMemoryRawRowsRepository;
  let reportRepo: InMemoryProfileReportRepository;
  let cleanLogRepo: InMemoryCleanLogRepository;
  let rejectRepo: InMemoryKitRejectRepository;
  let stgRowsRepo: InMemoryStgRowsRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let ingestService: IngestService;
  let profileService: ProfileService;
  let cleanService: CleanService;

  const fixtureDir = path.resolve(process.cwd(), 'sample-data/dirty-data-pack');
  const csvPath = path.join(fixtureDir, 'dirty-data-v1.csv');

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `kit-clean-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    batchRepo = new InMemoryBatchRepository();
    ledgerRepo = new InMemoryStepLedgerRepository();
    batchService = new BatchRegistryService(batchRepo, ledgerRepo);
    storage = new RestrictedLocalFileStorage(tempDir);
    rawRowsRepo = new InMemoryRawRowsRepository();
    reportRepo = new InMemoryProfileReportRepository();
    cleanLogRepo = new InMemoryCleanLogRepository();
    rejectRepo = new InMemoryKitRejectRepository();
    stgRowsRepo = new InMemoryStgRowsRepository();
    outboxRepo = new InMemoryOutboxRepository();

    ingestService = new IngestService(batchService, storage, rawRowsRepo);
    profileService = new ProfileService(batchService, rawRowsRepo, reportRepo, outboxRepo);
    cleanService = new CleanService(batchService, rawRowsRepo, cleanLogRepo, rejectRepo, stgRowsRepo, outboxRepo);
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  async function setupProfiled1000RowBatch(): Promise<string> {
    const csvBuf = fs.readFileSync(csvPath);
    const stream = Readable.from(csvBuf);

    // Step 1: Ingest
    const ingestResult = await ingestService.ingestSourceStream(stream, 'dirty-data-v1.csv', {
      module: 'crm',
      sourceSystem: 'legacy_crm',
      actor: 'clean-test-runner',
    });

    // Step 2: Profile
    await profileService.profileBatch(ingestResult.batchId, {
      requiredFields: ['first_name', 'company', 'email'],
    });

    return ingestResult.batchId;
  }

  // ---------------------------------------------------------------------------
  // 1. Step Precondition & State Validation
  // ---------------------------------------------------------------------------
  describe('Step Preconditions', () => {
    it('rejects execution if batch is not in profiled status', async () => {
      // Create batch directly in 'created' state
      const created = await batchService.createBatch({
        module: 'crm',
        sourceSystem: 'legacy_crm',
        fileName: 'test.csv',
        checksum: 'a'.repeat(64),
        correlationId: '11111111-1111-4111-8111-111111111111',
      });

      await expect(cleanService.cleanBatch(created.id)).rejects.toThrow(
        /expected 'profiled' to clean/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Full 1,000-Row Fixture Cleaning Execution
  // ---------------------------------------------------------------------------
  describe('Canonical 1,000-Row Cleaning Pipeline Execution', () => {
    it('cleans 1,000-row fixture, rejecting 50 empty required rows and 25 invalid email rows (TS-05)', async () => {
      const batchId = await setupProfiled1000RowBatch();

      // Check pre-clean raw row checksum
      const rawRowsBefore = await rawRowsRepo.findByBatchId(batchId);
      expect(rawRowsBefore).toHaveLength(1000);
      const preCleanHash = crypto.createHash('sha256').update(JSON.stringify(rawRowsBefore)).digest('hex');

      // Execute Step 3 Cleaning with declared required fields
      const result = await cleanService.cleanBatch(batchId, {
        requiredFields: ['first_name', 'company', 'email'],
        phoneCountry: '+1',
        dateFormat: 'YYYY-MM-DD',
      });

      expect(result.totalRows).toBe(1000);

      // Rejection Accounting:
      // - 50 rows have empty required fields (rows 1-30 missing first_name, 31-50 missing company)
      // - 25 rows have format errors in email (rows 51-75 missing '@' or invalid)
      // Total rejected = 75 rows. Cleaned = 925 rows.
      expect(result.rejectedRows).toBe(75);
      expect(result.cleanedRows).toBe(925);
      expect(result.cleanedRows + result.rejectedRows).toBe(1000);

      // 1. Verify rejects table
      const rejects = await rejectRepo.findByBatchId(batchId);
      expect(rejects).toHaveLength(75);

      // Verify TS-05 exact message presence among email rejects:
      // "Email is not valid: value has no @ sign"
      const emailRejects = rejects.filter((r) => r.reasonCode === 'INVALID_EMAIL');
      expect(emailRejects.length).toBeGreaterThan(0);
      const ts05Rejection = emailRejects.find((r) => r.reasonText === 'Email is not valid: value has no @ sign');
      expect(ts05Rejection).toBeDefined();

      // Verify required field missing rejects
      const reqRejects = rejects.filter((r) => r.reasonCode === 'REQUIRED_FIELD_MISSING');
      expect(reqRejects.length).toBe(50);

      // 2. Verify staged rows table
      const staged = await stgRowsRepo.findByBatchId(batchId);
      expect(staged).toHaveLength(1000);
      const stagedClean = staged.filter((s) => s.status === 'cleaned');
      const stagedRejected = staged.filter((s) => s.status === 'rejected');
      expect(stagedClean).toHaveLength(925);
      expect(stagedRejected).toHaveLength(75);

      // 3. Verify clean audit log
      const auditEntries = await cleanLogRepo.findByBatchId(batchId);
      expect(auditEntries.length).toBeGreaterThan(0);
      for (const entry of auditEntries) {
        expect(entry.batchId).toBe(batchId);
        expect(entry.ruleId).toBeDefined();
        expect(entry.ruleVersion).toBe('1.0.0');
      }

      // 4. Verify Raw Row Immutability Invariant
      const rawRowsAfter = await rawRowsRepo.findByBatchId(batchId);
      const postCleanHash = crypto.createHash('sha256').update(JSON.stringify(rawRowsAfter)).digest('hex');
      expect(postCleanHash).toBe(preCleanHash);

      // 5. Verify batch status & step ledger
      const updatedBatch = await batchService.getBatch(batchId);
      expect(updatedBatch?.status).toBe('cleaned');
      expect(updatedBatch?.checkpoint).toBe('cleaned');
      expect(updatedBatch?.rejectedRows).toBe(75);

      const steps = await ledgerRepo.findByBatchId(batchId);
      const cleanStep = steps.find((s) => s.stepName === 'clean');
      expect(cleanStep).toBeDefined();
      expect(cleanStep?.fromStatus).toBe('profiled');
      expect(cleanStep?.toStatus).toBe('cleaned');
      expect(cleanStep?.recordsIn).toBe(1000);
      expect(cleanStep?.recordsOut).toBe(925);
      expect(cleanStep?.recordsRejected).toBe(75);

      // 6. Verify transactional outbox event
      const events = await outboxRepo.listByBatchId(batchId);
      const cleanedEvent = events.find((e) => e.eventType === 'batch.cleaned');
      expect(cleanedEvent).toBeDefined();
      expect(cleanedEvent?.aggregateType).toBe('kit_batch');
      expect(cleanedEvent?.aggregateId).toBe(batchId);

      const eventPayload = cleanedEvent?.payload as any;
      expect(eventPayload.batchId).toBe(batchId);
      expect(eventPayload.cleanedRows).toBe(925);
      expect(eventPayload.rejectedRows).toBe(75);
      expect(eventPayload.totalRows).toBe(1000);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Configurable Rule Toggles (On/Off)
  // ---------------------------------------------------------------------------
  describe('Rule Toggles Execution', () => {
    it('disables specified rule during batch run', async () => {
      const batchId = await setupProfiled1000RowBatch();

      // Disable RL-NAME-01 so names are not modified
      const result = await cleanService.cleanBatch(batchId, {
        requiredFields: ['first_name', 'company', 'email'],
        disabledRules: ['RL-NAME-01'],
      });

      expect(result.totalRows).toBe(1000);

      const auditEntries = await cleanLogRepo.findByBatchId(batchId);
      const nameAudits = auditEntries.filter((a) => a.ruleId === 'RL-NAME-01');
      expect(nameAudits).toHaveLength(0);
    });
  });
});
