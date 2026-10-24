import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import {
  type CleanCrmRow,
  type KitReject,
  type MappingTemplate,
  type TargetFieldDefinition,
  CleanCrmRowSchema,
  BatchMappedPayloadSchema,
  createEventEnvelope,
  CRM_CONTACTS_TARGET_FIELDS,
  CRM_TARGET_ENTITIES,
} from '@clearshift/contracts';
import { cleanCrm, kitRejects, outbox } from '../db/schema.js';
import { BatchRegistryService } from '../batches/batch-registry.js';
import { IStgRowsRepository, IKitRejectRepository, IOutboxRepository } from '../clean/clean-service.js';
import {
  IMappingTemplateRepository,
  ICleanCrmRepository,
  MappingServiceOptions,
  MappingExecutionResult,
  MissingRequiredTargetMappingError,
} from './types.js';
import { DEFAULT_CRM_CONTACTS_TEMPLATE } from './template-registry.js';
import { MappingValidator } from './mapping-validator.js';
import { ValueConverter } from './value-converter.js';

/**
 * In-Memory Clean CRM Repository
 */
export class InMemoryCleanCrmRepository implements ICleanCrmRepository {
  private rows: CleanCrmRow[] = [];

  async saveRows(rows: CleanCrmRow[]): Promise<void> {
    this.rows.push(...rows.map((r) => ({ ...r, payload: { ...r.payload } })));
  }

  async findByBatchId(batchId: string): Promise<CleanCrmRow[]> {
    return this.rows
      .filter((r) => r.batchId === batchId)
      .map((r) => ({ ...r, payload: { ...r.payload } }));
  }

  clear(): void {
    this.rows = [];
  }
}

/**
 * PostgreSQL Drizzle Clean CRM Repository
 */
export class DrizzleCleanCrmRepository implements ICleanCrmRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async saveRows(rows: CleanCrmRow[]): Promise<void> {
    if (rows.length === 0) return;

    const values: (typeof cleanCrm.$inferInsert)[] = rows.map((r) => {
      const rowValue: typeof cleanCrm.$inferInsert = {
        batchId: r.batchId,
        sourceRow: r.sourceRow,
        payload: r.payload,
        createdAt: r.createdAt ?? new Date(),
      };
      if (r.id) {
        rowValue.id = r.id;
      }
      return rowValue;
    });

    // Bounded batch insertion (500 rows per chunk)
    const BATCH_SIZE = 500;
    for (let i = 0; i < values.length; i += BATCH_SIZE) {
      const chunk = values.slice(i, i + BATCH_SIZE);
      await this.db.insert(cleanCrm).values(chunk);
    }
  }

  async findByBatchId(batchId: string): Promise<CleanCrmRow[]> {
    const records = await this.db
      .select()
      .from(cleanCrm)
      .where(eq(cleanCrm.batchId, batchId))
      .orderBy(cleanCrm.sourceRow);

    return records.map((r: any) =>
      CleanCrmRowSchema.parse({
        id: r.id,
        batchId: r.batchId,
        sourceRow: r.sourceRow,
        payload: r.payload,
        createdAt: r.createdAt,
      })
    );
  }
}

/**
 * Migration Kit Mapping Service (Step 4: Map)
 *
 * Implements source-column-to-target-field mapping, value conversions,
 * required target field enforcement, clean_crm target isolation, and
 * transactional outbox event emission.
 */
export class MappingService {
  constructor(
    private readonly batchRegistry: BatchRegistryService,
    private readonly templateRepo: IMappingTemplateRepository,
    private readonly stgRowsRepo: IStgRowsRepository,
    private readonly cleanCrmRepo: ICleanCrmRepository,
    private readonly rejectRepo: IKitRejectRepository,
    private readonly outboxRepo: IOutboxRepository
  ) {}

