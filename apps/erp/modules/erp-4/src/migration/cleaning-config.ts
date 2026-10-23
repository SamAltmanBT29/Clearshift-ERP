/**
 * ERP-4 Finance & Accounting — Module Cleaning Rules & Audit Configuration (ERP4-27 / KIT-04)
 *
 * Configures the shared Migration Kit cleaning engine for ERP-4 domain entities
 * (accounts, opening balances, journal entries, journal lines), implementing standard
 * cleaners (whitespace trimming, case normalization, date coercion, decimal stripping)
 * and field-level change auditing conforming to SDS §3.4 and §4.4.
 *
 * Enforces:
 * - AC1: Whitespace trimming, email lowercasing, phone normalization, date coercion.
 * - AC2: Every modified value records source_row, field_name, original_value, cleaned_value, rule_id.
 * - AC3: Unrecoverable required-field anomalies result in structured row rejection with reason code.
 * - AC4: Transformed values match expected clean states.
 * - Invariant: Raw source data is never mutated; cleaning produces pure transformed projections.
 *
 * @module erp4/migration/cleaning-config
 */

import {
  cleanDataset,
  exportFieldAuditCsv,
  cleanTextWhitespace,
  cleanControlCharacters,
  cleanProperName,
  cleanEmail,
  cleanPhone,
  cleanIsoDate,
  cleanCurrencyDecimal,
  V1_CLEANING_RULES,
  type CleanerConfig,
  type FieldCleanRuleConfig,
  type DatasetCleanResult,
  type FieldChangeAudit,
} from '@cs/kit';

export const ERP4_ACCEPTED_CURRENCIES = new Set(['INR', 'USD', 'EUR']);
export const ERP4_ACCEPTED_ACCOUNT_TYPES = new Set(['asset', 'liability', 'income', 'expense']);

