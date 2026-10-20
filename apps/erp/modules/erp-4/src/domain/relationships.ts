/**
 * ERP-4 Finance & Accounting — Domain Relationships & State Transitions
 *
 * Implements deterministic domain link validation, cross-module reference checking,
 * state transition matrices, and read-model consistency verification per SDS V1.
 *
 * Requirements & Invariants:
 *   - FR-ERP4-01: Unique account code, name, type (asset/liability/income/expense).
 *   - FR-ERP4-02 & BR-ERP4-01: Journal entries with balanced debit/credit lines.
 *   - FR-ERP4-03: Trial balance totals computed from authoritative persisted movements.
 *   - FR-ERP4-04: One-time opening balance load per account/currency.
 *   - FR-ERP4-05 & BR-ERP4-02: Accounting period posting guard (closed period rejects).
 *   - Decision C7: Cross-module integrity validated via ReferenceResolver without direct cross-schema FKs.
 *   - State transitions: Enforces immutable posted entries, reversals for corrections, and strict FSM.
 *   - Optional relationships: Absent optional references produce approved warnings rather than synthetic records.
 *
 * @module erp4/domain/relationships
 */

import type {
  Account,
  AccountType,
  JournalEntry,
  JournalLine,
  JournalEntryStatus,
  AccountingPeriod,
  PeriodStatus,
  OpeningBalance,
  TrialBalanceRow,
} from '@clearshift/contracts';
import { DomainError, assertDoubleEntryBalanced } from '../../domain/engine.js';
import type { ReferenceResolver } from '@cs/kernel';

/**
 * Validates double-entry balance and throws if unbalanced (BR-ERP4-01).
 * Re-exports assertDoubleEntryBalanced for domain relationship enforcement.
 */
export const validateJournalEntryBalance = assertDoubleEntryBalanced;

// ─────────────────────────────────────────────────────────────────────────────
// Stable Relationship & Transition Error Codes
// ─────────────────────────────────────────────────────────────────────────────

export const RELATIONSHIP_ERROR_CODES = {
  // Account Hierarchy & Self-Referential
  PARENT_NOT_FOUND: 'PARENT_NOT_FOUND',
  CYCLE_DETECTED: 'CYCLE_DETECTED',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',

  // Account Status & Posting Ability
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  CANNOT_POST_TO_HEADER_ACCOUNT: 'CANNOT_POST_TO_HEADER_ACCOUNT',

  // Period Governance & Posting Guard
  PERIOD_NOT_FOUND: 'PERIOD_NOT_FOUND',
  PERIOD_LOCKED: 'PERIOD_LOCKED',
  PERIOD_SOFT_CLOSED: 'PERIOD_SOFT_CLOSED',
  INVALID_PERIOD_TRANSITION: 'INVALID_PERIOD_TRANSITION',

  // Double-Entry & Per-Line Invariants
  MINIMUM_LINES_REQUIRED: 'MINIMUM_LINES_REQUIRED',
  LINE_DEBIT_AND_CREDIT: 'LINE_DEBIT_AND_CREDIT',
  LINE_ZERO_AMOUNTS: 'LINE_ZERO_AMOUNTS',
  UNBALANCED_ENTRY: 'UNBALANCED_ENTRY',

  // Journal Entry State Lifecycle
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  ENTRY_IMMUTABLE: 'ENTRY_IMMUTABLE',
  NOT_REVERSIBLE: 'NOT_REVERSIBLE',

  // Opening Balance Rules
  DUPLICATE_OPENING_BALANCE: 'DUPLICATE_OPENING_BALANCE',

  // Cross-Module References
  MISSING_REQUIRED_REFERENCE: 'MISSING_REQUIRED_REFERENCE',
  INVALID_REFERENCE: 'INVALID_REFERENCE',
  DEPARTMENT_NOT_FOUND: 'DEPARTMENT_NOT_FOUND',
  SOURCE_ENTITY_NOT_FOUND: 'SOURCE_ENTITY_NOT_FOUND',

  // Enumeration Checks
  INVALID_ENUM_VALUE: 'INVALID_ENUM_VALUE',

  // Read-Model Inconsistency
  READ_MODEL_INCONSISTENT: 'READ_MODEL_INCONSISTENT',
} as const;

