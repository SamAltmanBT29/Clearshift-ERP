import { describe, it, expect, beforeEach } from 'vitest';
import {
  ValidationRegistry,
  validationRegistry,
  ValidationService,
  validationService,
  createRequiredFieldRule,
  createFormatRule,
  createEnumRule,
  createRelationshipRule,
} from '../../src/validate/index.js';
import {
  VALIDATION_REASON_CODES,
  BatchValidatedEventPayloadSchema,
} from '@clearshift/contracts';

describe('[KIT-06] Shared Target Validation & Post-Load Integrity Engine', () => {
  let registry: ValidationRegistry;
  let service: ValidationService;

  beforeEach(() => {
    registry = new ValidationRegistry();
    service = new ValidationService(registry);
  });

  // --------------------------------------------------------------------------
  // SECTION A: Module Rule Declarations & Registry Discovery
  // --------------------------------------------------------------------------
  describe('A. Module Rule Declarations & Registry', () => {
    it('declares and registers required checks for all V1 modules', () => {
      const v1Modules = ['crm-1', 'crm-2', 'crm-3', 'crm-4', 'crm-5'];

      for (const mod of v1Modules) {
        const rules = registry.getRules({ module: mod });
        expect(rules.length).toBeGreaterThan(0);
        // Ensure at least one required field check exists per module
        const reqRule = rules.find((r) => r.ruleType === 'required_field');
        expect(reqRule).toBeDefined();
      }
    });

    it('filters rules accurately by entity and execution phase', () => {
      const preLoadContactRules = registry.getRules({
        module: 'crm-1',
        entity: 'contacts',
        phase: 'pre_load',
      });
      const postLoadContactRules = registry.getRules({
        module: 'crm-1',
        entity: 'contacts',
        phase: 'post_load',
      });

      expect(preLoadContactRules.length).toBeGreaterThan(0);
      expect(preLoadContactRules.every((r) => r.phase === 'pre_load')).toBe(true);

      expect(postLoadContactRules.length).toBeGreaterThan(0);
      expect(postLoadContactRules.every((r) => r.phase === 'post_load')).toBe(true);
      expect(postLoadContactRules.some((r) => r.ruleType === 'relationship')).toBe(true);
    });

    it('allows dynamic registration of custom module validation rules', () => {
      const customRule = createRequiredFieldRule({
        ruleId: 'CUSTOM-VAL-01',
        module: 'erp-1',
        entity: 'invoices',
        field: 'invoice_number',
      });

      registry.registerRule(customRule);
      const rules = registry.getRules({ module: 'erp-1', entity: 'invoices' });

      expect(rules).toHaveLength(1);
      expect(rules[0]?.ruleId).toBe('CUSTOM-VAL-01');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION B: Pre-Load Business & Format Validation
  // --------------------------------------------------------------------------
  describe('B. Pre-Load Business & Format Validation', () => {
    it('passes completely valid synthetic contact records', async () => {
      const validRecords = [
        {
          sourceRow: 1,
          targetId: 'cont-001',
          data: {
            first_name: 'Jane',
            last_name: 'Doe',
            golden_id: 'GLD-1001',
            email: 'jane.doe@example.synthetic',
            phone: '+1-555-0100',
            lead_status: 'Qualified',
            consent_status: 'granted',
            consent_updated_at: new Date().toISOString(),
          },
        },
        {
          sourceRow: 2,
          targetId: 'cont-002',
          data: {
            first_name: 'John',
            last_name: 'Smith',
            golden_id: 'GLD-1002',
            email: 'john.smith@example.synthetic',
            phone: '+1-555-0200',
            lead_status: 'New',
            consent_status: 'unknown',
          },
        },
      ];

      const report = await service.validateRecords({
        batchId: 'batch-synth-001',
        module: 'crm-1',
        entity: 'contacts',
        phase: 'pre_load',
        records: validRecords,
      });

      expect(report.isValid).toBe(true);
      expect(report.totalChecked).toBe(2);
      expect(report.passedCount).toBe(2);
      expect(report.failedCount).toBe(0);
      expect(report.failures).toHaveLength(0);
    });

    it('detects missing required fields and attributes failures to source rows', async () => {
      const invalidRecords = [
        {
          sourceRow: 5,
          targetId: 'cont-005',
          data: {
            first_name: '', // Missing
            last_name: 'Doe',
            golden_id: 'GLD-1005',
          },
        },
        {
          sourceRow: 8,
          targetId: 'cont-008',
          data: {
            first_name: 'Alex',
            last_name: '   ', // Whitespace only
            golden_id: 'GLD-1008',
          },
        },
      ];

      const report = await service.validateRecords({
        batchId: 'batch-synth-002',
        module: 'crm-1',
        entity: 'contacts',
        phase: 'pre_load',
        records: invalidRecords,
      });

      expect(report.isValid).toBe(false);
      expect(report.failedCount).toBe(2);

      const f1 = report.failures.find((f) => f.sourceRow === 5);
      expect(f1).toBeDefined();
      expect(f1?.ruleId).toBe('CRM1-VAL-REQ-01');
      expect(f1?.reasonCode).toBe(VALIDATION_REASON_CODES.REQUIRED_FIELD_MISSING);

      const f2 = report.failures.find((f) => f.sourceRow === 8);
      expect(f2).toBeDefined();
      expect(f2?.ruleId).toBe('CRM1-VAL-REQ-02');
      expect(f2?.reasonCode).toBe(VALIDATION_REASON_CODES.REQUIRED_FIELD_MISSING);
    });

    it('detects format and enum violations deterministically', async () => {
      const records = [
        {
          sourceRow: 12,
          data: {
            first_name: 'Sam',
            last_name: 'Taylor',
            golden_id: 'GLD-1012',
            email: 'not-an-email-address',
            lead_status: 'INVALID_STATUS_CODE',
          },
        },
      ];

      const report = await service.validateRecords({
        batchId: 'batch-synth-003',
        module: 'crm-1',
        entity: 'contacts',
        phase: 'pre_load',
        records,
      });

      expect(report.isValid).toBe(false);
      expect(report.failures.length).toBeGreaterThanOrEqual(2);

      const emailFailure = report.failures.find((f) => f.field === 'email');
      expect(emailFailure).toBeDefined();
      expect(emailFailure?.reasonCode).toBe(VALIDATION_REASON_CODES.INVALID_FORMAT);

      const enumFailure = report.failures.find((f) => f.field === 'lead_status');
      expect(enumFailure).toBeDefined();
      expect(enumFailure?.reasonCode).toBe(VALIDATION_REASON_CODES.INVALID_ENUM_VALUE);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION C: Post-Load Link Integrity & Failure Injection Proof
  // --------------------------------------------------------------------------
  describe('C. Post-Load Referential Link Integrity (Failure Injection Proof)', () => {
    it('verifies relationship link integrity when referenced entity exists', async () => {
      const validReferenceRecords = [
        {
          sourceRow: 1,
          targetId: 'cont-uuid-1',
          data: {
            company_id: 'comp-uuid-valid-100',
          },
        },
      ];

      const mockLookup = async (entity: string, id: string) => {
        return entity === 'companies' && id === 'comp-uuid-valid-100';
      };

      const report = await service.validateRecords({
        batchId: 'batch-link-001',
        module: 'crm-1',
        entity: 'contacts',
        phase: 'post_load',
        records: validReferenceRecords,
        lookupTargetEntity: mockLookup,
      });

      expect(report.isValid).toBe(true);
      expect(report.failures).toHaveLength(0);
    });

    it('FAILS validation when a deliberately missing company relationship is injected', async () => {
      // Deliberately missing company relationship
      const brokenRecords = [
        {
          sourceRow: 42,
          targetId: 'cont-uuid-orphan-42',
          data: {
            company_id: 'comp-uuid-non-existent-999',
          },
        },
      ];

      const mockLookup = async (entity: string, id: string) => {
        // Simulates database check: comp-uuid-non-existent-999 does not exist
        return id === 'comp-uuid-valid-100';
      };

      const report = await service.validateRecords({
        batchId: 'batch-link-injected-fail',
        module: 'crm-1',
        entity: 'contacts',
        phase: 'post_load',
        records: brokenRecords,
        lookupTargetEntity: mockLookup,
      });

      // Link integrity failure makes validation fail
      expect(report.isValid).toBe(false);
      expect(report.failures).toHaveLength(1);

      const linkFailure = report.failures[0]!;
      expect(linkFailure.ruleId).toBe('CRM1-VAL-REL-01');
      expect(linkFailure.sourceRow).toBe(42);
      expect(linkFailure.targetId).toBe('cont-uuid-orphan-42');
      expect(linkFailure.reasonCode).toBe(VALIDATION_REASON_CODES.RELATIONSHIP_NOT_FOUND);
      expect(linkFailure.message).toContain('comp-uuid-non-existent-999');
      expect(linkFailure.severity).toBe('error');
    });

    it('enforces that link integrity failure strictly BLOCKS downstream reconciliation', async () => {
      const brokenReport = {
        batchId: 'batch-blocked-reconcile',
        module: 'crm-1',
        phase: 'post_load' as const,
        totalChecked: 10,
        passedCount: 9,
        failedCount: 1,
        isValid: false,
        timestamp: new Date().toISOString(),
        checksum: 'synth-checksum-1234',
        failures: [
          {
            ruleId: 'CRM1-VAL-REL-01',
            sourceRow: 42,
            entity: 'contacts',
            field: 'company_id',
            reasonCode: VALIDATION_REASON_CODES.RELATIONSHIP_NOT_FOUND,
            message: 'Referenced company does not exist',
            severity: 'error' as const,
          },
        ],
      };

      // Non-negotiable constraint: reconciliation/signoff cannot report success on validation failure
      expect(() => {
        service.assertBatchCanReconcile(brokenReport);
      }).toThrow(/\[RECONCILIATION GATE\] Batch 'batch-blocked-reconcile' cannot proceed to reconciliation/);
    });

    it('allows downstream reconciliation when validation is completely valid', () => {
      const validReport = {
        batchId: 'batch-allowed-reconcile',
        module: 'crm-1',
        phase: 'post_load' as const,
        totalChecked: 10,
        passedCount: 10,
        failedCount: 0,
        isValid: true,
        timestamp: new Date().toISOString(),
        checksum: 'synth-checksum-valid',
        failures: [],
      };

      expect(() => {
        service.assertBatchCanReconcile(validReport);
      }).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // SECTION D: Determinism, Checksums & Event Payload
  // --------------------------------------------------------------------------
  describe('D. Determinism, Checksums & Event Emission', () => {
    it('produces identical deterministic failure order and SHA-256 checksums across runs', async () => {
      const mixedRecords = [
        {
          sourceRow: 10,
          data: { first_name: '', last_name: 'A', golden_id: 'G1', email: 'invalid' },
        },
        {
          sourceRow: 2,
          data: { first_name: 'B', last_name: '', golden_id: 'G2' },
        },
        {
          sourceRow: 5,
          data: { first_name: 'C', last_name: 'C', golden_id: '' },
        },
      ];

      const report1 = await service.validateRecords({
        batchId: 'batch-deterministic',
        module: 'crm-1',
        entity: 'contacts',
        phase: 'pre_load',
        records: mixedRecords,
      });

      const report2 = await service.validateRecords({
        batchId: 'batch-deterministic',
        module: 'crm-1',
        entity: 'contacts',
        phase: 'pre_load',
        records: mixedRecords,
      });

      expect(report1.checksum).toBe(report2.checksum);
      expect(report1.failures).toEqual(report2.failures);

      // Verify failure ordering: sourceRow 2 before 5 before 10
      expect(report1.failures[0]?.sourceRow).toBe(2);
      expect(report1.failures[1]?.sourceRow).toBe(5);
      expect(report1.failures[2]?.sourceRow).toBe(10);
    });

    it('creates compliant batch.validated event payload', async () => {
      const report = await service.validateRecords({
        batchId: 'batch-event-test',
        module: 'crm-1',
        entity: 'contacts',
        phase: 'pre_load',
        records: [
          {
            sourceRow: 1,
            data: { first_name: 'Valid', last_name: 'User', golden_id: 'GLD-1' },
          },
        ],
      });

      const eventPayload = service.createBatchValidatedEvent(report);
      const parsed = BatchValidatedEventPayloadSchema.safeParse(eventPayload);

      expect(parsed.success).toBe(true);
      expect(eventPayload.batch_id).toBe('batch-event-test');
      expect(eventPayload.is_valid).toBe(true);
      expect(eventPayload.validation_failures).toBe(0);
      expect(typeof eventPayload.checksum).toBe('string');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION E: Database Step Ledger Persistence Simulation
  // --------------------------------------------------------------------------
  describe('E. Database Step Ledger Persistence & Status Transition', () => {
    it('persists step ledger entry and sets batch status to validated on success', async () => {
      const queriesExecuted: Array<{ sql: string; params: any[] }> = [];

      const mockDb = {
        query: async (sql: string, params: any[]) => {
          queriesExecuted.push({ sql, params });
          return { rows: [{ id: 'step-uuid-123' }] };
        },
      };

      const validReport = {
        batchId: 'batch-db-pass',
        module: 'crm-1',
        phase: 'post_load' as const,
        totalChecked: 50,
        passedCount: 50,
        failedCount: 0,
        isValid: true,
        timestamp: new Date().toISOString(),
        checksum: 'hash-pass',
        failures: [],
      };

      const result = await service.persistValidationResult(validReport, mockDb);

      expect(result.status).toBe('validated');
      expect(result.stepId).toBe('step-uuid-123');

      // Verify kit_batch_steps was recorded
      expect(queriesExecuted.some((q) => q.sql.includes('kit_batch_steps'))).toBe(true);
      // Verify kit_batches status was updated to validated
      const batchUpdate = queriesExecuted.find((q) => q.sql.includes('UPDATE public.kit_batches'));
      expect(batchUpdate).toBeDefined();
      expect(batchUpdate?.params[0]).toBe('validated');
    });

    it('persists step ledger entry and sets batch status to failed on validation failure', async () => {
      const queriesExecuted: Array<{ sql: string; params: any[] }> = [];

      const mockDb = {
        query: async (sql: string, params: any[]) => {
          queriesExecuted.push({ sql, params });
          return { rows: [{ id: 'step-uuid-fail-456' }] };
        },
      };

      const failedReport = {
        batchId: 'batch-db-fail',
        module: 'crm-1',
        phase: 'post_load' as const,
        totalChecked: 50,
        passedCount: 48,
        failedCount: 2,
        isValid: false,
        timestamp: new Date().toISOString(),
        checksum: 'hash-fail',
        failures: [
          {
            ruleId: 'CRM1-VAL-REL-01',
            sourceRow: 15,
            entity: 'contacts',
            reasonCode: VALIDATION_REASON_CODES.RELATIONSHIP_NOT_FOUND,
            message: 'Referenced company not found',
            severity: 'error' as const,
          },
        ],
      };

      const result = await service.persistValidationResult(failedReport, mockDb);

      expect(result.status).toBe('failed');

      const batchUpdate = queriesExecuted.find((q) => q.sql.includes('UPDATE public.kit_batches'));
      expect(batchUpdate).toBeDefined();
      expect(batchUpdate?.params[0]).toBe('failed');
      expect(batchUpdate?.params[1]).toBe('VALIDATION_FAILED');
    });
  });
});
