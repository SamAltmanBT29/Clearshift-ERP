/**
 * RL-TAX-01 (SDS §3.4)
 * Check the tax number format for the chosen country; flag "unknown" instead of rejecting when unsure.
 */

import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlTax01Rule implements ICleaningRule {
  readonly id = "RL-TAX-01";
  readonly name = "Tax Identifier Format & Uncertainty Flagging";
  readonly version = "1.0.0";
  readonly description = "Check tax number format for chosen country; flag 'unknown' instead of rejecting when unsure.";

  // Standard national tax identifier regexes
  private static readonly US_EIN_REGEX = /^\d{2}-?\d{7}$/;
  private static readonly EU_VAT_REGEX = /^[A-Z]{2}[0-9A-Z]{8,12}$/;
  private static readonly IN_GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  private static readonly GENERIC_TAX_REGEX = /^[0-9A-Za-z-]{8,15}$/;

  apply(value: unknown, context: CleaningRuleContext): RuleExecutionResult {
    if (value === null || value === undefined || value === "") {
      if (context.isRequired) {
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
        newValue: null,
        modified: value !== null,
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
        isValid: false,
        rejectRow: false,
        flagWarning: "Tax number is not a string",
      };
    }

    const trimmed = value.trim();
    const cleanTax = trimmed.replace(/[\s.]/g, "").toUpperCase();

    // Check specific country format if declared or detect from prefix
    let isRecognized = false;
    if (RlTax01Rule.US_EIN_REGEX.test(cleanTax)) {
      isRecognized = true;
    } else if (RlTax01Rule.EU_VAT_REGEX.test(cleanTax)) {
      isRecognized = true;
    } else if (RlTax01Rule.IN_GSTIN_REGEX.test(cleanTax)) {
      isRecognized = true;
    } else if (RlTax01Rule.GENERIC_TAX_REGEX.test(cleanTax)) {
      isRecognized = true;
    }

    if (!isRecognized) {
      // Per SDS RL-TAX-01: flag "unknown" instead of rejecting when unsure
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: cleanTax,
        modified: value !== cleanTax,
        isValid: true,
        rejectRow: false,
        flagWarning: "Tax number format unknown or unverified for country",
      };
    }

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      fieldName: context.fieldName,
      oldValue: value,
      newValue: cleanTax,
      modified: value !== cleanTax,
      isValid: true,
      rejectRow: false,
    };
  }
}