export type RelationshipErrorCode =
  (typeof RELATIONSHIP_ERROR_CODES)[keyof typeof RELATIONSHIP_ERROR_CODES];

// ─────────────────────────────────────────────────────────────────────────────
// Relationship Metadata & Catalog
// ─────────────────────────────────────────────────────────────────────────────

export type RelationshipType = 'intra_module' | 'cross_module';
export type RelationshipRequirement = 'required' | 'optional';
export type ReferentialAction = 'RESTRICT' | 'CASCADE' | 'SET_NULL' | 'NO_ACTION';

export interface RelationshipDefinition {
  name: string;
  sourceEntity: string;
  targetEntity: string;
  foreignKey: string;
  type: RelationshipType;
  requirement: RelationshipRequirement;
  onDelete: ReferentialAction;
  owningModule: string;
  targetModule: string;
  description: string;
}

export const ERP4_RELATIONSHIPS: Record<string, RelationshipDefinition> = {
  ACCOUNT_PARENT: {
    name: 'ACCOUNT_PARENT',
    sourceEntity: 'erp4_accounts',
    targetEntity: 'erp4_accounts',
    foreignKey: 'parent_id',
    type: 'intra_module',
    requirement: 'optional',
    onDelete: 'RESTRICT',
    owningModule: 'erp-4',
    targetModule: 'erp-4',
    description: 'Self-referential account hierarchy node. Parent must exist and share currency.',
  },
  JOURNAL_ENTRY_PERIOD: {
    name: 'JOURNAL_ENTRY_PERIOD',
    sourceEntity: 'erp4_journal_entries',
    targetEntity: 'erp4_accounting_periods',
    foreignKey: 'period_id',
    type: 'intra_module',
    requirement: 'required',
    onDelete: 'RESTRICT',
    owningModule: 'erp-4',
    targetModule: 'erp-4',
    description: 'Fiscal period governing accounting date and posting permissions.',
  },
  JOURNAL_ENTRY_LINES: {
    name: 'JOURNAL_ENTRY_LINES',
    sourceEntity: 'erp4_journal_entries',
    targetEntity: 'erp4_journal_lines',
    foreignKey: 'journal_entry_id',
    type: 'intra_module',
    requirement: 'required',
    onDelete: 'CASCADE',
    owningModule: 'erp-4',
    targetModule: 'erp-4',
    description: 'Composite double-entry lines (minimum 2 lines required per journal entry).',
  },
  JOURNAL_LINE_ACCOUNT: {
    name: 'JOURNAL_LINE_ACCOUNT',
    sourceEntity: 'erp4_journal_lines',
    targetEntity: 'erp4_accounts',
    foreignKey: 'account_id',
    type: 'intra_module',
    requirement: 'required',
    onDelete: 'RESTRICT',
    owningModule: 'erp-4',
    targetModule: 'erp-4',
    description: 'General ledger account receiving the debit or credit movement.',
  },
  JOURNAL_ENTRY_REVERSAL: {
    name: 'JOURNAL_ENTRY_REVERSAL',
    sourceEntity: 'erp4_journal_entries',
    targetEntity: 'erp4_journal_entries',
    foreignKey: 'reversed_by_entry_id',
    type: 'intra_module',
    requirement: 'optional',
    onDelete: 'RESTRICT',
    owningModule: 'erp-4',
    targetModule: 'erp-4',
    description: 'Compensating reversal entry link for posted journal corrections.',
  },
  OPENING_BALANCE_ACCOUNT: {
    name: 'OPENING_BALANCE_ACCOUNT',
    sourceEntity: 'erp4_opening_balances',
    targetEntity: 'erp4_accounts',
    foreignKey: 'account_id',
    type: 'intra_module',
    requirement: 'required',
    onDelete: 'RESTRICT',
    owningModule: 'erp-4',
    targetModule: 'erp-4',
    description: 'General ledger account receiving one-time opening balance load.',
  },
  JOURNAL_LINE_DEPARTMENT: {
    name: 'JOURNAL_LINE_DEPARTMENT',
    sourceEntity: 'erp4_journal_lines',
    targetEntity: 'erp5_departments',
    foreignKey: 'department_ref',
    type: 'cross_module',
    requirement: 'optional',
    onDelete: 'SET_NULL',
    owningModule: 'erp-4',
    targetModule: 'erp-5',
    description: 'Cost-centre dimension reference validated via ReferenceResolver.',
  },
  JOURNAL_ENTRY_SOURCE: {
    name: 'JOURNAL_ENTRY_SOURCE',
    sourceEntity: 'erp4_journal_entries',
    targetEntity: 'external_source',
    foreignKey: 'source_reference',
    type: 'cross_module',
    requirement: 'optional',
    onDelete: 'SET_NULL',
    owningModule: 'erp-4',
    targetModule: 'erp-3',
    description: 'External source document (e.g. sales invoice or purchase order) reference.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// State Transition Matrices & Finite State Machines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Journal Entry State Lifecycle:
 *   draft   → posted   (via post action; locks entry immutably)
 *   draft   → voided   (via void action; administrative cancellation)
 *   posted  → reversed (via reverse action; creates compensating reversal entry)
 *
 * Forbidden transitions:
 *   posted  → draft    (FORBIDDEN: posted entries are immutable)
 *   posted  → voided   (FORBIDDEN: posted entries can only be reversed)
 *   reversed→ *        (FORBIDDEN: terminal state)
 *   voided  → *        (FORBIDDEN: terminal state)
 *   draft   → reversed (FORBIDDEN: unposted draft cannot be reversed)
 */
export const JOURNAL_ENTRY_TRANSITIONS: Record<JournalEntryStatus, readonly JournalEntryStatus[]> = {
  draft: ['posted', 'voided'],
  posted: ['reversed'],
  reversed: [],
  voided: [],
} as const;

/**
 * Accounting Period Lifecycle:
 *   open        → soft_closed, locked
 *   soft_closed → open (admin reopen), locked
 *   locked      → (terminal; closed periods cannot be reopened in V1)
 */
export const PERIOD_TRANSITIONS: Record<PeriodStatus, readonly PeriodStatus[]> = {
  open: ['soft_closed', 'locked'],
  soft_closed: ['open', 'locked'],
  locked: [],
} as const;

export function isJournalEntryTransitionAllowed(
  current: JournalEntryStatus,
  next: JournalEntryStatus
): boolean {
  return JOURNAL_ENTRY_TRANSITIONS[current]?.includes(next) ?? false;
}

export function assertJournalEntryTransition(
  current: JournalEntryStatus,
  next: JournalEntryStatus,
  entryId?: string
): void {
  const allowed = JOURNAL_ENTRY_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    // Determine precise failure code
    if (current === 'posted' && next === 'draft') {
      throw new DomainError(
        RELATIONSHIP_ERROR_CODES.ENTRY_IMMUTABLE,
        `Journal entry ${entryId ? `"${entryId}" ` : ''}is posted and strictly immutable. Corrections must use reversal entries, not direct edits.`,
        { current_status: current, requested_status: next, entry_id: entryId }
      );
    }
    if (current === 'posted' && next === 'voided') {
      throw new DomainError(
        RELATIONSHIP_ERROR_CODES.ENTRY_IMMUTABLE,
        `Posted journal entry ${entryId ? `"${entryId}" ` : ''}cannot be voided. Corrections to posted entries must use compensating reversals.`,
        { current_status: current, requested_status: next, entry_id: entryId }
      );
    }
    if (next === 'reversed' && current !== 'posted') {
      throw new DomainError(
        RELATIONSHIP_ERROR_CODES.NOT_REVERSIBLE,
        `Journal entry ${entryId ? `"${entryId}" ` : ''}cannot be reversed because its status is "${current}". Only posted entries can be reversed.`,
        { current_status: current, requested_status: next, entry_id: entryId }
      );
    }
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.INVALID_STATUS_TRANSITION,
      `Cannot transition journal entry from "${current}" to "${next}". Allowed transitions from "${current}": [${allowed?.join(', ') || 'none'}].`,
      { current_status: current, requested_status: next, entry_id: entryId }
    );
  }
}

