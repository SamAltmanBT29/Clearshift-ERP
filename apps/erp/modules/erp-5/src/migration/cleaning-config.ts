/**
 * ERP-5 HR & Employees — Module Cleaning Rules & Field-Level Audit Configuration (ERP5-27 / KIT-04)
 *
 * Configures the shared Migration Kit cleaning engine (`@cs/kit`, SDS §3.4 / §4.4) for ERP-5
 * entities (departments, employees, leave records, payroll totals).
 *
 * Requirements & Guarantees:
 *  - AC1: Standard cleaners execute (whitespace trimming, control char removal, email lowercasing,
 *         phone normalization, date coercion to ISO 8601, currency symbol & separator stripping).
 *  - AC2: Every modified value generates an audit entry with source_row, field_name, original_value,
 *         cleaned_value, and rule_id.
 *  - AC3: Unrecoverable required-field anomalies result in structured row rejection with reason code.
 *  - AC4: Transformed values match expected clean states.
 *  - Invariants:
 *     - Formula injection prefixes (=, +, -, @, \t, \r) are rejected on free-text fields.
 *     - Employment join date must not precede birth date (BR-ERP5-01).
 *     - Leave end date must not precede start date (FR-ERP5-04).
 *     - Salary is masked on serialization and log exports (BR-ERP5-02, DR-5).
 *     - Deterministic exact duplicate matching only; no fuzzy matching or automatic merge.
 *     - Raw source rows are never mutated.
 *
 * @module erp5/migration/cleaning-config
 */

import {
  V1_CLEANING_RULES,
  cleanControlCharacters,
  cleanCurrencyDecimal,
  cleanDataset,
  cleanEmail,
  cleanIsoDate,
  cleanPhone,
  cleanProperName,
  cleanTextWhitespace,
  exportFieldAuditCsv,
  type CleanerConfig,
  type DatasetCleanResult,
  type FieldChangeAudit,
  type FieldCleanRuleConfig,
} from '@cs/kit';
import {
  ACCEPTED_CURRENCIES,
  LEAVE_TYPES,
  LEAVE_STATUSES,
  hasFormulaPrefix,
} from './dirty-data-plan.js';

/**
 * V1 registry rules that have no direct ERP-5 target column or are owned by another layer.
 */
export const ERP5_NOT_APPLICABLE_RULES: Readonly<Record<string, string>> = {
  'RL-TAX-01': 'ERP-5 internal HR records do not store external vendor or customer tax numbers.',
  'RL-ADDR-01': 'V1 HR records do not store structured street addresses or city dictionaries.',
  'RL-DUP-01': 'Exact duplicate detection is handled by the candidate key profiler (ERP5-26).',
};

type Audit = { ruleId: string; original: string; cleaned: string };
type CleanResult = ReturnType<FieldCleanRuleConfig['clean']>;

const CURRENCY_SET: ReadonlySet<string> = new Set<string>(ACCEPTED_CURRENCIES);
const LEAVE_TYPE_SET: ReadonlySet<string> = new Set<string>(LEAVE_TYPES);
const LEAVE_STATUS_SET: ReadonlySet<string> = new Set<string>(LEAVE_STATUSES);

interface Stepper {
  readonly audits: Audit[];
  value(): string;
  apply(ruleId: string, next: string): void;
}

/** Applies one transformation at a time; records an audit only when the rule is enabled and the value changes. */
function stepper(initial: string, enabled: ReadonlySet<string>): Stepper {
  let current = initial;
  const audits: Audit[] = [];
  return {
    audits,
    value: () => current,
    apply(ruleId, next) {
      if (!enabled.has(ruleId) || next === current) return;
      audits.push({ ruleId, original: current, cleaned: next });
      current = next;
    },
  };
}

const pass = (s: Stepper): CleanResult => ({ cleaned: s.value(), audits: s.audits });

const reject = (s: Stepper, ruleId: string, reasonCode: string, message: string): CleanResult => ({
  cleaned: s.value(),
  audits: s.audits,
  error: { ruleId, reasonCode, message },
});

const isBlank = (v: string): boolean => v.trim() === '';

