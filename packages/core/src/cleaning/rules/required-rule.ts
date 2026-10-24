/**
 * RL-REQ-01 (SDS §3.4 & §4.4 FR-CL-02)
 * Check that required fields are not empty.
 * A row with a problem in a required field is rejected with a reason in simple language.
 */

import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlReq01Rule implements ICleaningRule {
  readonly id = "RL-REQ-01";
  readonly name = "Required Fields Completeness Check";
  readonly version = "1.0.0";
  readonly description = "Check that designated required fields are not empty or blank; reject row with simple reason if missing.";

  apply(value: unknown, context: CleaningRuleContext): RuleExecutionResult {
    const isMissing =
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "");

    if (context.isRequired && isMissing) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: value,
        modified: false,
        isValid: false,
        rejectRow: true,
        rejectReasonCode: "REQUIRED_FIELD_MISSING",
        rejectReasonText: `Required field '${context.fieldName}' is missing or empty`,
      };
    }

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      fieldName: context.fieldName,
      oldValue: value,
      newValue: value,
      modified: false,
      isValid: true,
      rejectRow: false,
    };
  }
}