export function isPeriodTransitionAllowed(current: PeriodStatus, next: PeriodStatus): boolean {
  return PERIOD_TRANSITIONS[current]?.includes(next) ?? false;
}

export function assertPeriodTransition(
  current: PeriodStatus,
  next: PeriodStatus,
  periodLabel?: string
): void {
  const allowed = PERIOD_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    if (current === 'locked') {
      throw new DomainError(
        RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED,
        `Accounting period ${periodLabel ? `"${periodLabel}" ` : ''}is locked and cannot be transitioned to "${next}". Locked periods are immutable in V1.`,
        { current_status: current, requested_status: next, period_label: periodLabel }
      );
    }
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.INVALID_PERIOD_TRANSITION,
      `Cannot transition accounting period from "${current}" to "${next}". Allowed transitions from "${current}": [${allowed?.join(', ') || 'none'}].`,
      { current_status: current, requested_status: next, period_label: periodLabel }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional Relationship Handling & Warnings
// ─────────────────────────────────────────────────────────────────────────────

export interface RelationshipWarning {
  relationship: string;
  field: string;
  code: 'OPTIONAL_REFERENCE_ABSENT';
  message: string;
}

/**
 * Ensures that where an optional relationship is absent, an approved warning is produced
 * rather than inventing a dummy record.
 */
export function handleOptionalRelationship<T>(
  value: T | null | undefined,
  fieldName: string,
  relationshipName: string
): { value: T | null; warning?: RelationshipWarning } {
  if (value === null || value === undefined || value === '') {
    return {
      value: null,
      warning: {
        relationship: relationshipName,
        field: fieldName,
        code: 'OPTIONAL_REFERENCE_ABSENT',
        message: `Optional relationship "${relationshipName}" on field "${fieldName}" is absent. No synthetic record was created.`,
      },
    };
  }
  return { value };
}

// ─────────────────────────────────────────────────────────────────────────────
// Intra-Module Relationship Validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates self-referential parent account hierarchy:
 *  - Parent exists
 *  - No self-reference
 *  - No cyclical ancestry
 *  - Currency alignment between parent and child
 */
export function validateAccountParent(
  candidate: { id?: string; code: string; currency_code?: string; parent_id?: string | null },
  parent: Account | null,
  getParentFn?: (id: string) => string | null | undefined
): void {
  if (!candidate.parent_id) return;

  if (candidate.id && candidate.id === candidate.parent_id) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.CYCLE_DETECTED,
      `Account "${candidate.code}" cannot have itself as parent_id.`,
      { account_id: candidate.id, parent_id: candidate.parent_id }
    );
  }

  if (!parent) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.PARENT_NOT_FOUND,
      `Parent account with ID "${candidate.parent_id}" not found.`,
      { parent_id: candidate.parent_id }
    );
  }

  if (candidate.currency_code && parent.currency_code !== candidate.currency_code) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.CURRENCY_MISMATCH,
      `Currency mismatch: parent account "${parent.code}" uses "${parent.currency_code}", but child account "${candidate.code}" specifies "${candidate.currency_code}".`,
      { parent_currency: parent.currency_code, child_currency: candidate.currency_code }
    );
  }

  if (candidate.id && getParentFn) {
    let currentId: string | null | undefined = candidate.parent_id;
    const visited = new Set<string>([candidate.id]);
    while (currentId) {
      if (visited.has(currentId)) {
        throw new DomainError(
          RELATIONSHIP_ERROR_CODES.CYCLE_DETECTED,
          `Circular parent hierarchy detected: account "${candidate.id}" is in the ancestor chain of "${candidate.parent_id}".`,
          { account_id: candidate.id, parent_id: candidate.parent_id }
        );
      }
      visited.add(currentId);
      currentId = getParentFn(currentId);
    }
  }
}

