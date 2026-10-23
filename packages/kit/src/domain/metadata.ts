/**
 * ClearShift Migration Kit — Target Schema & Field Metadata Domain (KIT-14 / ERP1-22)
 *
 * Defines the canonical types, domain interfaces, and registry for module target
 * schema metadata supplied to the shared Migration Kit wizard.
 *
 * Enforces:
 * - Module target field definitions, human-readable labels, enum options, and required constraints.
 * - Central MigrationKitRegistry for cross-module discovery without duplicate wizards.
 * - Incompatible source type detection and operator warning.
 * - Required unmapped field validation to prevent unmapped dry-run and load execution.
 *
 * @module kit/domain/metadata
 */

export type TargetFieldType =
  | 'string'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'uuid';

export interface TargetFieldDefinition {
  readonly name: string;
  readonly label: string;
  readonly type: TargetFieldType;
  readonly required: boolean;
  readonly description?: string | undefined;
  readonly enumOptions?: readonly string[] | undefined;
  readonly rules?: readonly string[] | undefined;
  readonly example?: string | number | boolean | undefined;
}

export interface TargetEntityMetadata {
  readonly entity: string;
  readonly label: string;
  readonly module: string;
  readonly schemaVersion: number;
  readonly targetTable: string;
  readonly primaryKey: string;
  readonly naturalKey?: string | undefined;
  readonly fields: readonly TargetFieldDefinition[];
  readonly mappingDefaults?: Readonly<Record<string, string>> | undefined;
  readonly validationRules?: readonly {
    readonly code: string;
    readonly description: string;
  }[] | undefined;
}

export interface ModuleKitMetadata {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly defaultEntity: string;
  readonly entities: Readonly<Record<string, TargetEntityMetadata>>;
  readonly supportedSourceTypes?: readonly string[] | undefined;
}


/**
 * In-memory registry storing registered module metadata for the shared Migration Kit wizard.
 */
export class MigrationKitRegistry {
  private readonly modules = new Map<string, ModuleKitMetadata>();

  register(metadata: ModuleKitMetadata): void {
    if (!metadata.moduleId) {
      throw new Error('ModuleKitMetadata must specify a non-empty moduleId');
    }
    this.modules.set(metadata.moduleId, metadata);
  }

  get(moduleId: string): ModuleKitMetadata | undefined {
    return this.modules.get(moduleId);
  }

  getEntity(moduleId: string, entityName: string): TargetEntityMetadata | undefined {
    const mod = this.modules.get(moduleId);
    if (!mod) return undefined;
    return mod.entities[entityName];
  }

  getAll(): readonly ModuleKitMetadata[] {
    return Array.from(this.modules.values());
  }

  clear(): void {
    this.modules.clear();
  }
}

export const migrationKitRegistry = new MigrationKitRegistry();

export function registerModuleKitMetadata(metadata: ModuleKitMetadata): void {
  migrationKitRegistry.register(metadata);
}

export function getModuleKitMetadata(moduleId: string): ModuleKitMetadata | undefined {
  return migrationKitRegistry.get(moduleId);
}

export interface TypeCompatibilityResult {
  readonly compatible: boolean;
  readonly warning?: string | undefined;
  readonly error?: string | undefined;
}


/**
 * Checks whether an incoming source column data type is compatible with a target field type.
 * Returns warnings for lossy conversions or enum mismatches, and errors for completely incompatible types.
 */
