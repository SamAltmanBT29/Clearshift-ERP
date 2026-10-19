/**
 * ERP-4 Finance — Domain Engine
 *
 * Pure, stateless business rule functions.  No I/O; no DB dependencies.
 * These can be unit-tested in isolation (no mocks required).
 *
 * Implements:
 *   - Double-entry balance validation (BR-ERP4-01)
 *   - Accounting period posting guard (BR-ERP4-02)
 *   - Monetary precision arithmetic (integer minor-units, no IEEE-754)
 *
 * @module erp4/domain/engine
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixed-precision monetary arithmetic (4 decimal places)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scale factor: 4 decimal places → work in units of 0.0001.
 * Example: "1234.5678" → 12345678 integer units
 */
const SCALE = 10000n; // BigInt for zero-overflow arithmetic

/**
 * Parse a string-encoded monetary amount to a BigInt integer (minor units).
 * Throws if the value is not a valid non-negative decimal.
 */
export function parseMoneyToMinorUnits(amount: string): bigint {
  const trimmed = amount.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d{1,4}))?$/);
  if (match === null) {
    throw new DomainError(
      `INVALID_AMOUNT`,
      `Amount "${amount}" is not a valid non-negative decimal (max 4dp)`
    );
  }
  const whole = BigInt(match[1] ?? '0');
  const fracStr = (match[2] ?? '').padEnd(4, '0').slice(0, 4);
  const frac = BigInt(fracStr);
  return whole * SCALE + frac;
}

/**
 * Format a BigInt (minor units) back to a 4dp string.
 * Example: 12345678n → "1234.5678"
 */
