/**
 * RL-DATE-01 (SDS §3.4)
 * Read dates in the declared format (for example DD-MM-YYYY, MM/DD/YYYY, YYYY-MM-DD);
 * store as ISO 8601 (yyyy-mm-dd); anything else = reject when required.
 */

import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlDate01Rule implements ICleaningRule {
  readonly id = "RL-DATE-01";
  readonly name = "Date Parser & ISO-8601 Normalizer";
  readonly version = "1.0.0";
  readonly description = "Parse dates according to declared format and normalize to canonical ISO-8601 (YYYY-MM-DD).";

  private parseDateString(dateStr: string, format: string): { year: number; month: number; day: number } | null {
    const cleanStr = dateStr.trim();
    const cleanFormat = format.trim().toUpperCase();

    // Delimiters: '-', '/', '.'
    const delimiterMatch = cleanFormat.match(/[-/.]/);
    const delimiter = delimiterMatch ? delimiterMatch[0] : "-";

    const formatParts = cleanFormat.split(delimiter);
    const dateParts = cleanStr.split(delimiter);

    if (formatParts.length !== 3 || dateParts.length !== 3) {
      // Try fallback to ISO standard YYYY-MM-DD if string is standard ISO
      const isoMatch = cleanStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (isoMatch) {
        return {
          year: parseInt(isoMatch[1]!, 10),
          month: parseInt(isoMatch[2]!, 10),
          day: parseInt(isoMatch[3]!, 10),
        };
      }
      return null;
    }

    let year = 0;
    let month = 0;
    let day = 0;

    for (let i = 0; i < 3; i++) {
      const fPart = formatParts[i]!;
      const dPart = dateParts[i]!;
      const val = parseInt(dPart, 10);
      if (isNaN(val)) return null;

      if (fPart.startsWith("Y")) {
        year = val < 100 ? 2000 + val : val;
      } else if (fPart.startsWith("M")) {
        month = val;
      } else if (fPart.startsWith("D")) {
        day = val;
      }
    }

    if (year < 1000 || year > 9999) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    // Check days in specific month (including leap year)
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > daysInMonth) return null;

    return { year, month, day };
  }

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

    let parsed: { year: number; month: number; day: number } | null = null;
    const format = context.dateFormat || "YYYY-MM-DD";

    if (value instanceof Date && !isNaN(value.getTime())) {
      parsed = {
        year: value.getUTCFullYear(),
        month: value.getUTCMonth() + 1,
        day: value.getUTCDate(),
      };
    } else if (typeof value === "string") {
      parsed = this.parseDateString(value, format);
    }

    if (!parsed) {
      return {
        ruleId: this.id,
        ruleVersion: this.version,
        fieldName: context.fieldName,
        oldValue: value,
        newValue: value,
        modified: false,
        isValid: false,
        rejectRow: context.isRequired,
        rejectReasonCode: "INVALID_DATE",
        rejectReasonText: `Date is not valid: expected format '${format}'`,
        flagWarning: !context.isRequired ? `Date does not match format '${format}'` : undefined,
      };
    }

    const yStr = String(parsed.year).padStart(4, "0");
    const mStr = String(parsed.month).padStart(2, "0");
    const dStr = String(parsed.day).padStart(2, "0");
    const isoDate = `${yStr}-${mStr}-${dStr}`;

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      fieldName: context.fieldName,
      oldValue: value,
      newValue: isoDate,
      modified: String(value) !== isoDate,
      isValid: true,
      rejectRow: false,
    };
  }
}
