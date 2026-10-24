import {
  VALIDATION_REASON_CODES,
  ValidationPhase,
  ValidationSeverity,
} from '@clearshift/contracts';
import { ValidationRule, ValidationContext, ValidationRuleResult } from './types.js';

/**
 * Standard Email regular expression pattern (RFC 5322 compatible subset)
 */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Standard Phone regular expression pattern (E.164 compatible or standard dialed format)
 */
const PHONE_REGEX = /^\+?[0-9\s().-]{7,25}$/;

/**
 * Standard UUID regular expression pattern
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Standard ISO 8601 Date format
 */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Helper to create a required field validation rule
 */
export function createRequiredFieldRule(config: {
  ruleId: string;
  module: string;
  entity: string;
  field: string;
  phase?: ValidationPhase;
  severity?: ValidationSeverity;
  description?: string;
}): ValidationRule {
  return {
    ruleId: config.ruleId,
    name: `Required Field: ${config.entity}.${config.field}`,
    description: config.description || `Field '${config.field}' on entity '${config.entity}' is mandatory and cannot be empty.`,
    ruleType: 'required_field',
    phase: config.phase || 'pre_load',
    module: config.module,
    entity: config.entity,
    field: config.field,
    severity: config.severity || 'error',
    validate: (ctx: ValidationContext) => {
      const val = ctx.record?.[config.field];
      const isMissing =
        val === undefined ||
        val === null ||
        (typeof val === 'string' && val.trim().length === 0);

      if (isMissing) {
        return {
          valid: false,
          reasonCode: VALIDATION_REASON_CODES.REQUIRED_FIELD_MISSING,
          message: `Mandatory field '${config.field}' is missing or empty.`,
          field: config.field,
          receivedValue: val,
        };
      }
      return { valid: true };
    },
  };
}

/**
 * Helper to create a format validation rule (email, phone, uuid, date, or custom regex)
 */
export function createFormatRule(config: {
  ruleId: string;
  module: string;
  entity: string;
  field: string;
  format: 'email' | 'phone' | 'uuid' | 'date' | 'custom';
  pattern?: RegExp;
  phase?: ValidationPhase;
  severity?: ValidationSeverity;
  description?: string;
}): ValidationRule {
  return {
    ruleId: config.ruleId,
    name: `Format Validation: ${config.entity}.${config.field} (${config.format})`,
    description: config.description || `Field '${config.field}' must conform to valid ${config.format} format.`,
    ruleType: 'format',
    phase: config.phase || 'pre_load',
    module: config.module,
    entity: config.entity,
    field: config.field,
    severity: config.severity || 'error',
    validate: (ctx: ValidationContext) => {
      const val = ctx.record?.[config.field];
      // Optional fields that are null/empty are not format failures (required_field checks handle presence)
      if (val === undefined || val === null || val === '') {
        return { valid: true };
      }

      if (typeof val !== 'string') {
        return {
          valid: false,
          reasonCode: VALIDATION_REASON_CODES.INVALID_FORMAT,
          message: `Field '${config.field}' must be a string format, received ${typeof val}.`,
          field: config.field,
          receivedValue: val,
        };
      }

      let regex: RegExp;
      switch (config.format) {
        case 'email':
          regex = EMAIL_REGEX;
          break;
        case 'phone':
          regex = PHONE_REGEX;
          break;
        case 'uuid':
          regex = UUID_REGEX;
          break;
        case 'date':
          regex = ISO_DATE_REGEX;
          break;
        case 'custom':
          if (!config.pattern) {
            throw new Error(`Custom format rule ${config.ruleId} requires a pattern RegExp.`);
          }
          regex = config.pattern;
          break;
      }

      if (!regex.test(val.trim())) {
        return {
          valid: false,
          reasonCode: VALIDATION_REASON_CODES.INVALID_FORMAT,
          message: `Value '${val}' in field '${config.field}' does not match expected ${config.format} format.`,
          field: config.field,
          receivedValue: val,
        };
      }

      return { valid: true };
    },
  };
}

/**
 * Helper to create an enum / allowed values validation rule
 */
