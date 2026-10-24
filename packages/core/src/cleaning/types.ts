export type CleaningRuleId =
  | "RL-TEXT-01"
  | "RL-TEXT-02"
  | "RL-NAME-01"
  | "RL-EMAIL-01"
  | "RL-PHONE-01"
  | "RL-DATE-01"
  | "RL-CURRENCY-01"
  | "RL-ADDR-01"
  | "RL-REQ-01"
  | "RL-FORMAT-01"
  | "RL-DUP-01"
  | "RL-TAX-01";

export const V1_CLEANING_RULES: readonly CleaningRuleId[] = [
  "RL-TEXT-01",
  "RL-TEXT-02",
  "RL-NAME-01",
  "RL-EMAIL-01",
  "RL-PHONE-01",
  "RL-DATE-01",
  "RL-CURRENCY-01",
  "RL-ADDR-01",
  "RL-REQ-01",
  "RL-FORMAT-01",
  "RL-DUP-01",
  "RL-TAX-01",
] as const;


export interface CleaningRuleContext {
  batchId: string;
  sourceRow: number;
  fieldName: string;
  isRequired: boolean;
  dateFormat?: string | undefined;
  phoneCountry?: string | undefined;
  addressDictionary?: Record<string, string> | undefined;
  rowPayload?: Record<string, unknown> | undefined;
  ruleVersion?: string | undefined;
}

export interface RuleExecutionResult {
  ruleId: CleaningRuleId;
  ruleVersion: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  modified: boolean;
  isValid: boolean;
  rejectRow: boolean;
  rejectReasonCode?: string | undefined;
  rejectReasonText?: string | undefined;
  flagWarning?: string | undefined;
}

export interface ICleaningRule {
  readonly id: CleaningRuleId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  apply(value: unknown, context: CleaningRuleContext): RuleExecutionResult;
}

export interface FieldChangeAudit {
  batchId: string;
  sourceRow: number;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  ruleId: CleaningRuleId;
  ruleVersion: string;
  isSensitive?: boolean | undefined;
}

export interface RowCleaningOutcome {
  sourceRow: number;
  status: "cleaned" | "rejected";
  cleanedPayload: Record<string, unknown>;
  rejectReasonCode?: string | undefined;
  rejectReasonText?: string | undefined;
  fieldAudits: FieldChangeAudit[];
  warnings: string[];
}
