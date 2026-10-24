/**
 * RL-ADDR-01 (SDS §3.4)
 * Standardise city and country from a small dictionary
 * ("Bombay" -> "Mumbai" is a client decision, so the dictionary is editable).
 */

import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlAddr01Rule implements ICleaningRule {
  readonly id = "RL-ADDR-01";
  readonly name = "City and Country Dictionary Standardization";
  readonly version = "1.0.0";
  readonly description = "Standardize city and country names from an editable canonical dictionary (e.g. Bombay -> Mumbai, US -> United States).";

  // Default canonical dictionary for V1
  private static readonly DEFAULT_DICTIONARY: Record<string, string> = {
    // Cities
    bombay: "Mumbai",
    calcutta: "Kolkata",
    madras: "Chennai",
    peking: "Beijing",
    saigon: "Ho Chi Minh City",
    bangalore: "Bengaluru",
    ny: "New York",
    nyc: "New York",
    sf: "San Francisco",
    la: "Los Angeles",

    // Countries / Country codes
    us: "United States",
    usa: "United States",
    uk: "United Kingdom",
    gb: "United Kingdom",
    greatbritain: "United Kingdom",
    de: "Germany",
    deutschland: "Germany",
    fr: "France",
    in: "India",
    ca: "Canada",
    au: "Australia",
    jp: "Japan",
    nl: "Netherlands",
    holland: "Netherlands",
  };

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

    const trimmed = value.trim();
    const normalizedKey = trimmed.toLowerCase().replace(/[\s.-]/g, "");

    // Check custom dictionary first, then default dictionary
    let standardized: string | undefined;

    if (context.addressDictionary) {
      for (const [key, val] of Object.entries(context.addressDictionary)) {
        if (key.toLowerCase().replace(/[\s.-]/g, "") === normalizedKey) {
          standardized = val;
          break;
        }
      }
    }

    if (!standardized && RlAddr01Rule.DEFAULT_DICTIONARY[normalizedKey]) {
      standardized = RlAddr01Rule.DEFAULT_DICTIONARY[normalizedKey];
    }

    const finalValue = standardized || trimmed;

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      fieldName: context.fieldName,
      oldValue: value,
      newValue: finalValue,
      modified: value !== finalValue,
      isValid: true,
      rejectRow: false,
    };
  }
}