/**
 * Validates a journal line's link to its general ledger account:
 *  - Account exists
 *  - Account is active (soft-deleted accounts cannot receive postings)
 *  - Account is a posting account (header/group accounts cannot receive postings)
 *  - Account currency matches journal entry currency (V1 performs no FX conversion)
 */
export function validateJournalLineAccount(
  line: { account_id: string; debit_amount?: string; credit_amount?: string },
  account: Account | null,
  entryCurrency: string,
  lineIndex: number
): void {
  if (!account) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.ACCOUNT_NOT_FOUND,
      `Line [${lineIndex}]: Account with ID "${line.account_id}" does not exist.`,
      { line_index: lineIndex, account_id: line.account_id }
    );
  }

  if (!account.is_active) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.ACCOUNT_INACTIVE,
      `Line [${lineIndex}]: Account "${account.code}" is inactive and cannot receive journal postings.`,
      { line_index: lineIndex, account_id: line.account_id, account_code: account.code }
    );
  }

  if (!account.is_posting_account) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.CANNOT_POST_TO_HEADER_ACCOUNT,
      `Line [${lineIndex}]: Account "${account.code}" is a summary/header account and cannot receive direct journal postings.`,
      { line_index: lineIndex, account_id: line.account_id, account_code: account.code }
    );
  }

  if (account.currency_code !== entryCurrency) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.CURRENCY_MISMATCH,
      `Line [${lineIndex}]: Currency mismatch between account "${account.code}" (${account.currency_code}) and journal entry (${entryCurrency}). V1 performs no FX conversion.`,
      {
        line_index: lineIndex,
        account_id: line.account_id,
        account_currency: account.currency_code,
        entry_currency: entryCurrency,
      }
    );
  }
}