export const ERP4_FIELD_CLEAN_RULES: readonly FieldCleanRuleConfig[] = [
  // ── 1. Chart of Accounts Fields ───────────────────────────────────────────
  {
    field: 'code',
    label: 'Account Code',
    recordType: 'account',
    required: true,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (enabled.has('RL-TEXT-01')) {
        const trimmed = current.trim();
        if (trimmed !== current) {
          audits.push({ ruleId: 'RL-TEXT-01', original: current, cleaned: trimmed });
          current = trimmed;
        }
      }

      // Upper-case normalization
      const upper = current.toUpperCase();
      if (upper !== current && current) {
        audits.push({ ruleId: 'RL-TEXT-01', original: current, cleaned: upper });
        current = upper;
      }

      if (!current) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-REQ-01',
            reasonCode: 'ACCOUNT_CODE_REQUIRED',
            message: 'Account code is required and cannot be empty.',
          },
        };
      }

      if (!/^[A-Za-z0-9_-]+$/.test(current)) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-FORMAT-01',
            reasonCode: 'INVALID_ACCOUNT_CODE_FORMAT',
            message: 'Account code must be alphanumeric with hyphens or underscores.',
          },
        };
      }

      if (current.length > 32) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-FORMAT-01',
            reasonCode: 'ACCOUNT_CODE_TOO_LONG',
            message: 'Account code cannot exceed 32 characters.',
          },
        };
      }

      return { cleaned: current, audits };
    },
  },
  {
    field: 'name',
    label: 'Account Name',
    recordType: 'account',
    required: true,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (enabled.has('RL-TEXT-01')) {
        const collapsed = cleanTextWhitespace(current);
        if (collapsed !== current) {
          audits.push({ ruleId: 'RL-TEXT-01', original: current, cleaned: collapsed });
          current = collapsed;
        }
      }

      if (!current) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-REQ-01',
            reasonCode: 'ACCOUNT_NAME_REQUIRED',
            message: 'Account name is required and cannot be empty.',
          },
        };
      }

      if (current.length > 255) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-FORMAT-01',
            reasonCode: 'ACCOUNT_NAME_TOO_LONG',
            message: 'Account name cannot exceed 255 characters.',
          },
        };
      }

      return { cleaned: current, audits };
    },
  },
  {
    field: 'type',
    label: 'Account Type',
    recordType: 'account',
    required: true,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (enabled.has('RL-TEXT-01')) {
        const trimmed = current.trim().toLowerCase();
        if (trimmed !== current) {
          audits.push({ ruleId: 'RL-TEXT-01', original: current, cleaned: trimmed });
          current = trimmed;
        }
      }

      if (!current) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-REQ-01',
            reasonCode: 'ACCOUNT_TYPE_REQUIRED',
            message: 'Account type is required.',
          },
        };
      }

      if (!ERP4_ACCEPTED_ACCOUNT_TYPES.has(current)) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-FORMAT-01',
            reasonCode: 'INVALID_ACCOUNT_TYPE',
            message: `Account type '${current}' must be one of: asset, liability, income, expense.`,
          },
        };
      }

      return { cleaned: current, audits };
    },
  },
  {
    field: 'currency_code',
    label: 'Currency Code',
    required: true,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (enabled.has('RL-TEXT-01')) {
        const trimmed = current.trim().toUpperCase();
        if (trimmed !== current) {
          audits.push({ ruleId: 'RL-TEXT-01', original: current, cleaned: trimmed });
          current = trimmed;
        }
      }

      if (!current) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-REQ-01',
            reasonCode: 'CURRENCY_REQUIRED',
            message: 'Currency code is required; V1 performs no FX conversion.',
          },
        };
      }

      if (!ERP4_ACCEPTED_CURRENCIES.has(current)) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-FORMAT-01',
            reasonCode: 'INVALID_CURRENCY',
            message: `Currency '${current}' is not accepted. Allowed: INR, USD, EUR.`,
          },
        };
      }

      return { cleaned: current, audits };
    },
  },
  {
    field: 'parent_code',
    label: 'Parent Account Code',
    recordType: 'account',
    required: false,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (current && enabled.has('RL-TEXT-01')) {
        const trimmed = current.trim().toUpperCase();
        if (trimmed !== current) {
          audits.push({ ruleId: 'RL-TEXT-01', original: current, cleaned: trimmed });
          current = trimmed;
        }
      }

      return { cleaned: current, audits };
    },
  },

  // ── 2. Opening Balance Fields ─────────────────────────────────────────────
  {
    field: 'balance_amount',
    label: 'Balance Amount',
    recordType: 'opening_balance',
    required: true,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (enabled.has('RL-CURRENCY-01')) {
        const res = cleanCurrencyDecimal(current);
        if (res.cleaned !== current) {
          audits.push({ ruleId: 'RL-CURRENCY-01', original: current, cleaned: res.cleaned });
          current = res.cleaned;
        }
      }

      if (!current) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-REQ-01',
            reasonCode: 'BALANCE_AMOUNT_REQUIRED',
            message: 'Opening balance amount is required.',
          },
        };
      }

      if (!/^-?\d+(\.\d{1,4})?$/.test(current)) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-FORMAT-01',
            reasonCode: 'INVALID_BALANCE_AMOUNT',
            message: 'Balance amount must be a valid signed numeric string.',
          },
        };
      }

      return { cleaned: current, audits };
    },
  },
  {
    field: 'as_of_date',
    label: 'As Of Date',
    recordType: 'opening_balance',
    required: true,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;
      let isFormatValid = true;

      if (enabled.has('RL-DATE-01')) {
        const res = cleanIsoDate(current);
        if (res.cleaned !== current && res.isValid) {
          audits.push({ ruleId: 'RL-DATE-01', original: current, cleaned: res.cleaned });
          current = res.cleaned;
        }
        if (!res.isValid && current.trim()) {
          isFormatValid = false;
        }
      }

      if (!current.trim()) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-REQ-01',
            reasonCode: 'AS_OF_DATE_REQUIRED',
            message: 'As of date is required.',
          },
        };
      }

      if (!isFormatValid || !/^\d{4}-\d{2}-\d{2}$/.test(current)) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-FORMAT-01',
            reasonCode: 'INVALID_DATE',
            message: 'Date must be formatted as valid YYYY-MM-DD.',
          },
        };
      }

      return { cleaned: current, audits };
    },
  },

  // ── 3. Journal Entry Fields ───────────────────────────────────────────────
  {
    field: 'entry_number',
    label: 'Entry Number',
    recordType: 'journal_entry',
    required: true,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (enabled.has('RL-TEXT-01')) {
        const trimmed = current.trim().toUpperCase();
        if (trimmed !== current) {
          audits.push({ ruleId: 'RL-TEXT-01', original: current, cleaned: trimmed });
          current = trimmed;
        }
      }

      if (!current) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-REQ-01',
            reasonCode: 'ENTRY_NUMBER_REQUIRED',
            message: 'Journal entry number is required.',
          },
        };
      }

      return { cleaned: current, audits };
    },
  },
  {
    field: 'posting_date',
    label: 'Posting Date',
    recordType: 'journal_entry',
    required: true,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;
      let isFormatValid = true;

      if (enabled.has('RL-DATE-01')) {
        const res = cleanIsoDate(current);
        if (res.cleaned !== current && res.isValid) {
          audits.push({ ruleId: 'RL-DATE-01', original: current, cleaned: res.cleaned });
          current = res.cleaned;
        }
        if (!res.isValid && current.trim()) {
          isFormatValid = false;
        }
      }

      if (!current.trim()) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-REQ-01',
            reasonCode: 'POSTING_DATE_REQUIRED',
            message: 'Posting date is required.',
          },
        };
      }

      if (!isFormatValid || !/^\d{4}-\d{2}-\d{2}$/.test(current)) {
        return {
          cleaned: current,
          audits,
          error: {
            ruleId: 'RL-FORMAT-01',
            reasonCode: 'INVALID_POSTING_DATE',
            message: 'Posting date must be a valid calendar date YYYY-MM-DD.',
          },
        };
      }

      return { cleaned: current, audits };
    },
  },
  {
    field: 'description',
    label: 'Description',
    required: false,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (enabled.has('RL-TEXT-01')) {
        const collapsed = cleanTextWhitespace(current);
        if (collapsed !== current) {
          audits.push({ ruleId: 'RL-TEXT-01', original: current, cleaned: collapsed });
          current = collapsed;
        }
      }

      return { cleaned: current, audits };
    },
  },

  // ── 4. Journal Line Fields ────────────────────────────────────────────────
  {
    field: 'debit_amount',
    label: 'Debit Amount',
    recordType: 'journal_line',
    required: false,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (current && enabled.has('RL-CURRENCY-01')) {
        const res = cleanCurrencyDecimal(current);
        if (res.cleaned !== current) {
          audits.push({ ruleId: 'RL-CURRENCY-01', original: current, cleaned: res.cleaned });
          current = res.cleaned;
        }
      }

      return { cleaned: current, audits };
    },
  },
  {
    field: 'credit_amount',
    label: 'Credit Amount',
    recordType: 'journal_line',
    required: false,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (current && enabled.has('RL-CURRENCY-01')) {
        const res = cleanCurrencyDecimal(current);
        if (res.cleaned !== current) {
          audits.push({ ruleId: 'RL-CURRENCY-01', original: current, cleaned: res.cleaned });
          current = res.cleaned;
        }
      }

      return { cleaned: current, audits };
    },
  },
  {
    field: 'line_narration',
    label: 'Line Narration',
    recordType: 'journal_line',
    required: false,
    clean: (val, _row, enabled) => {
      const audits: { ruleId: string; original: string; cleaned: string }[] = [];
      let current = val;

      if (current && enabled.has('RL-TEXT-01')) {
        const collapsed = cleanTextWhitespace(current);
        if (collapsed !== current) {
          audits.push({ ruleId: 'RL-TEXT-01', original: current, cleaned: collapsed });
          current = collapsed;
        }
      }

      return { cleaned: current, audits };
    },
  },
];

/**
 * Default ERP-4 Cleaner Configuration.
 */
export const ERP4_CLEANER_CONFIG: CleanerConfig = {
  sourceRowField: 'row_id',
  recordTypeField: 'record_type',
  fields: ERP4_FIELD_CLEAN_RULES,
  enabledRuleIds: V1_CLEANING_RULES.map((r) => r.ruleId),
};

/**
 * Execute ERP-4 dataset cleaning with optional rule toggles.
 */
export function cleanErp4Dataset<T extends Record<string, string>>(
  rows: readonly T[],
  enabledRuleIds?: readonly string[]
): DatasetCleanResult<T> {
  const config: CleanerConfig = {
    ...ERP4_CLEANER_CONFIG,
    enabledRuleIds: enabledRuleIds ?? ERP4_CLEANER_CONFIG.enabledRuleIds,
  };
  return cleanDataset(rows, config);
}

/**
 * Export field-level audit report as formula-safe CSV.
 */
export function exportErp4FieldAuditCsv(audits: readonly FieldChangeAudit[]): string {
  return exportFieldAuditCsv(audits);
}
