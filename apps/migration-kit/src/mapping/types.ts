import type {
  MappingTemplate,
  CleanCrmRow,
  TargetFieldDefinition,
  MappingValidationResult,
  ValueConversionRule,
} from '@clearshift/contracts';

export interface IMappingTemplateRepository {
  saveTemplate(template: MappingTemplate): Promise<MappingTemplate>;
  getTemplateById(id: string): Promise<MappingTemplate | null>;
  getTemplateByName(module: string, name: string): Promise<MappingTemplate | null>;
  listTemplates(module?: string): Promise<MappingTemplate[]>;
}

export interface ICleanCrmRepository {
  saveRows(rows: CleanCrmRow[]): Promise<void>;
  findByBatchId(batchId: string): Promise<CleanCrmRow[]>;
}

export interface MappingServiceOptions {
  templateId?: string | undefined;
  templateName?: string | undefined;
  actor?: string | undefined;
}

export interface MappingExecutionResult {
  batchId: string;
  module: string;
  targetEntity: string;
  mappedRows: number;
  rejectedRows: number;
  totalRows: number;
  durationMs: number;
  templateId?: string | undefined;
  templateName?: string | undefined;
}

/**
 * Custom Error for missing required target field mapping
 * Strictly includes field and template identifiers as mandated by TS/AC.
 */
export class MissingRequiredTargetMappingError extends Error {
  public readonly code = 'MISSING_REQUIRED_MAPPING';
  public readonly statusCode = 422;

  constructor(
    public readonly missingFields: string[],
    public readonly templateName: string,
    public readonly templateId?: string | undefined,
    public readonly moduleName?: string | undefined
  ) {
    const tplInfo = templateId
      ? `template '${templateName}' (ID: ${templateId}, Module: ${moduleName ?? 'unknown'})`
      : `template '${templateName}' (Module: ${moduleName ?? 'unknown'})`;
    super(
      `Required target field(s) [${missingFields.join(', ')}] have no source column mapping in ${tplInfo}`
    );
    this.name = 'MissingRequiredTargetMappingError';
  }
}

/**
 * Custom Error when an unauthorized editor attempts to modify a module-scoped template
 */
export class UnauthorizedTemplateEditError extends Error {
  public readonly code = 'UNAUTHORIZED_TEMPLATE_EDIT';
  public readonly statusCode = 403;

  constructor(
    public readonly actor: string,
    public readonly actorRole: string,
    public readonly templateModule: string
  ) {
    super(
      `Actor '${actor}' with role '${actorRole}' is not authorized to create or modify templates for module '${templateModule}'`
    );
    this.name = 'UnauthorizedTemplateEditError';
  }
}

/**
 * Custom Error for invalid enum value conversion
 */
export class InvalidEnumConversionError extends Error {
  public readonly code = 'INVALID_ENUM_CONVERSION';
  public readonly statusCode = 422;

  constructor(
    public readonly targetField: string,
    public readonly sourceValue: string,
    public readonly allowedValues: string[],
    public readonly reason?: string | undefined
  ) {
    super(
      `Invalid enum conversion on field '${targetField}': value '${sourceValue}' cannot be mapped to allowed values [${allowedValues.join(', ')}]${reason ? ` (${reason})` : ''}`
    );
    this.name = 'InvalidEnumConversionError';
  }
}
