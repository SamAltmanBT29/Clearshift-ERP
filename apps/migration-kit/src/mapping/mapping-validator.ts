import {
  type MappingTemplate,
  type TargetFieldDefinition,
  type MappingValidationResult,
} from '@clearshift/contracts';
import { MissingRequiredTargetMappingError } from './types.js';

export class MappingValidator {
  /**
   * Validates a mapping template against target entity field definitions.
   * Enforces that all required target fields have mapped source columns.
   * Fails with explicit field and template identifiers.
   */
  static validate(
    template: MappingTemplate,
    targetFields: TargetFieldDefinition[],
    sourceHeaders?: string[]
  ): MappingValidationResult {
    const missingRequiredFields: string[] = [];
    const invalidEnumConversions: Array<{ field: string; sourceValue: string; reason: string }> = [];
    const errors: string[] = [];

    const fieldMap = new Map<string, string>();
    for (const mapping of template.fieldMappings) {
      if (mapping.sourceColumn && mapping.sourceColumn.trim()) {
        fieldMap.set(mapping.targetField, mapping.sourceColumn.trim());
      }
    }

    const targetDefMap = new Map<string, TargetFieldDefinition>();
    for (const tf of targetFields) {
      targetDefMap.set(tf.name, tf);
    }

    // 1. Required Target Fields Enforcement
    for (const targetField of targetFields) {
      if (targetField.required) {
        const mappedSource = fieldMap.get(targetField.name);
        if (!mappedSource) {
          missingRequiredFields.push(targetField.name);
          const tplId = template.id ?? 'unsaved';
          errors.push(
            `Required target field '${targetField.name}' (${targetField.label}) has no source column mapping in template '${template.name}' (ID: ${tplId}, Module: ${template.module})`
          );
        }
      }
    }

    // 2. Enum Conversion Integrity
    for (const convRule of template.valueConversions) {
      const fieldDef = targetDefMap.get(convRule.targetField);
      const fieldType = (fieldDef as any)?.dataType ?? fieldDef?.type;
      const allowed = ((fieldDef as any)?.allowedValues ?? (fieldDef as any)?.enumOptions) as readonly string[] | undefined;
      if (fieldDef && fieldType === 'enum' && allowed) {
        for (const [sourceVal, targetVal] of Object.entries(convRule.mappings)) {
          const isValidTarget =
            allowed.includes(targetVal) ||
            allowed.some((a: string) => a.toLowerCase() === targetVal.toLowerCase());

          if (!isValidTarget) {
            const reason = `Target conversion value '${targetVal}' is not in allowed values: [${allowed.join(', ')}] for field '${convRule.targetField}' in template '${template.name}' (ID: ${template.id ?? 'unsaved'})`;
            invalidEnumConversions.push({
              field: convRule.targetField,
              sourceValue: sourceVal,
              reason,
            });
            errors.push(reason);
          }
        }
      }
    }

    // 3. Source Column Existence Check (if source headers supplied)
    if (sourceHeaders && sourceHeaders.length > 0) {
      const headerSet = new Set(sourceHeaders.map((h) => h.trim().toLowerCase()));
      for (const mapping of template.fieldMappings) {
        if (mapping.sourceColumn && !headerSet.has(mapping.sourceColumn.trim().toLowerCase())) {
          errors.push(
            `Mapped source column '${mapping.sourceColumn}' does not exist in source file headers [${sourceHeaders.join(', ')}] in template '${template.name}'`
          );
        }
      }
    }

    // 4. Duplicate Target Field Mappings
    const targetCounts = new Map<string, number>();
    for (const mapping of template.fieldMappings) {
      if (mapping.targetField) {
        targetCounts.set(mapping.targetField, (targetCounts.get(mapping.targetField) ?? 0) + 1);
      }
    }
    for (const [targetField, count] of targetCounts.entries()) {
      if (count > 1) {
        errors.push(
          `Target field '${targetField}' is mapped multiple (${count}) times in template '${template.name}'`
        );
      }
    }

    return {
      valid: missingRequiredFields.length === 0 && invalidEnumConversions.length === 0 && errors.length === 0,
      missingRequiredFields,
      invalidEnumConversions,
      errors,
    };
  }

  /**
   * Asserts validity and throws MissingRequiredTargetMappingError if required fields are missing.
   */
  static assertValid(
    template: MappingTemplate,
    targetFields: TargetFieldDefinition[],
    sourceHeaders?: string[]
  ): void {
    const result = this.validate(template, targetFields, sourceHeaders);
    if (!result.valid) {
      if (result.missingRequiredFields.length > 0) {
        throw new MissingRequiredTargetMappingError(
          result.missingRequiredFields,
          template.name,
          template.id,
          template.module
        );
      }
      throw new Error(`Mapping validation failed: ${result.errors.join('; ')}`);
    }
  }
}
