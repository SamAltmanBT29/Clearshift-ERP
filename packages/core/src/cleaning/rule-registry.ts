/**
 * V1 Cleaning Rule Registry (KIT-04 / SDS §3.4 & §4.4)
 * Manages the 12 core cleaning rules, runtime on/off toggles,
 * deterministic execution pipeline, row-level rejection decisions,
 * and per-field change audit logging with sensitive data redaction.
 */

import type {
  CleaningRuleId,
  ICleaningRule,
  CleaningRuleContext,
  RuleExecutionResult,
  FieldChangeAudit,
  RowCleaningOutcome,
} from "./types.js";
import { V1_CLEANING_RULES } from "./types.js";
import { RlText01Rule, RlText02Rule } from "./rules/text-rules.js";
import { RlName01Rule } from "./rules/name-rule.js";
import { RlEmail01Rule } from "./rules/email-rule.js";
import { RlPhone01Rule } from "./rules/phone-rule.js";
import { RlDate01Rule } from "./rules/date-rule.js";
import { RlCurrency01Rule } from "./rules/currency-rule.js";
import { RlAddr01Rule } from "./rules/address-rule.js";
import { RlReq01Rule } from "./rules/required-rule.js";
import { RlFormat01Rule } from "./rules/format-rule.js";
import { RlDup01Rule } from "./rules/duplicate-rule.js";
import { RlTax01Rule } from "./rules/tax-rule.js";
import { maskSensitiveString } from "../logging/redact.js";

export interface CleaningRegistryOptions {
  enabledRules?: CleaningRuleId[];
  disabledRules?: CleaningRuleId[];
  dateFormat?: string;
  phoneCountry?: string;
  requiredFields?: string[];
  addressDictionary?: Record<string, string>;
  sensitiveFields?: string[];
}

export class CleaningRuleRegistry {
  private rules: Map<CleaningRuleId, ICleaningRule> = new Map();
  private ruleStatus: Map<CleaningRuleId, boolean> = new Map();

  constructor(options?: CleaningRegistryOptions) {
    this.registerDefaultRules();
    this.applyOptions(options);
  }

  private registerDefaultRules(): void {
    const defaultRules: ICleaningRule[] = [
      new RlReq01Rule(),
      new RlText01Rule(),
      new RlText02Rule(),
      new RlName01Rule(),
      new RlEmail01Rule(),
      new RlPhone01Rule(),
      new RlDate01Rule(),
      new RlCurrency01Rule(),
      new RlAddr01Rule(),
      new RlFormat01Rule(),
      new RlDup01Rule(),
      new RlTax01Rule(),
    ];

    for (const rule of defaultRules) {
      this.rules.set(rule.id, rule);
      this.ruleStatus.set(rule.id, true);
    }
  }

  public applyOptions(options?: CleaningRegistryOptions): void {
    if (!options) return;

    if (options.enabledRules && options.enabledRules.length > 0) {
      // If explicit enabledRules list provided, start all disabled then enable specified
      for (const ruleId of this.rules.keys()) {
        this.ruleStatus.set(ruleId, false);
      }
      for (const ruleId of options.enabledRules) {
        if (this.rules.has(ruleId)) {
          this.ruleStatus.set(ruleId, true);
        }
      }
    }

    if (options.disabledRules) {
      for (const ruleId of options.disabledRules) {
        this.ruleStatus.set(ruleId, false);
      }
    }
  }

  public setRuleEnabled(ruleId: CleaningRuleId, enabled: boolean): void {
    if (!this.rules.has(ruleId)) {
      throw new Error(`Rule '${ruleId}' is not registered in the cleaning registry`);
    }
    this.ruleStatus.set(ruleId, enabled);
  }

  public isRuleEnabled(ruleId: CleaningRuleId): boolean {
    return this.ruleStatus.get(ruleId) ?? false;
  }

  public getRegisteredRules(): ICleaningRule[] {
    return Array.from(this.rules.values());
  }

