/**
 * RL-TEXT-01 & RL-TEXT-02 (SDS §3.4)
 * - RL-TEXT-01: Trim spaces at the start and end; replace multiple spaces with one.
 * - RL-TEXT-02: Remove control characters and strange symbols.
 */

import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlText01Rule implements ICleaningRule {
  readonly id = "RL-TEXT-01";
  readonly name = "Whitespace Normalizer";
  readonly version = "1.0.0";
  readonly description = "Trim leading and trailing spaces; collapse multiple consecutive spaces into one.";

  apply(value: unknown, context: CleaningRuleContext): RuleExecutionResult {
    if (value === null || value === undefined) {
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

    if (typeof value !== "string") {
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

    const trimmed = value.trim();
    const collapsed = trimmed.replace(/[ \t\v\f\u00A0]+/g, " ");

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      fieldName: context.fieldName,
      oldValue: value,
      newValue: collapsed,
      modified: value !== collapsed,
      isValid: true,
      rejectRow: false,
    };
  }
}

export class RlText02Rule implements ICleaningRule {
  readonly id = "RL-TEXT-02";
  readonly name = "Control Character Sanitizer";
  readonly version = "1.0.0";
  readonly description = "Remove non-printable ASCII control characters and strange symbols.";

  // Strip control chars 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F, and BOM \uFEFF
  private static readonly CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFEFF]/g;

  apply(value: unknown, context: CleaningRuleContext): RuleExecutionResult {
    if (typeof value !== "string") {
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

    const cleaned = value.replace(RlText02Rule.CONTROL_CHAR_REGEX, "");

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      fieldName: context.fieldName,
      oldValue: value,
      newValue: cleaned,
      modified: value !== cleaned,
      isValid: true,
      rejectRow: false,
    };
  }
}