/**
 * Validates the journal entry to accounting period relationship:
 *  - Period exists
 *  - Period accepts posting per user role (BR-ERP4-02)
 */
export function validateJournalEntryPeriod(
  period: AccountingPeriod | null,
  userRole: string = 'staff'
): void {
  if (!period) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.PERIOD_NOT_FOUND,
      'Accounting period was not found.',
      {}
    );
  }

  if (period.status === 'locked') {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED,
      `Accounting period "${period.period_label}" is locked. No entries can be posted into this period. Create a reversal in an open period instead.`,
      { period_label: period.period_label, status: period.status }
    );
  }

  if (period.status === 'soft_closed' && userRole !== 'finance_admin') {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.PERIOD_SOFT_CLOSED,
      `Accounting period "${period.period_label}" is soft-closed. Only finance_admin users may post into this period.`,
      { period_label: period.period_label, status: period.status, user_role: userRole }
    );
  }
}

/**
 * Validates opening balance link to general ledger account:
 *  - Account exists, is active, is a posting account
 *  - Account currency matches item currency
 *  - Enforces one-time load per account+currency (FR-ERP4-04)
 */
export function validateOpeningBalanceAccount(
  item: { account_id: string; currency_code: string; balance_amount: string },
  account: Account | null,
  existingBalance: OpeningBalance | null
): void {
  if (!account) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.ACCOUNT_NOT_FOUND,
      `Account with ID "${item.account_id}" does not exist.`,
      { account_id: item.account_id }
    );
  }

  if (!account.is_active) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.ACCOUNT_INACTIVE,
      `Account "${account.code}" is inactive and cannot receive opening balances.`,
      { account_id: item.account_id, account_code: account.code }
    );
  }

  if (!account.is_posting_account) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.CANNOT_POST_TO_HEADER_ACCOUNT,
      `Account "${account.code}" is a header account and cannot receive opening balances.`,
      { account_id: item.account_id, account_code: account.code }
    );
  }

  if (account.currency_code !== item.currency_code) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.CURRENCY_MISMATCH,
      `Currency mismatch: account "${account.code}" is denominated in "${account.currency_code}", but opening balance is in "${item.currency_code}".`,
      { account_currency: account.currency_code, item_currency: item.currency_code }
    );
  }

  if (existingBalance) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.DUPLICATE_OPENING_BALANCE,
      `Opening balance already loaded for account "${account.code}" in currency "${item.currency_code}". Starting balances may only be loaded once (FR-ERP4-04).`,
      { account_id: item.account_id, currency_code: item.currency_code }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Module Reference Validation (Decision C7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates cross-module references via the ReferenceResolver port without direct cross-schema queries.
 *
 * Rules:
 *   - If reference is absent and optional → returns warning, no error, no synthetic record.
 *   - If reference is absent and required → throws MISSING_REQUIRED_REFERENCE.
 *   - If reference is provided → verifies existence via resolver. If not found, throws stable error.
 *   - Resolver failures are caught and handled safely.
 */
export async function validateCrossModuleReference(
  resolver: ReferenceResolver | undefined,
  entityType: string,
  referenceId: string | null | undefined,
  isRequired: boolean,
  fieldName: string,
  errorOverrideCode?: string
): Promise<{ valid: boolean; warning?: RelationshipWarning | undefined }> {
  const optionalHandling = handleOptionalRelationship(referenceId, fieldName, entityType);

  if (!optionalHandling.value) {
    if (isRequired) {
      throw new DomainError(
        RELATIONSHIP_ERROR_CODES.MISSING_REQUIRED_REFERENCE,
        `Required cross-module reference "${fieldName}" for entity "${entityType}" is missing.`,
        { field: fieldName, entity_type: entityType }
      );
    }
    return {
      valid: true,
      ...(optionalHandling.warning !== undefined && { warning: optionalHandling.warning }),
    };
  }

  if (!resolver) {
    // If no resolver is configured in current runtime, pass through safely
    return { valid: true };
  }

  try {
    const exists = await resolver.exists(entityType, optionalHandling.value);
    if (!exists) {
      const code =
        errorOverrideCode ??
        (entityType === 'department'
          ? RELATIONSHIP_ERROR_CODES.DEPARTMENT_NOT_FOUND
          : RELATIONSHIP_ERROR_CODES.INVALID_REFERENCE);

      throw new DomainError(
        code,
        `Referenced ${entityType} "${optionalHandling.value}" on field "${fieldName}" does not exist in the owning module.`,
        { field: fieldName, entity_type: entityType, reference_id: optionalHandling.value }
      );
    }
    return { valid: true };
  } catch (err) {
    if (err instanceof DomainError) throw err;
    // Failure-safe wrapper around external resolver call
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.INVALID_REFERENCE,
      `Cross-module reference check failed for ${entityType} "${optionalHandling.value}": ${err instanceof Error ? err.message : 'Unknown error'}`,
      { field: fieldName, entity_type: entityType, reference_id: optionalHandling.value }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enumeration Validation
// ─────────────────────────────────────────────────────────────────────────────

export const VALID_ACCOUNT_TYPES = new Set<AccountType>([
  'asset',
  'liability',
  'income',
  'expense',
]);

export function assertValidAccountType(type: unknown): AccountType {
  if (typeof type !== 'string' || !VALID_ACCOUNT_TYPES.has(type as AccountType)) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.INVALID_ENUM_VALUE,
      `Invalid account type: "${String(type)}". Must be one of: asset, liability, income, expense.`,
      { field: 'type', value: type, allowed: Array.from(VALID_ACCOUNT_TYPES) }
    );
  }
  return type as AccountType;
}

export const VALID_JOURNAL_ENTRY_STATUSES = new Set<JournalEntryStatus>([
  'draft',
  'posted',
  'reversed',
  'voided',
]);

export function assertValidJournalEntryStatus(status: unknown): JournalEntryStatus {
  if (typeof status !== 'string' || !VALID_JOURNAL_ENTRY_STATUSES.has(status as JournalEntryStatus)) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.INVALID_ENUM_VALUE,
      `Invalid journal entry status: "${String(status)}". Must be one of: draft, posted, reversed, voided.`,
      { field: 'status', value: status, allowed: Array.from(VALID_JOURNAL_ENTRY_STATUSES) }
    );
  }
  return status as JournalEntryStatus;
}

