import {
  type ValueConversionRule,
  type TargetFieldDefinition,
} from '@clearshift/contracts';
import { InvalidEnumConversionError } from './types.js';

export interface ValueConversionResult {
  outcome: 'converted' | 'rejected' | 'warning';
  value: string | null;
  warning?: string | undefined;
  rejectReason?: string | undefined;
}

export class ValueConverter {
  private rulesByField: Map<string, ValueConversionRule> = new Map();
  private targetFieldsByName: Map<string, TargetFieldDefinition> = new Map();

  constructor(
    rules: ValueConversionRule[] = [],
    targetFields: TargetFieldDefinition[] = []
  ) {
    for (const rule of rules) {
      this.rulesByField.set(rule.targetField, rule);
    }
    for (const field of targetFields) {
      this.targetFieldsByName.set(field.name, field);
    }
  }

  /**
   * Converts a raw value for a target field according to conversion rules and enum constraints.
   */
  convert(targetFieldName: string, rawValue: unknown): ValueConversionResult {
    if (rawValue === null || rawValue === undefined) {
      return { outcome: 'converted', value: null };
    }

    const strValue = String(rawValue).trim();
    if (strValue === '') {
      return { outcome: 'converted', value: null };
    }

    const rule = this.rulesByField.get(targetFieldName);
    const targetFieldDef = this.targetFieldsByName.get(targetFieldName);

    let convertedValue: string | null = strValue;
    let warning: string | undefined;

    if (rule) {
      // 1. Direct key match (case-sensitive first, then case-insensitive)
      if (rule.mappings[strValue] !== undefined) {
        convertedValue = rule.mappings[strValue];
      } else {
        const lowerKey = strValue.toLowerCase();
        let matchedVal: string | undefined;
        for (const [k, v] of Object.entries(rule.mappings)) {
          if (k.toLowerCase() === lowerKey) {
            matchedVal = v;
            break;
          }
        }

        if (matchedVal !== undefined) {
          convertedValue = matchedVal;
        } else {
          // Unmapped value handling
          switch (rule.unmappedAction) {
            case 'reject':
              return {
                outcome: 'rejected',
                value: null,
                rejectReason: `Value '${strValue}' for field '${targetFieldName}' has no valid conversion mapping`,
              };
            case 'use_default':
              convertedValue = rule.defaultValue ?? null;
              break;
            case 'flag_warning':
              convertedValue = strValue;
              warning = `Unmapped value '${strValue}' for field '${targetFieldName}' kept without conversion`;
              break;
            case 'pass_through':
            default:
              convertedValue = strValue;
              break;
          }
        }
      }
    }

    // 2. Enum Allowed-Values Validation
    const fieldType = (targetFieldDef as any)?.dataType ?? targetFieldDef?.type;
    const allowed = ((targetFieldDef as any)?.allowedValues ?? (targetFieldDef as any)?.enumOptions) as readonly string[] | undefined;
    if (
      targetFieldDef &&
      fieldType === 'enum' &&
      allowed &&
      allowed.length > 0 &&
      convertedValue !== null
    ) {
      const isAllowed = allowed.includes(convertedValue);

      if (!isAllowed) {
        // Try case-insensitive matching against allowed enum values
        const normalizedMatch = allowed.find(
          (a: string) => a.toLowerCase() === convertedValue!.toLowerCase()
        );

        if (normalizedMatch) {
          convertedValue = normalizedMatch;
        } else {
          // Disallowed enum value
          if (targetFieldDef.required || (rule && rule.unmappedAction === 'reject')) {
            return {
              outcome: 'rejected',
              value: null,
              rejectReason: `Converted value '${convertedValue}' for enum field '${targetFieldName}' is not in allowed values: [${allowed.join(', ')}]`,
            };
          } else {
            warning = `Enum value '${convertedValue}' for optional field '${targetFieldName}' is not in allowed list [${allowed.join(', ')}]`;
          }
        }
      }
    }

    return {
      outcome: warning ? 'warning' : 'converted',
      value: convertedValue,
      ...(warning ? { warning } : {}),
    };
  }
}