export function formatMinorUnitsToMoney(units: bigint): string {
  const absUnits = units < 0n ? -units : units;
  const sign = units < 0n ? '-' : '';
  const whole = absUnits / SCALE;
  const frac = (absUnits % SCALE).toString().padStart(4, '0');
  return `${sign}${whole}.${frac}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain error
// ─────────────────────────────────────────────────────────────────────────────

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Journal line shape (minimal — avoids DB coupling)
// ─────────────────────────────────────────────────────────────────────────────

export interface JournalLineInput {
  account_id: string;
  debit_amount: string;
  credit_amount: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounting Period guard (BR-ERP4-02)
// ─────────────────────────────────────────────────────────────────────────────

export type PeriodStatus = 'open' | 'soft_closed' | 'locked';

export interface AccountingPeriodGuard {
  period_label: string;
  status: PeriodStatus;
}

/**
 * Validates that posting is permitted for the given period and user role.
 *
 * Rules:
 *   - `open`        → any role may post
 *   - `soft_closed` → only `finance_admin` may post
 *   - `locked`      → no role may post; throws unconditionally
 *
 * @throws DomainError with code PERIOD_LOCKED or PERIOD_SOFT_CLOSED
 */
export function assertPeriodAcceptsPosting(
  period: AccountingPeriodGuard,
  userRole: string
): void {
  if (period.status === 'locked') {
    throw new DomainError(
      'PERIOD_LOCKED',
      `Accounting period "${period.period_label}" is locked. ` +
        `No entries can be posted. Create a reversal in an open period instead.`,
      { period_label: period.period_label, status: period.status }
    );
  }

  if (period.status === 'soft_closed' && userRole !== 'finance_admin') {
    throw new DomainError(
      'PERIOD_SOFT_CLOSED',
      `Accounting period "${period.period_label}" is soft-closed. ` +
        `Only finance_admin users may post into this period.`,
      { period_label: period.period_label, status: period.status, user_role: userRole }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-line invariant checks (BR-ERP4-01)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a single journal line against per-line domain rules.
 *
 * Enforces:
 *   1. debit_amount >= 0
 *   2. credit_amount >= 0
 *   3. NOT (debit > 0 AND credit > 0)
 *   4. debit > 0 OR credit > 0  (at least one non-zero)
 *
 * @throws DomainError with a specific code for each violated invariant
 */
export function assertJournalLineValid(line: JournalLineInput, lineIndex: number): void {
  const debit = parseMoneyToMinorUnits(line.debit_amount);
  const credit = parseMoneyToMinorUnits(line.credit_amount);

  // Rule 3: cannot carry both debit AND credit
  if (debit > 0n && credit > 0n) {
    throw new DomainError(
      'LINE_DEBIT_AND_CREDIT',
      `Line [${lineIndex}] for account "${line.account_id}" has both ` +
        `debit_amount (${line.debit_amount}) and credit_amount (${line.credit_amount}) > 0. ` +
        `A line must be exclusively debit or exclusively credit.`,
      { line_index: lineIndex, account_id: line.account_id }
    );
  }

  // Rule 4: at least one must be non-zero
  if (debit === 0n && credit === 0n) {
    throw new DomainError(
      'LINE_ZERO_AMOUNTS',
      `Line [${lineIndex}] for account "${line.account_id}" has both ` +
        `debit_amount and credit_amount equal to zero. A line must carry a non-zero amount.`,
      { line_index: lineIndex, account_id: line.account_id }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Double-entry balance check (BR-ERP4-01, FR-ERP4-02)
// ─────────────────────────────────────────────────────────────────────────────

export interface BalanceCheckResult {
  /** Sum of all debit amounts as a 4dp string. */
  total_debit: string;
  /** Sum of all credit amounts as a 4dp string. */
  total_credit: string;
  /** Absolute difference (should be "0.0000" for a balanced entry). */
  difference: string;
  /** True only when SUM(debit) == SUM(credit) at 4dp precision. */
  is_balanced: boolean;
}

/**
 * Validates that a complete set of journal lines satisfies the double-entry
 * equilibrium invariant: SUM(debit) === SUM(credit) at 4 decimal precision.
 *
 * Uses BigInt arithmetic — zero IEEE-754 rounding drift.
 *
 * @param lines - Array of candidate journal lines
 * @param currencyCode - The declared currency of the entry (for error context)
 * @returns A BalanceCheckResult — caller can decide whether to throw
 */
export function checkDoubleEntryBalance(
  lines: JournalLineInput[],
  currencyCode: string
): BalanceCheckResult {
  let totalDebit = 0n;
  let totalCredit = 0n;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Per-line validation first
    assertJournalLineValid(line, i);

    totalDebit += parseMoneyToMinorUnits(line.debit_amount);
    totalCredit += parseMoneyToMinorUnits(line.credit_amount);
  }

  const difference = totalDebit > totalCredit ? totalDebit - totalCredit : totalCredit - totalDebit;
  const is_balanced = difference === 0n;

  return {
    total_debit: formatMinorUnitsToMoney(totalDebit),
    total_credit: formatMinorUnitsToMoney(totalCredit),
    difference: formatMinorUnitsToMoney(difference),
    is_balanced,
  };
}

/**
 * Validates double-entry balance and throws if the entry is unbalanced.
 *
 * @throws DomainError with code UNBALANCED_ENTRY
 */
export function assertDoubleEntryBalanced(
  lines: JournalLineInput[],
  currencyCode: string
): BalanceCheckResult {
  const result = checkDoubleEntryBalance(lines, currencyCode);

  if (!result.is_balanced) {
    throw new DomainError(
      'UNBALANCED_ENTRY',
      `Journal entry is not balanced in ${currencyCode}. ` +
        `Total Debit: ${result.total_debit}, Total Credit: ${result.total_credit}, ` +
        `Difference: ${result.difference}. Every posted entry must satisfy SUM(debit) = SUM(credit).`,
      { currency_code: currencyCode, ...result }
    );
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Journal entry state machine (FR-ERP4-02, BR-ERP4-01)
// ─────────────────────────────────────────────────────────────────────────────

export type JournalEntryStatus = 'draft' | 'posted' | 'reversed' | 'voided';

/**
 * Valid status transitions.
 *
 *   draft → posted   (via POST /journal-entries/:id/post)
 *   draft → voided   (administrative cancel while still draft)
 *   posted → reversed (via POST /journal-entries/:id/reverse)
 *
 * posted → draft, reversed → anything: FORBIDDEN (immutability invariant)
 */
const VALID_TRANSITIONS: Record<JournalEntryStatus, JournalEntryStatus[]> = {
  draft: ['posted', 'voided'],
  posted: ['reversed'],
  reversed: [],
  voided: [],
};

/**
 * Asserts that transitioning from `currentStatus` to `nextStatus` is permitted.
 *
 * @throws DomainError with code INVALID_STATUS_TRANSITION
 */
export function assertValidStatusTransition(
  currentStatus: JournalEntryStatus,
  nextStatus: JournalEntryStatus
): void {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed.includes(nextStatus)) {
    throw new DomainError(
      'INVALID_STATUS_TRANSITION',
      `Cannot transition a journal entry from "${currentStatus}" to "${nextStatus}". ` +
        `Allowed transitions from "${currentStatus}": [${allowed.join(', ') || 'none'}].`,
      { current_status: currentStatus, next_status: nextStatus }
    );
  }
}

/**
 * Asserts that a journal entry is in a state that permits reversal.
 *
 * Only `posted` entries can be reversed.
 *
 * @throws DomainError with code NOT_REVERSIBLE
 */
export function assertEntryIsReversible(
  entryId: string,
  currentStatus: JournalEntryStatus
): void {
  if (currentStatus !== 'posted') {
    throw new DomainError(
      'NOT_REVERSIBLE',
      `Journal entry "${entryId}" cannot be reversed because its status is "${currentStatus}". ` +
        `Only posted entries can be reversed.`,
      { entry_id: entryId, status: currentStatus }
    );
  }
}

/**
 * Asserts that a journal entry is in a state that permits direct editing.
 *
 * Posted entries are strictly immutable. Corrections use reversal entries.
 *
 * @throws DomainError with code ENTRY_IMMUTABLE
 */
export function assertEntryIsEditable(
  entryId: string,
  currentStatus: JournalEntryStatus
): void {
  if (currentStatus !== 'draft') {
    throw new DomainError(
      'ENTRY_IMMUTABLE',
      `Journal entry "${entryId}" cannot be edited because its status is "${currentStatus}". ` +
        `Posted entries are immutable. Corrections use reversal entries, not direct edits.`,
      { entry_id: entryId, status: currentStatus }
    );
  }
}

/**
 * Asserts that a journal entry can be cancelled/voided.
 * Only draft entries can be voided.
 *
 * @throws DomainError with code ENTRY_IMMUTABLE
 */
export function assertEntryIsVoidable(
  entryId: string,
  currentStatus: JournalEntryStatus
): void {
  if (currentStatus !== 'draft') {
    throw new DomainError(
      'ENTRY_IMMUTABLE',
      `Journal entry "${entryId}" cannot be voided because its status is "${currentStatus}". ` +
        `Only draft entries can be voided. Corrections to posted entries use reversals.`,
      { entry_id: entryId, status: currentStatus }
    );
  }
}

/**
 * Validates that setting parent_id does not create a self-reference or circular hierarchy cycle.
 *
 * @throws DomainError with code CYCLE_DETECTED
 */
export function assertNoAccountCycle(
  accountId: string,
  proposedParentId: string | null | undefined,
  getParentFn?: (id: string) => string | null | undefined
): void {
  if (!proposedParentId) return;

  if (accountId === proposedParentId) {
    throw new DomainError(
      'CYCLE_DETECTED',
      `Account "${accountId}" cannot have itself as parent_id.`,
      { account_id: accountId, proposed_parent_id: proposedParentId }
    );
  }

  if (getParentFn) {
    let current: string | null | undefined = proposedParentId;
    const visited = new Set<string>([accountId]);
    while (current) {
      if (visited.has(current)) {
        throw new DomainError(
          'CYCLE_DETECTED',
          `Circular parent hierarchy detected: account "${accountId}" is in the ancestor chain of "${proposedParentId}".`,
          { account_id: accountId, proposed_parent_id: proposedParentId }
        );
      }
      visited.add(current);
      current = getParentFn(current);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trial balance computation (FR-ERP4-03)
// ─────────────────────────────────────────────────────────────────────────────

export interface LedgerMovement {
  account_id: string;
  currency_code: string;
  debit_amount: string;
  credit_amount: string;
}

export interface OpeningBalanceInput {
  account_id: string;
  currency_code: string;
  balance_amount: string; // Signed (may be negative)
}

export interface TrialBalanceRow {
  account_id: string;
  currency_code: string;
  total_debit: string;
  total_credit: string;
  net_balance: string;
  opening_balance: string;
  closing_balance: string;
}

/**
 * Computes the trial balance from raw ledger movements and opening balances.
 *
 * Groups by (account_id, currency_code) — unlike currencies are never mixed.
 * Uses BigInt arithmetic throughout.
 *
 * @param movements - All posted journal lines for the period
 * @param openingBalances - Opening balance per account/currency (may be empty)
 * @returns Array of TrialBalanceRow (one per account+currency combination)
 */
export function computeTrialBalance(
  movements: LedgerMovement[],
  openingBalances: OpeningBalanceInput[]
): TrialBalanceRow[] {
  // Build opening balance map: "account_id|currency_code" → BigInt signed units
  const openingMap = new Map<string, bigint>();
  for (const ob of openingBalances) {
    const key = `${ob.account_id}|${ob.currency_code}`;
    // Opening balance may be signed — parse as signed
    const sign = ob.balance_amount.startsWith('-') ? -1n : 1n;
    const absStr = ob.balance_amount.replace(/^-/, '');
    openingMap.set(key, sign * parseMoneyToMinorUnits(absStr));
  }

  // Aggregate movements by (account_id, currency_code)
  const debitMap = new Map<string, bigint>();
  const creditMap = new Map<string, bigint>();

  for (const m of movements) {
    const key = `${m.account_id}|${m.currency_code}`;
    debitMap.set(key, (debitMap.get(key) ?? 0n) + parseMoneyToMinorUnits(m.debit_amount));
    creditMap.set(key, (creditMap.get(key) ?? 0n) + parseMoneyToMinorUnits(m.credit_amount));
  }

  // Build result rows
  const allKeys = new Set([...debitMap.keys(), ...creditMap.keys(), ...openingMap.keys()]);
  const rows: TrialBalanceRow[] = [];

  for (const key of allKeys) {
    const [account_id, currency_code] = key.split('|') as [string, string];
    const totalDebit = debitMap.get(key) ?? 0n;
    const totalCredit = creditMap.get(key) ?? 0n;
    const netBalance = totalDebit - totalCredit; // Signed
    const openingBalance = openingMap.get(key) ?? 0n;
    const closingBalance = openingBalance + netBalance;

    rows.push({
      account_id,
      currency_code,
      total_debit: formatMinorUnitsToMoney(totalDebit),
      total_credit: formatMinorUnitsToMoney(totalCredit),
      net_balance: formatMinorUnitsToMoney(netBalance),
      opening_balance: formatMinorUnitsToMoney(openingBalance),
      closing_balance: formatMinorUnitsToMoney(closingBalance),
    });
  }

  return rows;
}

/**
 * Computes trial balance totals (grand totals across all rows for a currency).
 * Returns is_balanced = true only when every currency group has SUM(debit) == SUM(credit).
 */
export function computeTrialBalanceTotals(rows: TrialBalanceRow[]): {
  total_debit: string;
  total_credit: string;
  difference: string;
  is_balanced: boolean;
} {
  let totalDebit = 0n;
  let totalCredit = 0n;

  for (const row of rows) {
    totalDebit += parseMoneyToMinorUnits(row.total_debit);
    totalCredit += parseMoneyToMinorUnits(row.total_credit);
  }

  const diff = totalDebit > totalCredit ? totalDebit - totalCredit : totalCredit - totalDebit;

  return {
    total_debit: formatMinorUnitsToMoney(totalDebit),
    total_credit: formatMinorUnitsToMoney(totalCredit),
    difference: formatMinorUnitsToMoney(diff),
    is_balanced: diff === 0n,
  };
}