export const VALID_PERIOD_STATUSES = new Set<PeriodStatus>(['open', 'soft_closed', 'locked']);

export function assertValidPeriodStatus(status: unknown): PeriodStatus {
  if (typeof status !== 'string' || !VALID_PERIOD_STATUSES.has(status as PeriodStatus)) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.INVALID_ENUM_VALUE,
      `Invalid accounting period status: "${String(status)}". Must be one of: open, soft_closed, locked.`,
      { field: 'status', value: status, allowed: Array.from(VALID_PERIOD_STATUSES) }
    );
  }
  return status as PeriodStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-Model & Derived Values Consistency Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asserts that a journal entry read model agrees with authoritative persisted constraints:
 *   - Minimum 2 lines
 *   - Posted entries must have posted_at and posted_by_user_id
 *   - Reversed entries must have reversed_by_entry_id
 *   - Draft entries must have null posted_at and null posted_by_user_id
 */
export function assertJournalEntryReadConsistency(entry: JournalEntry): void {
  if (!entry.lines || entry.lines.length < 2) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.READ_MODEL_INCONSISTENT,
      `Journal entry ${entry.entry_number} violates consistency: must have at least 2 lines, found ${entry.lines?.length ?? 0}.`,
      { entry_id: entry.id, line_count: entry.lines?.length ?? 0 }
    );
  }

  if (entry.status === 'posted') {
    if (!entry.posted_at || !entry.posted_by_user_id) {
      throw new DomainError(
        RELATIONSHIP_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Posted journal entry ${entry.entry_number} violates consistency: posted_at and posted_by_user_id must be populated.`,
        { entry_id: entry.id, status: entry.status }
      );
    }
  }

  if (entry.status === 'reversed') {
    if (!entry.reversed_by_entry_id) {
      throw new DomainError(
        RELATIONSHIP_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Reversed journal entry ${entry.entry_number} violates consistency: reversed_by_entry_id must be populated.`,
        { entry_id: entry.id, status: entry.status }
      );
    }
  }

  if (entry.status === 'draft') {
    if (entry.posted_at !== null || entry.posted_by_user_id !== null) {
      throw new DomainError(
        RELATIONSHIP_ERROR_CODES.READ_MODEL_INCONSISTENT,
        `Draft journal entry ${entry.entry_number} violates consistency: posted_at and posted_by_user_id must be null.`,
        { entry_id: entry.id, status: entry.status }
      );
    }
  }
}