/** Formula-injection values are rejected as-is (no audit): they are never "fixed". */
function formulaReject(val: string, label: string): CleanResult | null {
  if (!hasFormulaPrefix(val)) return null;
  return {
    cleaned: val,
    audits: [],
    error: {
      ruleId: 'RL-FORMAT-01',
      reasonCode: 'FORMULA_INJECTION_REJECTED',
      message: `${label} starts with a spreadsheet formula prefix and was rejected.`,
    },
  };
}

/**
 * Coerces date strings in varied formats (YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, YYYY-00M-DD) to ISO 8601.
 */
export function coerceDateToIso(val: string): { cleaned: string; isValid: boolean } {
  const trimmed = val.trim();
  if (!trimmed) return { cleaned: '', isValid: false };

  // Try standard cleaner first
  const standard = cleanIsoDate(trimmed);
  if (standard.isValid) {
    return standard;
  }

  // Handle padded month/day like YYYY-001-15 or delimiters / and .
  const normalized = trimmed.replace(/[\/.]/g, '-');
  const ymdMatch = /^(\d{4})-(\d{1,3})-(\d{1,3})$/.exec(normalized);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1]!, 10);
    const m = parseInt(ymdMatch[2]!, 10);
    const d = parseInt(ymdMatch[3]!, 10);
    if (isValidDateParts(y, m, d)) {
      const padM = String(m).padStart(2, '0');
      const padD = String(d).padStart(2, '0');
      return { cleaned: `${y}-${padM}-${padD}`, isValid: true };
    }
  }

  // Handle DD-MM-YYYY
  const dmyMatch = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(normalized);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1]!, 10);
    const m = parseInt(dmyMatch[2]!, 10);
    const y = parseInt(dmyMatch[3]!, 10);
    if (isValidDateParts(y, m, d)) {
      const padM = String(m).padStart(2, '0');
      const padD = String(d).padStart(2, '0');
      return { cleaned: `${y}-${padM}-${padD}`, isValid: true };
    }
  }

  return { cleaned: trimmed, isValid: false };
}

