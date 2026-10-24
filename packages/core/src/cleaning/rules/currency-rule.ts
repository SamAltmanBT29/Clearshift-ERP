/**
 * RL-CURRENCY-01 (SDS §3.4)
 * Remove currency symbols and spaces; replace "," thousand separators; parse as an exact decimal.
 */

import { Decimal } from "decimal.js";
import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlCurrency01Rule implements ICleaningRule {
  readonly id = "RL-CURRENCY-01";
  readonly name = "Monetary Amount Normalization";
  readonly version = "1.0.0";
  readonly description = "Remove currency symbols ($ € £ ₹ ¥) and spaces; normalize thousand separators; parse as exact decimal.";

  // Currency symbols: $, €, £, ₹, ¥, ₩, CHF, etc.
  private static readonly CURRENCY_SYMBOL_REGEX = /[$€£₹¥₩]|(?:USD|EUR|GBP|INR|CAD|AUD|CHF)\b/gi;

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

    if (typeof value === "number") {
      if (isNaN(value) || !isFinite(value)) {
        return {
          ruleId: this.id,
          ruleVersion: this.version,
          fieldName: context.fieldName,
          oldValue: value,
          newValue: value,
          modified: false,
          isValid: false,
          rejectRow: context.isRequired,
          rejectReasonCode: "INVALID_CURRENCY",
          rejectReasonText: "Currency amount is not a valid finite number",
        };
      }
      const decStr = new Decimal(value).toFixed(2);
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: decStr,
        modified: String(value) !== decStr,
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
        rejectReasonCode: "INVALID_CURRENCY",
        rejectReasonText: "Currency amount is not a valid string or number",
      };
    }

    // Strip currency symbols and whitespace
    let sanitized = value.replace(RlCurrency01Rule.CURRENCY_SYMBOL_REGEX, "").trim();

    // Check if parenthesized negative e.g. "(1,234.50)" -> "-1234.50"
    let isNegative = false;
    if (sanitized.startsWith("(") && sanitized.endsWith(")")) {
      isNegative = true;
      sanitized = sanitized.slice(1, -1).trim();
    } else if (sanitized.startsWith("-")) {
      isNegative = true;
      sanitized = sanitized.slice(1).trim();
    }

    // Remove thousand separators
    // Distinguish comma as thousand separator (1,234.56) vs comma as decimal separator (1.234,56 or 1234,56)
    if (sanitized.includes(",") && sanitized.includes(".")) {
      const lastComma = sanitized.lastIndexOf(",");
      const lastDot = sanitized.lastIndexOf(".");
      if (lastDot > lastComma) {
        // Comma is thousand separator: 1,234.56
        sanitized = sanitized.replace(/,/g, "");
      } else {
        // Dot is thousand separator, comma is decimal: 1.234,56
        sanitized = sanitized.replace(/\./g, "").replace(/,/g, ".");
      }
    } else if (sanitized.includes(",")) {
      // Single comma: if followed by 2 digits at end, likely decimal 1234,50 -> 1234.50
      // Otherwise thousand separator
      const parts = sanitized.split(",");
      if (parts.length === 2 && parts[1]!.length <= 2) {
        sanitized = sanitized.replace(/,/g, ".");
      } else {
        sanitized = sanitized.replace(/,/g, "");
      }
    }

    // Remove any remaining whitespace
    sanitized = sanitized.replace(/\s+/g, "");

    if (isNegative) {
      sanitized = `-${sanitized}`;
    }

    try {
      const dec = new Decimal(sanitized);
      if (dec.isNaN()) {
        throw new Error("NaN");
      }
      const formatted = dec.toFixed(2);
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: formatted,
        modified: value !== formatted,
        isValid: true,
        rejectRow: false,
      };
    } catch {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: value,
        modified: false,
        isValid: false,
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_CURRENCY",
        rejectReasonText: `Currency amount '${value}' cannot be parsed as a valid decimal`,
        flagWarning: !context.isRequired ? "Currency amount could not be parsed" : undefined,
      };
    }
  }
}
