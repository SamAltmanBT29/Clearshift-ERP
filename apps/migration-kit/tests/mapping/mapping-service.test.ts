import { describe, it, expect, beforeEach } from 'vitest';
import {
  type StgRow,
  type MappingTemplate,
} from '@clearshift/contracts';
import {
  BatchRegistryService,
  InMemoryBatchRepository,
  InMemoryStepLedgerRepository,
} from '../../src/batches/batch-registry.js';
import {
  InMemoryStgRowsRepository,
  InMemoryKitRejectRepository,
  InMemoryOutboxRepository,
} from '../../src/clean/clean-service.js';
import {
  InMemoryCleanCrmRepository,
  MappingService,
} from '../../src/mapping/mapping-service.js';
import {
  InMemoryMappingTemplateRepository,
  DEFAULT_CRM_CONTACTS_TEMPLATE,
} from '../../src/mapping/template-registry.js';
import { MissingRequiredTargetMappingError } from '../../src/mapping/types.js';

describe('KIT-05: Mapping Service Pipeline (Step 4: Map)', () => {
  let batchRepo: InMemoryBatchRepository;
  let stepRepo: InMemoryStepLedgerRepository;
  let batchRegistry: BatchRegistryService;
  let templateRepo: InMemoryMappingTemplateRepository;
  let stgRowsRepo: InMemoryStgRowsRepository;
  let cleanCrmRepo: InMemoryCleanCrmRepository;
  let rejectRepo: InMemoryKitRejectRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let mappingService: MappingService;

  beforeEach(() => {
    batchRepo = new InMemoryBatchRepository();
    stepRepo = new InMemoryStepLedgerRepository();
    batchRegistry = new BatchRegistryService(batchRepo, stepRepo);
    templateRepo = new InMemoryMappingTemplateRepository(true);
    stgRowsRepo = new InMemoryStgRowsRepository();
    cleanCrmRepo = new InMemoryCleanCrmRepository();
    rejectRepo = new InMemoryKitRejectRepository();
    outboxRepo = new InMemoryOutboxRepository();

    mappingService = new MappingService(
      batchRegistry,
      templateRepo,
      stgRowsRepo,
      cleanCrmRepo,
      rejectRepo,
      outboxRepo
    );
  });

  async function createCleanedBatch(): Promise<string> {
    const batch = await batchRegistry.createBatch({
      module: 'crm',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      correlationId: 'corr-kit-05-test',
    });

    // Advance to 'cleaned'
    await batchRegistry.transitionBatch(batch.id, { targetStatus: 'extracting', stepName: 'extract' });
    await batchRegistry.transitionBatch(batch.id, { targetStatus: 'extracted', stepName: 'extract' });
    await batchRegistry.transitionBatch(batch.id, { targetStatus: 'profiled', stepName: 'profile' });
    await batchRegistry.transitionBatch(batch.id, { targetStatus: 'cleaned', stepName: 'clean' });

    return batch.id;
  }

  it('rejects execution if batch is not in "cleaned" state', async () => {
    const batch = await batchRegistry.createBatch({
      module: 'crm',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      correlationId: 'corr-kit-05-unclean',
    });

    await expect(mappingService.executeMapping(batch.id)).rejects.toThrow(
      /Step 4 \(Map\) requires status 'cleaned'/
    );
  });

  it('BLOCKS execution and leaves clean tables unmutated when required target fields are unmapped', async () => {
    const batchId = await createCleanedBatch();

    // Staging data
    await stgRowsRepo.saveRows([
      {
        batchId,
        sourceRow: 1,
        status: 'cleaned',
        cleanedPayload: { first_name: 'John', last_name: 'Doe' }, // missing email mapping
      },
    ]);

    // Template missing 'email'
    const defectiveTemplate: MappingTemplate = {
      id: 'd1000000-0000-4000-8000-000000000001',
      module: 'crm',
      name: 'Defective No-Email Template',
      version: '1.0.0',
      targetEntity: 'contacts',
      fieldMappings: [
        { sourceColumn: 'first_name', targetField: 'firstName', required: true },
        { sourceColumn: 'last_name', targetField: 'lastName', required: true },
      ],
      valueConversions: [],
      createdBy: 'test',
    };
    await templateRepo.saveTemplate(defectiveTemplate);

    await expect(
      mappingService.executeMapping(batchId, { templateId: defectiveTemplate.id })
    ).rejects.toThrow(MissingRequiredTargetMappingError);

    // Assert: Zero records written to clean_crm
    const cleanRows = await cleanCrmRepo.findByBatchId(batchId);
    expect(cleanRows.length).toBe(0);

    // Assert: Batch remains in 'cleaned' status (no state mutation)
    const batch = await batchRegistry.getBatchById(batchId);
    expect(batch!.status).toBe('cleaned');
  });

  it('successfully maps cleaned rows into clean_crm, preserving target fields only and emitting batch.mapped', async () => {
    const batchId = await createCleanedBatch();

    // 3 Cleaned staging rows
    await stgRowsRepo.saveRows([
      {
        batchId,
        sourceRow: 1,
        status: 'cleaned',
        cleanedPayload: {
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          phone: '+1-555-0100',
          company: 'Acme Corp',
          country: 'US',
          extra_unmapped_source_field: 'should_not_be_in_target',
        },
      },
      {
        batchId,
        sourceRow: 2,
        status: 'cleaned',
        cleanedPayload: {
          first_name: 'Bob',
          last_name: 'Jones',
          email: 'bob@example.com',
          phone: '+1-555-0101',
          company: 'Beta LLC',
          country: 'UK',
          internal_vendor_code: 'VEND-99',
        },
      },
    ]);

    const result = await mappingService.executeMapping(batchId, {
      templateId: DEFAULT_CRM_CONTACTS_TEMPLATE.id,
      actor: 'migration_runner',
    });

    expect(result.mappedRows).toBe(2);
    expect(result.rejectedRows).toBe(0);
    expect(result.totalRows).toBe(2);
    expect(result.targetEntity).toBe('contacts');

    // 1. Verify clean_crm contents: ONLY target fields present!
    const cleanRows = await cleanCrmRepo.findByBatchId(batchId);
    expect(cleanRows.length).toBe(2);

    const row1 = cleanRows.find((r) => r.sourceRow === 1);
    expect(row1).toBeDefined();
    expect(row1!.payload).toEqual({
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      phone: '+1-555-0100',
      company: 'Acme Corp',
      country: 'US',
    });
    // Extra unmapped source columns must NOT appear in clean_crm payload (FR-MP-05)
    expect(row1!.payload.extra_unmapped_source_field).toBeUndefined();

    // 2. Verify Batch state transitioned to 'mapped'
    const updatedBatch = await batchRegistry.getBatchById(batchId);
    expect(updatedBatch!.status).toBe('mapped');

    // 3. Verify Ledger step recorded in kit_batch_steps
    const steps = await stepRepo.findByBatchId(batchId);
    const mapStep = steps.find((s) => s.stepName === 'map');
    expect(mapStep).toBeDefined();
    expect(mapStep!.fromStatus).toBe('cleaned');
    expect(mapStep!.toStatus).toBe('mapped');
    expect(mapStep!.recordsIn).toBe(2);
    expect(mapStep!.recordsOut).toBe(2);
    expect(mapStep!.actor).toBe('migration_runner');

    // 4. Verify outbox event 'batch.mapped' published
    const outboxEvents = await outboxRepo.listByBatchId(batchId);
    expect(outboxEvents.length).toBe(1);
    expect(outboxEvents[0].eventType).toBe('batch.mapped');
    expect(outboxEvents[0].producer).toBe('migration-kit.map');
    expect(outboxEvents[0].payload.mappedRows).toBe(2);
    expect(outboxEvents[0].payload.missingRequired).toBe(0);
  });

  it('rejects rows with invalid enum conversions and keeps valid rows', async () => {
    const batchId = await createCleanedBatch();

    // Template for leads with enum conversion on leadStatus
    const leadsTemplate: MappingTemplate = {
      id: 'e1000000-0000-4000-8000-000000000001',
      module: 'crm',
      name: 'Leads Mapping Template',
      version: '1.0.0',
      targetEntity: 'leads',
      fieldMappings: [
        { sourceColumn: 'first_name', targetField: 'firstName', required: true },
        { sourceColumn: 'last_name', targetField: 'lastName', required: true },
        { sourceColumn: 'email', targetField: 'email', required: true },
        { sourceColumn: 'status_code', targetField: 'leadStatus', required: true },
      ],
      valueConversions: [
        {
          targetField: 'leadStatus',
          mappings: {
            N: 'New',
            W: 'Working',
            Q: 'Qualified',
            C: 'Closed',
          },
          unmappedAction: 'reject',
        },
      ],
      createdBy: 'system',
    };
    await templateRepo.saveTemplate(leadsTemplate);

    await stgRowsRepo.saveRows([
      {
        batchId,
        sourceRow: 1,
        status: 'cleaned',
        cleanedPayload: {
          first_name: 'Carol',
          last_name: 'White',
          email: 'carol@example.com',
          status_code: 'W', // maps to 'Working' (valid)
        },
      },
      {
        batchId,
        sourceRow: 2,
        status: 'cleaned',
        cleanedPayload: {
          first_name: 'Dan',
          last_name: 'Black',
          email: 'dan@example.com',
          status_code: 'INVALID_STATUS', // unmapped -> rejected
        },
      },
    ]);

    const result = await mappingService.executeMapping(batchId, {
      templateId: leadsTemplate.id,
    });

    expect(result.mappedRows).toBe(1);
    expect(result.rejectedRows).toBe(1);

    // Valid row in clean_crm
    const cleanRows = await cleanCrmRepo.findByBatchId(batchId);
    expect(cleanRows.length).toBe(1);
    expect(cleanRows[0].sourceRow).toBe(1);
    expect(cleanRows[0].payload.leadStatus).toBe('Working');

    // Rejected row in kit_rejects
    const rejects = await rejectRepo.findByBatchId(batchId);
    expect(rejects.length).toBe(1);
    expect(rejects[0].sourceRow).toBe(2);
    expect(rejects[0].reasonCode).toBe('INVALID_ENUM_CONVERSION');
    expect(rejects[0].reasonText).toContain('has no valid conversion mapping');
  });
});