  public getRule(ruleId: CleaningRuleId): ICleaningRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Determine which rules apply to a given field based on field name and context
   */
  private getApplicableRuleIds(fieldName: string): CleaningRuleId[] {
    const lower = fieldName.toLowerCase();
    const rules: CleaningRuleId[] = ["RL-REQ-01", "RL-TEXT-01", "RL-TEXT-02"];

    if (lower.includes("name") || lower === "first_name" || lower === "last_name" || lower === "full_name") {
      rules.push("RL-NAME-01");
    }

    if (lower.includes("email")) {
      rules.push("RL-EMAIL-01");
    }

    if (lower.includes("phone") || lower.includes("mobile") || lower.includes("tel")) {
      rules.push("RL-PHONE-01");
    }

    if (lower.includes("date") || lower.includes("dob") || lower.includes("created_at") || lower.includes("closed_at")) {
      rules.push("RL-DATE-01");
    }

    if (
      lower.includes("amount") ||
      lower.includes("revenue") ||
      lower.includes("price") ||
      lower.includes("salary") ||
      lower.includes("budget") ||
      lower.includes("cost") ||
      lower.includes("balance")
    ) {
      rules.push("RL-CURRENCY-01");
    }

    if (
      lower.includes("city") ||
      lower.includes("country") ||
      lower.includes("state") ||
      lower.includes("address")
    ) {
      rules.push("RL-ADDR-01");
    }

    if (lower.includes("tax") || lower.includes("vat") || lower.includes("ein") || lower.includes("gstin")) {
      rules.push("RL-TAX-01");
    }

    rules.push("RL-FORMAT-01");

    // RL-DUP-01 is applied to designated duplicate matching keys (tax_number, sku, external_id)
    if (lower.includes("sku") || lower === "tax_number" || lower.includes("external_id")) {
      rules.push("RL-DUP-01");
    }

    return rules;
  }

  private isFieldSensitive(fieldName: string, explicitSensitives?: string[]): boolean {
    const lower = fieldName.toLowerCase().replace(/[-_]/g, "");
    if (explicitSensitives && explicitSensitives.some((s) => s.toLowerCase().replace(/[-_]/g, "") === lower)) {
      return true;
    }
    const sensitiveTokens = [
      "password",
      "passwd",
      "secret",
      "token",
      "jwt",
      "ssn",
      "taxid",
      "nationalid",
      "salary",
      "wage",
      "compensation",
      "bankaccount",
      "accountnumber",
      "iban",
      "cardnumber",
      "cvv",
    ];
    return sensitiveTokens.some((tok) => lower.includes(tok));
  }

  /**
   * Safely formats and masks values for audit logging
   */
  public safeFormatAuditValue(value: unknown, isSensitive: boolean): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    const strVal = String(value);
    if (!isSensitive) {
      return strVal;
    }
    return maskSensitiveString(strVal);
  }

  /**
   * Cleans a single source row across all applicable fields
   */
  public cleanRow(
    sourceRow: number,
    payload: Record<string, unknown>,
    options: CleaningRegistryOptions & { batchId: string }
  ): RowCleaningOutcome {
    const cleanedPayload: Record<string, unknown> = { ...payload };
    const fieldAudits: FieldChangeAudit[] = [];
    const warnings: string[] = [];

    const requiredSet = new Set(
      (options.requiredFields || []).map((f) => f.toLowerCase().trim())
    );

    let isRejected = false;
    let rejectReasonCode: string | undefined;
    let rejectReasonText: string | undefined;

    // Evaluate each field in the payload
    for (const [fieldName, rawValue] of Object.entries(payload)) {
      let currentValue: unknown = rawValue;
      const isRequired = requiredSet.has(fieldName.toLowerCase().trim());
      const isSensitive = this.isFieldSensitive(fieldName, options.sensitiveFields);

      const applicableRuleIds = this.getApplicableRuleIds(fieldName);

      for (const ruleId of applicableRuleIds) {
        if (!this.isRuleEnabled(ruleId)) {
          continue;
        }

        const rule = this.rules.get(ruleId);
        if (!rule) continue;

        const context: CleaningRuleContext = {
          batchId: options.batchId,
          sourceRow,
          fieldName,
          isRequired,
          dateFormat: options.dateFormat,
          phoneCountry: options.phoneCountry,
          addressDictionary: options.addressDictionary,
          rowPayload: cleanedPayload,
          ruleVersion: rule.version,
        };

        const result: RuleExecutionResult = rule.apply(currentValue, context);

        if (result.flagWarning) {
          warnings.push(`Row ${sourceRow} [${fieldName}]: ${result.flagWarning}`);
        }

        if (result.rejectRow) {
          isRejected = true;
          rejectReasonCode = result.rejectReasonCode || "CLEANING_REJECT";
          rejectReasonText =
            result.rejectReasonText ||
            `Row ${sourceRow} rejected by rule '${ruleId}' on field '${fieldName}'`;
          break; // Stop processing further rules for this field if rejected
        }

        if (result.modified) {
          fieldAudits.push({
            batchId: options.batchId,
            sourceRow,
            fieldName,
            oldValue: this.safeFormatAuditValue(currentValue, isSensitive),
            newValue: this.safeFormatAuditValue(result.newValue, isSensitive),
            ruleId,
            ruleVersion: rule.version,
            isSensitive,
          });
          currentValue = result.newValue;
        }
      }

      if (isRejected) {
        break; // Stop row evaluation if rejected
      }

      cleanedPayload[fieldName] = currentValue;
    }

    return {
      sourceRow,
      status: isRejected ? "rejected" : "cleaned",
      cleanedPayload: isRejected ? payload : cleanedPayload,
      rejectReasonCode,
      rejectReasonText,
      fieldAudits,
      warnings,
    };
  }
}
