import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import {
  type MappingTemplate,
  MappingTemplateSchema,
  FieldMappingDefinition,
  ValueConversionRule,
} from '@clearshift/contracts';
import { kitMappings } from '../db/schema.js';
import {
  IMappingTemplateRepository,
  UnauthorizedTemplateEditError,
} from './types.js';

/**
 * Canonical Default CRM Contacts Mapping Template (v1.0.0)
 */
export const DEFAULT_CRM_CONTACTS_TEMPLATE: MappingTemplate = {
  id: '00000000-0000-0000-0000-000000000001',
  module: 'crm',
  name: 'CRM Contacts Standard Template',
  version: '1.0.0',
  targetEntity: 'contacts',
  fieldMappings: [
    { sourceColumn: 'first_name', targetField: 'firstName', required: true, transformation: 'identity' },
    { sourceColumn: 'last_name', targetField: 'lastName', required: true, transformation: 'identity' },
    { sourceColumn: 'email', targetField: 'email', required: true, transformation: 'identity' },
    { sourceColumn: 'phone', targetField: 'phone', required: false, transformation: 'identity' },
    { sourceColumn: 'company', targetField: 'company', required: false, transformation: 'identity' },
    { sourceColumn: 'country', targetField: 'country', required: false, transformation: 'identity' },
  ],
  valueConversions: [],
  createdBy: 'system',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

/**
 * Canonical Default CRM Leads Mapping Template (v1.0.0)
 */
export const DEFAULT_CRM_LEADS_TEMPLATE: MappingTemplate = {
  id: '00000000-0000-0000-0000-000000000002',
  module: 'crm',
  name: 'CRM Leads Standard Template',
  version: '1.0.0',
  targetEntity: 'leads',
  fieldMappings: [
    { sourceColumn: 'first_name', targetField: 'firstName', required: true, transformation: 'identity' },
    { sourceColumn: 'last_name', targetField: 'lastName', required: true, transformation: 'identity' },
    { sourceColumn: 'email', targetField: 'email', required: true, transformation: 'identity' },
    { sourceColumn: 'phone', targetField: 'phone', required: false, transformation: 'identity' },
    { sourceColumn: 'company', targetField: 'company', required: false, transformation: 'identity' },
    { sourceColumn: 'status', targetField: 'leadStatus', required: true, transformation: 'identity' },
  ],
  valueConversions: [
    {
      targetField: 'leadStatus',
      mappings: {
        NEW: 'New',
        OPEN: 'New',
        IN_PROGRESS: 'Working',
        WORKING: 'Working',
        QUALIFIED: 'Qualified',
        LOST: 'Closed',
        CLOSED: 'Closed',
      },
      unmappedAction: 'reject',
    },
  ],
  createdBy: 'system',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

/**
 * Asserts that the actor possesses permission to create/modify templates for the target module.
 */
export function assertTemplateEditorPermission(
  actor: string,
  actorRole: string,
  templateModule: string
): void {
  // Global administrative roles have full oversight
  if (
    actorRole === 'migration_admin' ||
    actorRole === 'platform_admin' ||
    actorRole === 'system'
  ) {
    return;
  }

  // Module-specific admin/integration roles
  if (templateModule.startsWith('crm') && (actorRole === 'crm_admin' || actorRole === 'crm_integration')) {
    return;
  }

  if (templateModule.startsWith('erp') && (actorRole === 'erp_admin' || actorRole === 'erp_integration')) {
    return;
  }

  throw new UnauthorizedTemplateEditError(actor, actorRole, templateModule);
}

/**
 * In-Memory Template Repository
 */
export class InMemoryMappingTemplateRepository implements IMappingTemplateRepository {
  private templates: Map<string, MappingTemplate> = new Map();

  constructor(seedDefaults: boolean = true) {
    if (seedDefaults) {
      this.templates.set(DEFAULT_CRM_CONTACTS_TEMPLATE.id!, { ...DEFAULT_CRM_CONTACTS_TEMPLATE });
      this.templates.set(DEFAULT_CRM_LEADS_TEMPLATE.id!, { ...DEFAULT_CRM_LEADS_TEMPLATE });
    }
  }

  async saveTemplate(template: MappingTemplate): Promise<MappingTemplate> {
    const validated = MappingTemplateSchema.parse(template);
    const id = validated.id ?? randomUUID();
    const now = new Date();

    const stored: MappingTemplate = {
      ...validated,
      id,
      createdAt: validated.createdAt ?? now,
      updatedAt: now,
    };

    this.templates.set(id, {
      ...stored,
      fieldMappings: stored.fieldMappings.map((f) => ({ ...f })),
      valueConversions: stored.valueConversions.map((v) => ({ ...v, mappings: { ...v.mappings } })),
    });

    return {
      ...stored,
      fieldMappings: stored.fieldMappings.map((f) => ({ ...f })),
      valueConversions: stored.valueConversions.map((v) => ({ ...v, mappings: { ...v.mappings } })),
    };
  }

  async getTemplateById(id: string): Promise<MappingTemplate | null> {
    const found = this.templates.get(id);
    if (!found) return null;
    return {
      ...found,
      fieldMappings: found.fieldMappings.map((f) => ({ ...f })),
      valueConversions: found.valueConversions.map((v) => ({ ...v, mappings: { ...v.mappings } })),
    };
  }

  async getTemplateByName(module: string, name: string): Promise<MappingTemplate | null> {
    for (const tpl of this.templates.values()) {
      if (tpl.module === module && tpl.name.toLowerCase() === name.toLowerCase()) {
        return {
          ...tpl,
          fieldMappings: tpl.fieldMappings.map((f) => ({ ...f })),
          valueConversions: tpl.valueConversions.map((v) => ({ ...v, mappings: { ...v.mappings } })),
        };
      }
    }
    return null;
  }

  async listTemplates(module?: string): Promise<MappingTemplate[]> {
    const list: MappingTemplate[] = [];
    for (const tpl of this.templates.values()) {
      if (!module || tpl.module === module) {
        list.push({
          ...tpl,
          fieldMappings: tpl.fieldMappings.map((f) => ({ ...f })),
          valueConversions: tpl.valueConversions.map((v) => ({ ...v, mappings: { ...v.mappings } })),
        });
      }
    }
    return list;
  }

  clear(): void {
    this.templates.clear();
  }
}

/**
 * PostgreSQL Drizzle Template Repository
 */
export class DrizzleMappingTemplateRepository implements IMappingTemplateRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async saveTemplate(template: MappingTemplate): Promise<MappingTemplate> {
    const validated = MappingTemplateSchema.parse(template);
    const now = new Date();

    if (validated.id) {
      const existing = await this.getTemplateById(validated.id);
      if (existing) {
        await this.db
          .update(kitMappings)
          .set({
            name: validated.name,
            version: validated.version,
            targetEntity: validated.targetEntity,
            mappingJson: validated.fieldMappings,
            valueConversionsJson: validated.valueConversions,
            updatedAt: now,
          })
          .where(eq(kitMappings.id, validated.id));

        return { ...validated, updatedAt: now };
      }
    }

    const insertPayload: typeof kitMappings.$inferInsert = {
      module: validated.module,
      name: validated.name,
      version: validated.version,
      targetEntity: validated.targetEntity,
      mappingJson: validated.fieldMappings,
      valueConversionsJson: validated.valueConversions,
      createdBy: validated.createdBy,
      createdAt: validated.createdAt ?? now,
      updatedAt: now,
    };
    if (validated.id) {
      insertPayload.id = validated.id;
    }

    const [inserted] = await this.db
      .insert(kitMappings)
      .values(insertPayload)
      .returning();

    if (!inserted) {
      throw new Error('Failed to insert mapping template');
    }

    return MappingTemplateSchema.parse({
      id: inserted.id,
      module: inserted.module,
      name: inserted.name,
      version: inserted.version,
      targetEntity: inserted.targetEntity,
      fieldMappings: inserted.mappingJson,
      valueConversions: inserted.valueConversionsJson,
      createdBy: inserted.createdBy,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    });
  }

  async getTemplateById(id: string): Promise<MappingTemplate | null> {
    const [row] = await this.db.select().from(kitMappings).where(eq(kitMappings.id, id)).limit(1);
    if (!row) return null;

    return MappingTemplateSchema.parse({
      id: row.id,
      module: row.module,
      name: row.name,
      version: row.version,
      targetEntity: row.targetEntity,
      fieldMappings: row.mappingJson,
      valueConversions: row.valueConversionsJson,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async getTemplateByName(module: string, name: string): Promise<MappingTemplate | null> {
    const [row] = await this.db
      .select()
      .from(kitMappings)
      .where(and(eq(kitMappings.module, module), eq(kitMappings.name, name)))
      .limit(1);
    if (!row) return null;

    return MappingTemplateSchema.parse({
      id: row.id,
      module: row.module,
      name: row.name,
      version: row.version,
      targetEntity: row.targetEntity,
      fieldMappings: row.mappingJson,
      valueConversions: row.valueConversionsJson,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async listTemplates(module?: string): Promise<MappingTemplate[]> {
    const rows = module
      ? await this.db.select().from(kitMappings).where(eq(kitMappings.module, module))
      : await this.db.select().from(kitMappings);

    return rows.map((r) =>
      MappingTemplateSchema.parse({
        id: r.id,
        module: r.module,
        name: r.name,
        version: r.version,
        targetEntity: r.targetEntity,
        fieldMappings: r.mappingJson,
        valueConversions: r.valueConversionsJson,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })
    );
  }
}