export function checkTypeCompatibility(
  sourceType: string | undefined,
  targetType: TargetFieldType,
  enumOptions?: readonly string[]
): TypeCompatibilityResult {
  if (!sourceType || sourceType.trim() === '') {
    return { compatible: true };
  }

  const normalizedSource = sourceType.toLowerCase().trim();

  // Decimal / Number target
  if (targetType === 'decimal' || targetType === 'number') {
    if (['number', 'integer', 'float', 'decimal', 'numeric'].includes(normalizedSource)) {
      return { compatible: true };
    }
    if (['string', 'text', 'varchar'].includes(normalizedSource)) {
      return {
        compatible: true,
        warning: `Text column will be parsed into numeric ${targetType}. Ensure values contain only valid non-negative digits.`,
      };
    }
    return {
      compatible: false,
      warning: `Incompatible type: source type '${sourceType}' cannot be safely converted to ${targetType}.`,
      error: `Cannot convert ${sourceType} to ${targetType}`,
    };
  }

  // Boolean target
  if (targetType === 'boolean') {
    if (['boolean', 'bool'].includes(normalizedSource)) {
      return { compatible: true };
    }
    if (['string', 'text', 'number', 'integer'].includes(normalizedSource)) {
      return {
        compatible: true,
        warning: `Source type '${sourceType}' will be coerced to boolean (true/false, 1/0, yes/no).`,
      };
    }
    return {
      compatible: false,
      warning: `Incompatible type: source type '${sourceType}' cannot be converted to boolean.`,
      error: `Cannot convert ${sourceType} to boolean`,
    };
  }

  // Date target
  if (targetType === 'date') {
    if (['date', 'datetime', 'timestamp'].includes(normalizedSource)) {
      return { compatible: true };
    }
    if (['string', 'text'].includes(normalizedSource)) {
      return {
        compatible: true,
        warning: 'Text column must follow ISO-8601 date format (YYYY-MM-DD).',
      };
    }
    return {
      compatible: false,
      warning: `Incompatible type: source type '${sourceType}' cannot be converted to date.`,
      error: `Cannot convert ${sourceType} to date`,
    };
  }

  // Enum target
  if (targetType === 'enum') {
    const allowed = enumOptions?.join(', ') ?? '';
    if (['string', 'text', 'varchar'].includes(normalizedSource)) {
      return {
        compatible: true,
        warning: allowed ? `Values must strictly match one of the allowed options: [${allowed}].` : undefined,
      };
    }
    return {
      compatible: false,
      warning: `Incompatible type: source type '${sourceType}' cannot be mapped to enum [${allowed}].`,
      error: `Cannot convert ${sourceType} to enum`,
    };
  }

  // UUID target
  if (targetType === 'uuid') {
    if (['uuid'].includes(normalizedSource)) {
      return { compatible: true };
    }
    if (['string', 'text', 'varchar'].includes(normalizedSource)) {
      return {
        compatible: true,
        warning: 'Text column must be a valid RFC 4122 UUID.',
      };
    }
    return {
      compatible: false,
      warning: `Incompatible type: source type '${sourceType}' cannot be mapped to UUID.`,
      error: `Cannot convert ${sourceType} to UUID`,
    };
  }

  // Default string target is compatible with any type via stringification
  return { compatible: true };
}

export interface MappingValidationResult {
  readonly valid: boolean;
  readonly missingRequiredFields: readonly string[];
  readonly warnings: readonly {
    readonly targetField: string;
    readonly sourceColumn: string;
    readonly warning: string;
  }[];
  readonly errors: readonly {
    readonly targetField: string;
    readonly sourceColumn: string;
    readonly error: string;
  }[];
}

/**
 * Validates a field mapping configuration against a target entity definition.
 * Enforces that all required fields are mapped and detects any incompatible type mappings.
 */
export function validateFieldMapping(
  entity: TargetEntityMetadata,
  mapping: Record<string, string>,
  sourceColumnTypes?: Record<string, string>
): MappingValidationResult {
  const missingRequired: string[] = [];
  const warnings: Array<{ targetField: string; sourceColumn: string; warning: string }> = [];
  const errors: Array<{ targetField: string; sourceColumn: string; error: string }> = [];

  for (const field of entity.fields) {
    const rawVal = mapping[field.name];
    const mappedSource = typeof rawVal === 'string' ? rawVal.trim() : '';

    if (field.required && mappedSource === '') {
      missingRequired.push(field.label || field.name);
    } else if (mappedSource !== '' && sourceColumnTypes) {
      const sourceType = sourceColumnTypes[mappedSource];
      if (sourceType) {
        const compat = checkTypeCompatibility(sourceType, field.type, field.enumOptions);
        if (!compat.compatible && compat.warning) {
          warnings.push({
            targetField: field.name,
            sourceColumn: mappedSource,
            warning: compat.warning,
          });
          if (compat.error) {
            errors.push({
              targetField: field.name,
              sourceColumn: mappedSource,
              error: compat.error,
            });
          }
        } else if (compat.warning) {
          warnings.push({
            targetField: field.name,
            sourceColumn: mappedSource,
            warning: compat.warning,
          });
        }
      }
    }
  }

  return {
    valid: missingRequired.length === 0 && errors.length === 0,
    missingRequiredFields: missingRequired,
    warnings,
    errors,
  };
}