export function createEnumRule(config: {
  ruleId: string;
  module: string;
  entity: string;
  field: string;
  allowedValues: string[];
  phase?: ValidationPhase;
  severity?: ValidationSeverity;
  description?: string;
}): ValidationRule {
  return {
    ruleId: config.ruleId,
    name: `Enum Validation: ${config.entity}.${config.field}`,
    description: config.description || `Field '${config.field}' must be one of: ${config.allowedValues.join(', ')}.`,
    ruleType: 'enum',
    phase: config.phase || 'pre_load',
    module: config.module,
    entity: config.entity,
    field: config.field,
    severity: config.severity || 'error',
    validate: (ctx: ValidationContext) => {
      const val = ctx.record?.[config.field];
      if (val === undefined || val === null || val === '') {
        return { valid: true };
      }

      if (!config.allowedValues.includes(String(val))) {
        return {
          valid: false,
          reasonCode: VALIDATION_REASON_CODES.INVALID_ENUM_VALUE,
          message: `Value '${val}' is not permitted for field '${config.field}'. Allowed values: ${config.allowedValues.join(', ')}.`,
          field: config.field,
          receivedValue: val,
        };
      }

      return { valid: true };
    },
  };
}

/**
 * Helper to create a relationship / link integrity validation rule
 * (e.g. contact.company_id references an existing company)
 */
export function createRelationshipRule(config: {
  ruleId: string;
  module: string;
  sourceEntity: string;
  foreignKeyField: string;
  targetEntity: string;
  targetIdField?: string;
  phase?: ValidationPhase;
  severity?: ValidationSeverity;
  description?: string;
}): ValidationRule {
  return {
    ruleId: config.ruleId,
    name: `Link Integrity: ${config.sourceEntity}.${config.foreignKeyField} -> ${config.targetEntity}`,
    description: config.description || `Verifies that ${config.sourceEntity}.${config.foreignKeyField} references a valid existing ${config.targetEntity}.`,
    ruleType: 'relationship',
    phase: config.phase || 'post_load',
    module: config.module,
    entity: config.sourceEntity,
    field: config.foreignKeyField,
    severity: config.severity || 'error',
    validate: async (ctx: ValidationContext) => {
      const foreignId = ctx.record?.[config.foreignKeyField];
      // If optional and not provided, link integrity passes
      if (foreignId === undefined || foreignId === null || foreignId === '') {
        return { valid: true };
      }

      // Check existence using lookup function or db query
      let exists = false;
      if (ctx.lookupTargetEntity) {
        exists = await ctx.lookupTargetEntity(config.targetEntity, String(foreignId));
      } else if (ctx.db) {
        // Query database table for existence
        try {
          const tableName = config.targetEntity.includes('.')
            ? config.targetEntity
            : `${config.module.replace('-', '')}.${config.module.replace('-', '')}_${config.targetEntity}`;
          const idField = config.targetIdField || 'id';
          const queryRes = await ctx.db.query(
            `SELECT 1 FROM ${tableName} WHERE ${idField} = $1 LIMIT 1`,
            [foreignId]
          );
          exists = queryRes.rows && queryRes.rows.length > 0;
        } catch {
          exists = false;
        }
      } else {
        // Default optimistic assumption if no resolver provided
        exists = true;
      }

      if (!exists) {
        return {
          valid: false,
          reasonCode: VALIDATION_REASON_CODES.RELATIONSHIP_NOT_FOUND,
          message: `Link integrity failure: Referenced ${config.targetEntity} with ID '${foreignId}' does not exist in target.`,
          field: config.foreignKeyField,
          receivedValue: foreignId,
        };
      }

      return { valid: true };
    },
  };
}

/**
 * Helper to create a custom domain rule
 */
export function createDomainRule(config: {
  ruleId: string;
  module: string;
  entity: string;
  name: string;
  description: string;
  field?: string;
  phase?: ValidationPhase;
  severity?: ValidationSeverity;
  validator: (ctx: ValidationContext) => Promise<ValidationRuleResult> | ValidationRuleResult;
}): ValidationRule {
  return {
    ruleId: config.ruleId,
    name: config.name,
    description: config.description,
    ruleType: 'domain',
    phase: config.phase || 'pre_load',
    module: config.module,
    entity: config.entity,
    field: config.field,
    severity: config.severity || 'error',
    validate: config.validator,
  };
}
