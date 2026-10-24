/**
 * RL-NAME-01 (SDS §3.4)
 * Proper case for names ("john smith" -> "John Smith"); keep a list of special cases (O'Brien, McDonald).
 */

import type { ICleaningRule, CleaningRuleContext, RuleExecutionResult } from "../types.js";

export class RlName01Rule implements ICleaningRule {
  readonly id = "RL-NAME-01";
  readonly name = "Name Proper Casing";
  readonly version = "1.0.0";
  readonly description = "Capitalize names to proper case, handling special prefixes (O'Brien, McDonald, Mac, van der, etc.) and hyphens.";

  private static readonly LOWERCASE_PARTICLES = new Set([
    "van",
    "der",
    "den",
    "de",
    "di",
    "da",
    "du",
    "la",
    "le",
    "von",
    "und",
    "del",
    "della",
  ]);

  private static readonly KNOWN_SPECIAL_NAMES: Record<string, string> = {
    obrien: "O'Brien",
    oconnor: "O'Connor",
    oneill: "O'Neill",
    omally: "O'Malley",
    mcdonald: "McDonald",
    mcdonnell: "McDonnell",
    mcgregor: "McGregor",
    mckenzie: "McKenzie",
    macarthur: "MacArthur",
    macintyre: "MacIntyre",
  };

  private formatWord(word: string, isFirstWord: boolean): string {
    if (!word) return "";

    const lower = word.toLowerCase();

    // Check exact known special name map (without punctuation)
    const normalizedKey = lower.replace(/['’]/g, "");
    if (RlName01Rule.KNOWN_SPECIAL_NAMES[normalizedKey]) {
      return RlName01Rule.KNOWN_SPECIAL_NAMES[normalizedKey]!;
    }

    // Handle O' prefix (O'Brien, O'Connor)
    if (lower.startsWith("o'") && lower.length > 2) {
      return "O'" + lower.charAt(2).toUpperCase() + lower.slice(3);
    }
    if (lower.startsWith("o’") && lower.length > 2) {
      return "O’" + lower.charAt(2).toUpperCase() + lower.slice(3);
    }

    // Handle Mc prefix (McDonald, McLeod)
    if (lower.startsWith("mc") && lower.length > 2) {
      return "Mc" + lower.charAt(2).toUpperCase() + lower.slice(3);
    }

    // Handle lowercase particles ("van der", "de") unless it's the very first word in the full string
    if (!isFirstWord && RlName01Rule.LOWERCASE_PARTICLES.has(lower)) {
      return lower;
    }

    // Handle hyphenated names (e.g. Mary-Jane)
    if (word.includes("-")) {
      return word
        .split("-")
        .map((part) => this.formatWord(part, isFirstWord))
        .join("-");
    }

    // Standard title-casing
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  apply(value: unknown, context: CleaningRuleContext): RuleExecutionResult {
    if (typeof value !== "string" || !value.trim()) {
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
    const words = trimmed.split(/\s+/);
    const capitalized = words.map((w, idx) => this.formatWord(w, idx === 0)).join(" ");

    return {
      ruleId: this.id,
      ruleVersion: this.version,
      fieldName: context.fieldName,
      oldValue: value,
      newValue: capitalized,
      modified: value !== capitalized,
      isValid: true,
      rejectRow: false,
    };
  }
}
