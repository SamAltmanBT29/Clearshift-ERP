/**
 * RL-EMAIL-01 (SDS §3.4 & §4.14 TS-05)
 * Trim, lower case, check for exactly one "@" and one dot after it, check the domain has a dot.
 * Failure on required fields produces rejection with plain-language explanation.
 */

import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlEmail01Rule implements ICleaningRule {
  readonly id = "RL-EMAIL-01";
  readonly name = "Email Address Sanitizer & Validator";
  readonly version = "1.0.0";
  readonly description = "Trim, lowercase, verify exactly one '@' sign and valid domain with at least one dot.";

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
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_EMAIL",
        rejectReasonText: `Email is not valid: value must be a string`,
      };
    }

    const trimmed = value.trim().toLowerCase();

    // Check for '@' symbol
    const atIndices: number[] = [];
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === "@") atIndices.push(i);
    }

    if (atIndices.length === 0) {
      // Exactly matches TS-05 acceptance criterion:
      // "Email is not valid: value has no @ sign"
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: trimmed,
        modified: value !== trimmed,
        isValid: false,
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_EMAIL",
        rejectReasonText: "Email is not valid: value has no @ sign",
        flagWarning: !context.isRequired ? "Email has no @ sign" : undefined,
      };
    }

    if (atIndices.length > 1) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: trimmed,
        modified: value !== trimmed,
        isValid: false,
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_EMAIL",
        rejectReasonText: "Email is not valid: value contains multiple @ signs",
        flagWarning: !context.isRequired ? "Email contains multiple @ signs" : undefined,
      };
    }

    const atPos = atIndices[0]!;
    const localPart = trimmed.slice(0, atPos);
    const domainPart = trimmed.slice(atPos + 1);

    if (!localPart || !domainPart) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: trimmed,
        modified: value !== trimmed,
        isValid: false,
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_EMAIL",
        rejectReasonText: "Email is not valid: missing local username or domain part",
        flagWarning: !context.isRequired ? "Email missing username or domain" : undefined,
      };
    }

    if (!domainPart.includes(".")) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: trimmed,
        modified: value !== trimmed,
        isValid: false,
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_EMAIL",
        rejectReasonText: "Email is not valid: domain has no dot",
        flagWarning: !context.isRequired ? "Email domain has no dot" : undefined,
      };
    }

    // Basic structure check: characters after last dot should be at least 2 alpha characters
    const lastDotPos = domainPart.lastIndexOf(".");
    const tld = domainPart.slice(lastDotPos + 1);
    if (!tld || tld.length < 2) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: trimmed,
        modified: value !== trimmed,
        isValid: false,
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_EMAIL",
        rejectReasonText: "Email is not valid: top-level domain must be at least 2 characters",
        flagWarning: !context.isRequired ? "Email top-level domain too short" : undefined,
      };
    }

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      fieldName: context.fieldName,
      oldValue: value,
      newValue: trimmed,
      modified: value !== trimmed,
      isValid: true,
      rejectRow: false,
    };
  }
}