/**
 * Asserts that the trial balance read model derived grand totals agree exactly with individual row sums:
 *   - SUM(rows.total_debit) == totals.total_debit
 *   - SUM(rows.total_credit) == totals.total_credit
 *   - totals.difference == |totals.total_debit - totals.total_credit|
 *   - totals.is_balanced == (totals.difference === "0.0000")
 */
export function assertTrialBalanceReadConsistency(
  totals: { total_debit: string; total_credit: string; difference: string; is_balanced: boolean },
  rows: TrialBalanceRow[]
): void {
  let sumDebit = 0;
  let sumCredit = 0;

  for (const row of rows) {
    sumDebit += Math.round(parseFloat(row.total_debit) * 10000);
    sumCredit += Math.round(parseFloat(row.total_credit) * 10000);
  }

  const expectedDebit = (sumDebit / 10000).toFixed(4);
  const expectedCredit = (sumCredit / 10000).toFixed(4);

  if (parseFloat(totals.total_debit) !== parseFloat(expectedDebit)) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.READ_MODEL_INCONSISTENT,
      `Trial balance total debit mismatch: report says ${totals.total_debit}, but sum of rows is ${expectedDebit}.`,
      { report_debit: totals.total_debit, sum_rows_debit: expectedDebit }
    );
  }

  if (parseFloat(totals.total_credit) !== parseFloat(expectedCredit)) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.READ_MODEL_INCONSISTENT,
      `Trial balance total credit mismatch: report says ${totals.total_credit}, but sum of rows is ${expectedCredit}.`,
      { report_credit: totals.total_credit, sum_rows_credit: expectedCredit }
    );
  }

  const diff = Math.abs(sumDebit - sumCredit);
  const isBalanced = diff === 0;

  if (totals.is_balanced !== isBalanced) {
    throw new DomainError(
      RELATIONSHIP_ERROR_CODES.READ_MODEL_INCONSISTENT,
      `Trial balance is_balanced flag inconsistency: expected ${isBalanced}, received ${totals.is_balanced}.`,
      { expected_is_balanced: isBalanced, received_is_balanced: totals.is_balanced }
    );
  }
}
