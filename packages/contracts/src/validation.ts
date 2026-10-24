import { z } from 'zod';

/**
 * Validation Rule Types supported by the Migration Kit validation engine (KIT-06)
 */
export const ValidationRuleTypeSchema = z.enum([
  'required_field',
  'format',
  'enum',
  'relationship',
  'domain',
]);
export type ValidationRuleType = z.infer<typeof ValidationRuleTypeSchema>;

/**
 * Validation execution phase: pre-load (transformed records) vs post-load (database/target records)
 */
export const ValidationPhaseSchema = z.enum(['pre_load', 'post_load']);
export type ValidationPhase = z.infer<typeof ValidationPhaseSchema>;

/**
 * Severity level of validation failures
 */
export const ValidationSeveritySchema = z.enum(['error', 'warning']);
export type ValidationSeverity = z.infer<typeof ValidationSeveritySchema>;

/**
 * Standard Reason Codes for deterministic failure categorization
 */
export const VALIDATION_REASON_CODES = {
  REQUIRED_FIELD_MISSING: 'REQUIRED_FIELD_MISSING',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_ENUM_VALUE: 'INVALID_ENUM_VALUE',
  RELATIONSHIP_NOT_FOUND: 'RELATIONSHIP_NOT_FOUND',
  DOMAIN_RULE_VIOLATION: 'DOMAIN_RULE_VIOLATION',
} as const;
export type ValidationReasonCode =
  (typeof VALIDATION_REASON_CODES)[keyof typeof VALIDATION_REASON_CODES];

/**
 * A single failure item emitted by a validation rule
 */
export const ValidationFailureSchema = z.object({
  ruleId: z.string(),
  sourceRow: z.number().int().nonnegative(),
  targetId: z.string().optional(),
  entity: z.string(),
  field: z.string().optional(),
  reasonCode: z.string(),
  message: z.string(),
  severity: ValidationSeveritySchema.default('error'),
  receivedValue: z.unknown().optional(),
});
export type ValidationFailure = z.infer<typeof ValidationFailureSchema>;

/**
 * Comprehensive Validation Report summarizing validation run
 */
export const ValidationReportSchema = z.object({
  batchId: z.string(),
  module: z.string(),
  phase: ValidationPhaseSchema,
  totalChecked: z.number().int().nonnegative(),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  failures: z.array(ValidationFailureSchema),
  isValid: z.boolean(),
  timestamp: z.string(),
  checksum: z.string(),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

/**
 * Event payload for `batch.validated` event (EV-06 / SDS §4.8)
 */
export const BatchValidatedEventPayloadSchema = z.object({
  batch_id: z.string(),
  module: z.string(),
  total_checked: z.number().int().nonnegative(),
  validation_failures: z.number().int().nonnegative(),
  is_valid: z.boolean(),
  checksum: z.string(),
  timestamp: z.string(),
});
export type BatchValidatedEventPayload = z.infer<typeof BatchValidatedEventPayloadSchema>;
