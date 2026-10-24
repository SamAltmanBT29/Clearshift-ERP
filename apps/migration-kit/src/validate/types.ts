import {
  ValidationRuleType,
  ValidationPhase,
  ValidationSeverity,
  ValidationFailure,
  ValidationReport,
  BatchValidatedEventPayload,
} from '@clearshift/contracts';

export type {
  ValidationRuleType,
  ValidationPhase,
  ValidationSeverity,
  ValidationFailure,
  ValidationReport,
  BatchValidatedEventPayload,
};

/**
 * Context provided to a validation rule during execution
 */
export interface ValidationContext<T = any> {
  batchId: string;
  module: string;
  entity: string;
  phase: ValidationPhase;
  record: T;
  sourceRow: number;
  targetId?: string | undefined;
  db?: any;
  lookupTargetEntity?: ((entity: string, id: string) => Promise<boolean>) | undefined;
}

/**
 * Result returned by a single validation rule execution
 */
export interface ValidationRuleResult {
  valid: boolean;
  reasonCode?: string | undefined;
  message?: string | undefined;
  field?: string | undefined;
  targetId?: string | undefined;
  receivedValue?: unknown;
}

/**
 * Definition of a validation rule in the registry
 */
export interface ValidationRule<T = any> {
  ruleId: string;
  name: string;
  description: string;
  ruleType: ValidationRuleType;
  phase: ValidationPhase;
  module: string;
  entity: string;
  field?: string | undefined;
  severity?: ValidationSeverity | undefined;
  validate: (context: ValidationContext<T>) => Promise<ValidationRuleResult> | ValidationRuleResult;
}