function isValidDateParts(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDays = daysInMonth[m - 1];
  return maxDays !== undefined && d <= maxDays;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERP-5 Field Cleaning Rules Definition
// ─────────────────────────────────────────────────────────────────────────────

export const ERP5_FIELD_CLEAN_RULES: readonly FieldCleanRuleConfig[] = [
  // ── 1. Department ──────────────────────────────────────────────────────────
  {
    field: 'department_code',
    label: 'Department Code',
    recordType: 'department',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Department Code');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'DEPARTMENT_CODE_REQUIRED', 'Department code is required.');
      }
      if (s.value().length > 32 || !/^[A-Z0-9_-]+$/.test(s.value())) {
        return reject(s, 'RL-FORMAT-01', 'DEPARTMENT_CODE_REQUIRED', 'Department code is invalid or exceeds 32 characters.');
      }
      return pass(s);
    },
  },
  {
    field: 'department_name',
    label: 'Department Name',
    recordType: 'department',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Department Name');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'DEPARTMENT_NAME_REQUIRED', 'Department name is required.');
      }
      if (s.value().length > 255) {
        return reject(s, 'RL-FORMAT-01', 'DEPARTMENT_NAME_REQUIRED', 'Department name cannot exceed 255 characters.');
      }
      return pass(s);
    },
  },
  {
    field: 'parent_code',
    label: 'Parent Department Code',
    recordType: 'department',
    required: false,
    clean: (val, row, enabled) => {
      const injected = formulaReject(val, 'Parent Department Code');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (!isBlank(s.value())) {
        const currentDept = (row['department_code'] ?? '').trim().toUpperCase();
        if (currentDept && s.value() === currentDept) {
          return reject(s, 'RL-FORMAT-01', 'DEPARTMENT_SELF_PARENT', 'Department cannot be its own parent.');
        }
      }
      return pass(s);
    },
  },

  // ── 2. Employee ────────────────────────────────────────────────────────────
  {
    field: 'employee_no',
    label: 'Employee Number',
    recordType: 'employee',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Employee Number');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'EMPLOYEE_NO_REQUIRED', 'Employee number is required.');
      }
      return pass(s);
    },
  },
  {
    field: 'first_name',
    label: 'First Name',
    recordType: 'employee',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'First Name');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      if (/^[a-zA-Z\s'-]+$/.test(s.value())) {
        s.apply('RL-NAME-01', cleanProperName(s.value()));
      }
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'EMPLOYEE_NAME_REQUIRED', 'First name is required.');
      }
      return pass(s);
    },
  },
  {
    field: 'last_name',
    label: 'Last Name',
    recordType: 'employee',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Last Name');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      if (/^[a-zA-Z\s'-]+$/.test(s.value())) {
        s.apply('RL-NAME-01', cleanProperName(s.value()));
      }
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'EMPLOYEE_NAME_REQUIRED', 'Last name is required.');
      }
      return pass(s);
    },
  },
  {
    field: 'email',
    label: 'Email Address',
    recordType: 'employee',
    required: false,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Email Address');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      const emailResult = cleanEmail(s.value());
      s.apply('RL-EMAIL-01', emailResult.cleaned);
      if (!isBlank(s.value()) && !emailResult.isValid) {
        return reject(s, 'RL-EMAIL-01', 'INVALID_EMAIL_FORMAT', `Email address '${s.value()}' is invalid.`);
      }
      return pass(s);
    },
  },
  {
    field: 'phone',
    label: 'Phone Number',
    recordType: 'employee',
    required: false,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Phone Number');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-PHONE-01', cleanPhone(s.value(), '+1'));
      return pass(s);
    },
  },
  {
    field: 'department_code',
    label: 'Employee Department Code',
    recordType: 'employee',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Employee Department Code');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'DEPARTMENT_CODE_REQUIRED', 'Employee department code is required.');
      }
      return pass(s);
    },
  },
  {
    field: 'job_title',
    label: 'Job Title',
    recordType: 'employee',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Job Title');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      return pass(s);
    },
  },
  {
    field: 'birth_date',
    label: 'Date of Birth',
    recordType: 'employee',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Date of Birth');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'BIRTH_DATE_REQUIRED', 'Date of birth is required.');
      }
      const coerced = coerceDateToIso(s.value());
      if (coerced.isValid) {
        s.apply('RL-DATE-01', coerced.cleaned);
        return pass(s);
      }
      return reject(s, 'RL-DATE-01', 'BIRTH_DATE_REQUIRED', `Date of birth '${s.value()}' is not a valid date.`);
    },
  },
  {
    field: 'join_date',
    label: 'Employment Join Date',
    recordType: 'employee',
    required: true,
    clean: (val, row, enabled) => {
      const injected = formulaReject(val, 'Join Date');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'JOIN_DATE_REQUIRED', 'Join date is required.');
      }
      const coerced = coerceDateToIso(s.value());
      if (coerced.isValid) {
        s.apply('RL-DATE-01', coerced.cleaned);
        // Domain invariant: join_date >= birth_date (BR-ERP5-01)
        const birthDateVal = (row['birth_date'] ?? '').trim();
        const birthCoerced = coerceDateToIso(birthDateVal);
        if (birthCoerced.isValid && s.value() < birthCoerced.cleaned) {
          return reject(
            s,
            'RL-DATE-01',
            'JOIN_DATE_BEFORE_BIRTH_DATE',
            `Join date '${s.value()}' precedes birth date '${birthCoerced.cleaned}'.`
          );
        }
        return pass(s);
      }
      return reject(s, 'RL-DATE-01', 'JOIN_DATE_REQUIRED', `Join date '${s.value()}' is not a valid date.`);
    },
  },
  {
    field: 'salary',
    label: 'Salary Amount',
    recordType: 'employee',
    required: false,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) {
        return pass(s);
      }
      const cleaned = cleanCurrencyDecimal(s.value());
      if (cleaned.isValid) {
        s.apply('RL-CURRENCY-01', cleaned.cleaned);
        const numeric = parseFloat(cleaned.cleaned);
        if (numeric < 0) {
          return reject(s, 'RL-CURRENCY-01', 'NEGATIVE_SALARY', 'Salary amount cannot be negative.');
        }
        return pass(s);
      }
      return reject(s, 'RL-CURRENCY-01', 'INVALID_SALARY', 'Salary amount is invalid.');
    },
  },
  {
    field: 'currency_code',
    label: 'Currency Code',
    recordType: 'employee',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'CURRENCY_CODE_REQUIRED', 'Currency code is required.');
      }
      if (!CURRENCY_SET.has(s.value())) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_CURRENCY', `Currency code must be one of ${ACCEPTED_CURRENCIES.join(', ')}.`);
      }
      return pass(s);
    },
  },

  // ── 3. Leave ───────────────────────────────────────────────────────────────
  {
    field: 'employee_no',
    label: 'Leave Employee Number',
    recordType: 'leave',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Leave Employee Number');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'EMPLOYEE_NO_REQUIRED', 'Employee number for leave is required.');
      }
      return pass(s);
    },
  },
  {
    field: 'leave_type',
    label: 'Leave Type',
    recordType: 'leave',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Leave Type');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim().toLowerCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'LEAVE_TYPE_REQUIRED', 'Leave type is required.');
      }
      if (!LEAVE_TYPE_SET.has(s.value())) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_LEAVE_TYPE', `Leave type must be one of ${LEAVE_TYPES.join(', ')}.`);
      }
      return pass(s);
    },
  },
  {
    field: 'date_from',
    label: 'Leave Start Date',
    recordType: 'leave',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Leave Start Date');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'DATE_FROM_REQUIRED', 'Leave start date is required.');
      }
      const coerced = coerceDateToIso(s.value());
      if (coerced.isValid) {
        s.apply('RL-DATE-01', coerced.cleaned);
        return pass(s);
      }
      return reject(s, 'RL-DATE-01', 'INVALID_LEAVE_DATES', `Leave start date '${s.value()}' is not a valid date.`);
    },
  },
  {
    field: 'date_to',
    label: 'Leave End Date',
    recordType: 'leave',
    required: true,
    clean: (val, row, enabled) => {
      const injected = formulaReject(val, 'Leave End Date');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'DATE_TO_REQUIRED', 'Leave end date is required.');
      }
      const coerced = coerceDateToIso(s.value());
      if (coerced.isValid) {
        s.apply('RL-DATE-01', coerced.cleaned);
        const fromVal = (row['date_from'] ?? '').trim();
        const fromCoerced = coerceDateToIso(fromVal);
        if (fromCoerced.isValid && s.value() < fromCoerced.cleaned) {
          return reject(
            s,
            'RL-DATE-01',
            'INVALID_LEAVE_DATES',
            `Leave end date '${s.value()}' precedes start date '${fromCoerced.cleaned}'.`
          );
        }
        return pass(s);
      }
      return reject(s, 'RL-DATE-01', 'INVALID_LEAVE_DATES', `Leave end date '${s.value()}' is not a valid date.`);
    },
  },
  {
    field: 'leave_reason',
    label: 'Leave Reason',
    recordType: 'leave',
    required: false,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Leave Reason');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      return pass(s);
    },
  },
  {
    field: 'leave_status',
    label: 'Leave Status',
    recordType: 'leave',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Leave Status');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim().toLowerCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'LEAVE_STATUS_REQUIRED', 'Leave status is required.');
      }
      if (!LEAVE_STATUS_SET.has(s.value())) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_LEAVE_STATUS', `Leave status must be one of ${LEAVE_STATUSES.join(', ')}.`);
      }
      return pass(s);
    },
  },

  // ── 4. Payroll Total ───────────────────────────────────────────────────────
  {
    field: 'employee_no',
    label: 'Payroll Total Employee Line Check',
    recordType: 'payroll_total',
    required: false,
    clean: (val, _row, _enabled) => {
      if (!isBlank(val)) {
        return {
          cleaned: val,
          audits: [],
          error: {
            ruleId: 'RL-FORMAT-01',
            reasonCode: 'EMPLOYEE_LINES_FORBIDDEN',
            message: 'Payroll totals must be department/month aggregates only; employee-level lines are forbidden.',
          },
        };
      }
      return { cleaned: val, audits: [] };
    },
  },
  {
    field: 'department_code',
    label: 'Payroll Department Code',
    recordType: 'payroll_total',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Payroll Department Code');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'DEPARTMENT_CODE_REQUIRED', 'Payroll department code is required.');
      }
      return pass(s);
    },
  },
  {
    field: 'month',
    label: 'Payroll Month',
    recordType: 'payroll_total',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Payroll Month');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'MONTH_REQUIRED', 'Payroll month is required.');
      }
      if (!/^\d{4}-\d{2}$/.test(s.value())) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_MONTH_FORMAT', `Payroll month '${s.value()}' must match YYYY-MM.`);
      }
      return pass(s);
    },
  },
  {
    field: 'gross_total',
    label: 'Gross Payroll Total',
    recordType: 'payroll_total',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      const cleaned = cleanCurrencyDecimal(s.value());
      if (cleaned.isValid) {
        s.apply('RL-CURRENCY-01', cleaned.cleaned);
        const numeric = parseFloat(cleaned.cleaned);
        if (numeric < 0) {
          return reject(s, 'RL-CURRENCY-01', 'NEGATIVE_GROSS_TOTAL', 'Gross payroll total cannot be negative.');
        }
        return pass(s);
      }
      return pass(s);
    },
  },
  {
    field: 'net_total',
    label: 'Net Payroll Total',
    recordType: 'payroll_total',
    required: true,
    clean: (val, row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      const cleaned = cleanCurrencyDecimal(s.value());
      if (cleaned.isValid) {
        s.apply('RL-CURRENCY-01', cleaned.cleaned);
        const netNumeric = parseFloat(cleaned.cleaned);
        if (netNumeric < 0) {
          return reject(s, 'RL-CURRENCY-01', 'NEGATIVE_NET_TOTAL', 'Net payroll total cannot be negative.');
        }
        const grossVal = (row['gross_total'] ?? '').trim();
        const grossCleaned = cleanCurrencyDecimal(grossVal);
        if (grossCleaned.isValid) {
          const grossNumeric = parseFloat(grossCleaned.cleaned);
          if (netNumeric > grossNumeric) {
            return reject(s, 'RL-CURRENCY-01', 'NET_EXCEEDS_GROSS', 'Net payroll total cannot exceed gross payroll total.');
          }
        }
        return pass(s);
      }
      return pass(s);
    },
  },
  {
    field: 'employee_count',
    label: 'Employee Count',
    recordType: 'payroll_total',
    required: false,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (!isBlank(s.value())) {
        const count = parseInt(s.value(), 10);
        if (isNaN(count) || count < 0) {
          return reject(s, 'RL-FORMAT-01', 'NEGATIVE_EMPLOYEE_COUNT', 'Employee count cannot be negative.');
        }
      }
      return pass(s);
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Engine API
// ─────────────────────────────────────────────────────────────────────────────

export function createErp5CleanerConfig(enabledRuleIds?: readonly string[]): CleanerConfig {
  return {
    fields: ERP5_FIELD_CLEAN_RULES,
    enabledRuleIds,
    sourceRowField: 'row_id',
    recordTypeField: 'record_type',
  };
}

/**
 * Cleans an ERP-5 dataset using the shared kit cleaner engine and ERP-5 cleaning rules.
 * Enforces non-destructive execution (never mutates input rows).
 */
export function cleanErp5Dataset(
  rows: readonly Record<string, string>[],
  enabledRuleIds?: readonly string[]
): DatasetCleanResult<Record<string, string>> {
  const config = createErp5CleanerConfig(enabledRuleIds);
  return cleanDataset<Record<string, string>>(rows, config);
}

/**
 * Exports field-level change audits to formula-safe CSV conforming to SDS §4.4 (kit_clean_log).
 */
export function exportErp5FieldAuditCsv(audits: readonly FieldChangeAudit[]): string {
  return exportFieldAuditCsv(audits);
}
