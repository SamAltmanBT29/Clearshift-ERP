/**
 * RL-DUP-01 (SDS §3.4 & §4.7)
 * Exact duplicate on a normalised key.
 * Normalizes key values (lowercase, trim, strip punctuation) for deterministic duplicate detection.
 */

import { normalizeEmail, normalizePhone, normalizeName, normalizeTaxNumber } from "../../normalizers/index.js";
import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlDup01Rule implements ICleaningRule {
  readonly id = "RL-DUP-01";
  readonly name = "Exact Duplicate Key Normalizer";
  readonly version = "1.0.0";
  readonly description = "Normalize key field (email, phone, name, tax number) to canonical representation for exact duplicate grouping.";

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

    const fieldLower = context.fieldName.toLowerCase();
    let normalized = value.trim();

    if (fieldLower.includes("email")) {
      normalized = normalizeEmail(normalized);
    } else if (fieldLower.includes("phone") || fieldLower.includes("mobile")) {
      normalized = normalizePhone(normalized);
    } else if (fieldLower.includes("name")) {
      normalized = normalizeName(normalized);
    } else if (fieldLower.includes("tax") || fieldLower.includes("vat") || fieldLower.includes("ein")) {
      normalized = normalizeTaxNumber(normalized);
    } else {
      normalized = normalized.toLowerCase().replace(/\s+/g, " ");
    }

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      fieldName: context.fieldName,
      oldValue: value,
      newValue: normalized,
      modified: value !== normalized,
      isValid: true,
      rejectRow: false,
    };
  }
}
