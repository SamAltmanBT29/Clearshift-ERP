/**
 * RL-PHONE-01 (SDS §3.4)
 * Keep only digits and "+"; if the number has 10 digits and no country code,
 * add the country code of the file (declared at upload, e.g. "+1").
 */

import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlPhone01Rule implements ICleaningRule {
  readonly id = "RL-PHONE-01";
  readonly name = "Phone Number Standardization";
  readonly version = "1.0.0";
  readonly description = "Keep only digits and leading '+'; prepend file country code to 10-digit national numbers.";

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

    if (typeof value !== "string" && typeof value !== "number") {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: value,
        modified: false,
        isValid: false,
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_PHONE",
        rejectReasonText: `Phone number is not valid: unsupported data type`,
      };
    }

    const rawStr = String(value).trim();
    const hasLeadingPlus = rawStr.startsWith("+");
    const digitsOnly = rawStr.replace(/\D/g, "");

    if (digitsOnly.length === 0) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: rawStr,
        modified: false,
        isValid: false,
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_PHONE",
        rejectReasonText: "Phone number is not valid: no digits present",
        flagWarning: !context.isRequired ? "Phone number contains no digits" : undefined,
      };
    }

    let normalizedPhone: string;
    const defaultCountryCode = context.phoneCountry || "+1";
    const cleanCountryCode = defaultCountryCode.startsWith("+")
      ? defaultCountryCode
      : `+${defaultCountryCode}`;

    if (hasLeadingPlus) {
      normalizedPhone = `+${digitsOnly}`;
    } else if (digitsOnly.length === 10) {
      // 10 digits without leading +: prepend declared country code
      const ccDigits = cleanCountryCode.replace(/\D/g, "");
      normalizedPhone = `+${ccDigits}${digitsOnly}`;
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith("1") && cleanCountryCode === "+1") {
      // 11 digits starting with 1 in US/NANP context
      normalizedPhone = `+${digitsOnly}`;
    } else {
      // Lacks + but has arbitrary length: prepend country code or leading plus
      const ccDigits = cleanCountryCode.replace(/\D/g, "");
      normalizedPhone = digitsOnly.startsWith(ccDigits)
        ? `+${digitsOnly}`
        : `+${digitsOnly}`;
    }

    // Minimum E.164 length is 8 digits, maximum is 15 digits
    const totalDigits = normalizedPhone.replace(/\D/g, "").length;
    const isValidLength = totalDigits >= 7 && totalDigits <= 15;

    if (!isValidLength) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: normalizedPhone,
        modified: String(value) !== normalizedPhone,
        isValid: false,
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_PHONE",
        rejectReasonText: `Phone number is not valid: digit count ${totalDigits} outside E.164 standard (7-15 digits)`,
        flagWarning: !context.isRequired ? "Phone number does not match E.164 length" : undefined,
      };
    }

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      fieldName: context.fieldName,
      oldValue: value,
      newValue: normalizedPhone,
      modified: String(value) !== normalizedPhone,
      isValid: true,
      rejectRow: false,
    };
  }
}