  async executeMapping(
    batchId: string,
    options: MappingServiceOptions = {}
  ): Promise<MappingExecutionResult> {
    const startTime = Date.now();

    // 1. Fetch and validate batch state
    const batch = await this.batchRegistry.getBatchById(batchId);
    if (!batch) {
      throw new Error(`Batch with ID '${batchId}' not found`);
    }

    if (batch.status !== 'cleaned') {
      throw new Error(
        `Batch '${batchId}' is in status '${batch.status}'; Step 4 (Map) requires status 'cleaned'`
      );
    }

    // 2. Select mapping template
    let template: MappingTemplate;
    if (options.templateId) {
      const found = await this.templateRepo.getTemplateById(options.templateId);
      if (!found) {
        throw new Error(`Mapping template with ID '${options.templateId}' not found`);
      }
      template = found;
    } else if (options.templateName) {
      const found = await this.templateRepo.getTemplateByName(batch.module, options.templateName);
      if (!found) {
        throw new Error(
          `Mapping template '${options.templateName}' not found for module '${batch.module}'`
        );
      }
      template = found;
    } else {
      // Use default template for module
      const moduleTemplates = await this.templateRepo.listTemplates(batch.module);
      const first = moduleTemplates.length > 0 ? moduleTemplates[0] : undefined;
      template = first ?? DEFAULT_CRM_CONTACTS_TEMPLATE;
    }

    // 3. Resolve target entity fields
    const targetEntityName = template.targetEntity ?? 'contacts';
    const targetFields: TargetFieldDefinition[] =
      (CRM_TARGET_ENTITIES[targetEntityName]?.fields ?? CRM_CONTACTS_TARGET_FIELDS) as unknown as TargetFieldDefinition[];

    // 4. Validate template against target fields
    // MANDATORY REQUIREMENT: A required target field without source mapping BLOCKS map before any target mutation!
    const validation = MappingValidator.validate(template, targetFields);
    if (!validation.valid) {
      if (validation.missingRequiredFields.length > 0) {
        throw new MissingRequiredTargetMappingError(
          validation.missingRequiredFields,
          template.name,
          template.id,
          template.module
        );
      }
      throw new Error(`Mapping template validation failed: ${validation.errors.join('; ')}`);
    }

    // 5. Fetch cleaned staging rows
    const stagedRows = await this.stgRowsRepo.findByBatchId(batchId);
    const cleanedRows = stagedRows.filter((r) => r.status === 'cleaned');

    // 6. Initialize value converter
    const converter = new ValueConverter(template.valueConversions, targetFields);

    const mappedRows: CleanCrmRow[] = [];
    const newRejects: KitReject[] = [];

    // 7. Execute mapping per row
    for (const stgRow of cleanedRows) {
      const sourcePayload = (stgRow.cleanedPayload ?? {}) as Record<string, unknown>;
      const targetPayload: Record<string, unknown> = {};
      let rowRejected = false;
      let rowRejectReason = '';

      for (const mapping of template.fieldMappings) {
        const rawSourceVal = sourcePayload[mapping.sourceColumn];
        let valToConvert = rawSourceVal !== undefined && rawSourceVal !== null ? String(rawSourceVal) : null;

        if (valToConvert !== null) {
          switch (mapping.transformation) {
            case 'trim':
              valToConvert = valToConvert.trim();
              break;
            case 'uppercase':
              valToConvert = valToConvert.toUpperCase();
              break;
            case 'lowercase':
              valToConvert = valToConvert.toLowerCase();
              break;
            case 'identity':
            default:
              break;
          }
        } else if (mapping.defaultValue) {
          valToConvert = mapping.defaultValue;
        }

        // Apply Value Conversions & Enum Validation
        const conversion = converter.convert(mapping.targetField, valToConvert);
        if (conversion.outcome === 'rejected') {
          rowRejected = true;
          rowRejectReason = conversion.rejectReason ?? `Value conversion failed for ${mapping.targetField}`;
          break;
        }

        if (conversion.value !== null && conversion.value !== undefined) {
          targetPayload[mapping.targetField] = conversion.value;
        }
      }

      if (rowRejected) {
        newRejects.push({
          batchId,
          sourceRow: stgRow.sourceRow,
          entity: targetEntityName,
          reasonCode: 'INVALID_ENUM_CONVERSION',
          reasonText: rowRejectReason,
          rawJson: sourcePayload,
        });
      } else {
        // Only target fields are preserved in clean_crm payload!
        mappedRows.push({
          batchId,
          sourceRow: stgRow.sourceRow,
          payload: targetPayload,
        });
      }
    }

    // 8. Persist mapped target rows into clean_crm
    await this.cleanCrmRepo.saveRows(mappedRows);

    if (newRejects.length > 0) {
      await this.rejectRepo.saveRejects(newRejects);
    }

    const durationMs = Date.now() - startTime;

    // 9. Record step completion and transition batch state to 'mapped'
    await this.batchRegistry.transitionBatch(batchId, {
      targetStatus: 'mapped',
      stepName: 'map',
      recordsIn: cleanedRows.length,
      recordsOut: mappedRows.length,
      recordsRejected: newRejects.length,
      recordsMerged: 0,
      recordsSkipped: 0,
      durationMs,
      actor: options.actor ?? 'migration_worker',
      metadata: {
        templateId: template.id,
        templateName: template.name,
        targetEntity: targetEntityName,
      },
    });

    // 10. Publish domain event to outbox
    const payload = BatchMappedPayloadSchema.parse({
      batchId,
      module: batch.module,
      mappedRows: mappedRows.length,
      missingRequired: 0,
      templateId: template.id,
      templateName: template.name,
      targetEntity: targetEntityName,
      totalRows: cleanedRows.length,
      durationMs,
    });

    const eventEnvelope = createEventEnvelope({
      event_id: randomUUID(),
      event_type: 'batch.mapped',
      entity_type: 'kit_batch',
      entity_id: batchId,
      batch_id: batchId,
      correlation_id: batch.correlationId,
      producer: 'migration-kit.map',
      payload,
    });

    await this.outboxRepo.append(eventEnvelope);

    return {
      batchId,
      module: batch.module,
      targetEntity: targetEntityName,
      mappedRows: mappedRows.length,
      rejectedRows: newRejects.length,
      totalRows: cleanedRows.length,
      durationMs,
      templateId: template.id,
      templateName: template.name,
    };
  }
}
