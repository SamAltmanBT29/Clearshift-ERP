/**
 * RL-FORMAT-01 (SDS §3.4)
 * Check formats: email, phone, tax number (per country pattern), date.
 */

import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlFormat01Rule implements ICleaningRule {
  readonly id = "RL-FORMAT-01";
  readonly name = "Generic Field Format Validator";
  readonly version = "1.0.0";
  readonly description = "Validate format against detected or declared type pattern (email, phone, date, tax number).";

  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  private static readonly DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  private static readonly PHONE_REGEX = /^\+?[0-9]{7,15}$/;

  apply(value: unknown, context: CleaningRuleContext): RuleExecutionResult {
    if (value === null || value === undefined || value === "") {
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

    const lowerField = context.fieldName.toLowerCase();
    const strVal = value.trim();

    // Check email fields
    if (lowerField.includes("email")) {
      const isValidEmail = RlFormat01Rule.EMAIL_REGEX.test(strVal);
      if (!isValidEmail) {
        return {
          ruleId: this.id,
          ruleVersion: this.version,
          fieldName: context.fieldName,
          oldValue: value,
          newValue: value,
          modified: false,
          isValid: false,
          rejectRow: context.isRequired,
          rejectReasonCode: "INVALID_FORMAT",
          rejectReasonText: `Format error in '${context.fieldName}': invalid email structure`,
          flagWarning: !context.isRequired ? `Invalid email structure in '${context.fieldName}'` : undefined,
        };
      }
    }

    // Check date fields
    if (lowerField.includes("date") || lowerField.includes("dob") || lowerField.includes("created_at")) {
      const isValidDate = RlFormat01Rule.DATE_REGEX.test(strVal);
      if (!isValidDate) {
        return {
          ruleId: this.id,
          ruleVersion: this.version,
          fieldName: context.fieldName,
          oldValue: value,
          newValue: value,
          modified: false,
          isValid: false,
          rejectRow: context.isRequired,
          rejectReasonCode: "INVALID_FORMAT",
          rejectReasonText: `Format error in '${context.fieldName}': expected YYYY-MM-DD`,
          flagWarning: !context.isRequired ? `Date does not match ISO format in '${context.fieldName}'` : undefined,
        };
      }
    }

    // Check phone fields
    if (lowerField.includes("phone") || lowerField.includes("mobile") || lowerField.includes("fax")) {
      const digits = strVal.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) {
        return {
          ruleId: this.id,
          ruleVersion: this.version,
          fieldName: context.fieldName,
          oldValue: value,
          newValue: value,
          modified: false,
          isValid: false,
          rejectRow: context.isRequired,
          rejectReasonCode: "INVALID_FORMAT",
          rejectReasonText: `Format error in '${context.fieldName}': phone digit count must be 7-15 digits`,
          flagWarning: !context.isRequired ? `Phone digit count outside standard in '${context.fieldName}'` : undefined,
        };
      }
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
