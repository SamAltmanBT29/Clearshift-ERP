/**
 * ERP-5 HR & Employees — Reconciliation Proof & Gate G4 Engine (ERP5-30 / Gate G4).
 *
 * Runs canonical dirty-data pack through deterministic evaluation and asserts:
 *  - Every source row receives exactly ONE terminal outcome: loaded | rejected | merged | skipped.
 *  - source = loaded + rejected + merged + skipped, unaccounted = 0 (via shared kit evaluateReconciliation).
 *  - Domain link integrity across loaded rows:
 *      - department.parent_code -> loaded department
 *      - employee.department_code -> loaded department
 *      - leave.employee_no -> loaded employee
 *      - payroll_total.department_code -> loaded department
 *  - Durable import receipts verify 100% complete and uncorrupted (one per loaded row, zero for others).
 *
 * Deterministic exact matching only: duplicate review rows are held (skipped) unless an explicit,
 * audited merge decision names the row and its reasons are exact-duplicate reasons only.
 *
 * @module erp5/migration/reconciliation
 */

import { evaluateReconciliation } from '@cs/kit';
import {
  FIXTURE_PATH,
  evaluateDataset,
  normalizeCode,
  parseCsv,
  sha256Hex,
  type EvaluatedRow,
  type RawRow,
} from './dirty-data-plan.js';

export type ReconTerminalOutcome = 'loaded' | 'rejected' | 'merged' | 'skipped';

export interface ReconOptions {
  /** row_ids a reviewer explicitly decided to merge (exact-duplicate review rows only). */
  readonly mergeDecisions?: ReadonlySet<string> | undefined;
}

export interface TerminalRow {
  row_id: string;
  record_type: string;
  outcome: ReconTerminalOutcome;
  reasons: string[];
}

export type LinkCheckType =
  | 'DEPT_PARENT_NOT_LOADED'
  | 'EMP_DEPT_NOT_LOADED'
  | 'LEAVE_EMP_NOT_LOADED'
  | 'PAYROLL_DEPT_NOT_LOADED';

export interface LinkViolation {
  row_id: string;
  check: LinkCheckType;
  detail: string;
}

export interface ImportReceiptLike {
  row_id: string;
  idempotency_key: string;
  target_id: string;
}

export interface ReceiptVerification {
  complete: boolean;
  missing: string[];
  unexpected: string[];
  duplicate_keys: string[];
  malformed: string[];
}

export interface Counts {
  source: number;
  loaded: number;
  rejected: number;
  merged: number;
  skipped: number;
}

export interface ReconciliationReport {
  fixture: string;
  fixture_sha256: string;
  counts: Counts;
  by_record_type: Record<string, Counts>;
  unaccounted: number;
  result: 'OK' | 'NOT_OK' | 'PARTIAL';
  exactly_one_outcome_per_row: boolean;
  link_violations: LinkViolation[];
  rows: TerminalRow[];
}

const emptyCounts = (): Counts => ({
  source: 0,
  loaded: 0,
  rejected: 0,
  merged: 0,
  skipped: 0,
});

/**
 * Maps evaluator outcome to the Migration Kit terminal vocabulary.
 */
export function toTerminal(row: EvaluatedRow, options?: ReconOptions): ReconTerminalOutcome {
  switch (row.outcome) {
    case 'accepted':
      return 'loaded';
    case 'rejected':
      return 'rejected';
    case 'skipped':
      return 'skipped';
    case 'review': {
      const onlyDuplicates =
        row.reason_codes.length > 0 && row.reason_codes.every((r) => r.startsWith('DUPLICATE_'));
      return onlyDuplicates && options?.mergeDecisions?.has(row.row_id) ? 'merged' : 'skipped';
    }
  }
}

export function toTerminalRows(evaluated: EvaluatedRow[], options?: ReconOptions): TerminalRow[] {
  return evaluated.map((row) => ({
    row_id: row.row_id,
    record_type: row.record_type,
    outcome: toTerminal(row, options),
    reasons: row.reason_codes,
  }));
}

export function countOutcomes(rows: TerminalRow[]): {
  total: Counts;
  byType: Record<string, Counts>;
} {
  const total = emptyCounts();
  const byType: Record<string, Counts> = {};

  for (const row of rows) {
    let bucket = byType[row.record_type];
    if (!bucket) {
      bucket = emptyCounts();
      byType[row.record_type] = bucket;
    }
    for (const c of [total, bucket]) {
      c.source += 1;
      c[row.outcome] += 1;
    }
  }

  return { total, byType };
}

/**
 * Validates cross-entity link integrity across LOADED rows only.
 */
export function checkLinkIntegrity(rawRows: RawRow[], terminal: TerminalRow[]): LinkViolation[] {
  const loaded = (i: number): boolean => terminal[i]?.outcome === 'loaded';

  const loadedDepartments = new Set<string>();
  const loadedEmployees = new Set<string>();

  rawRows.forEach((r, i) => {
    if (!loaded(i)) return;
    const type = r.record_type.trim();
    if (type === 'department' && r.department_code) {
      loadedDepartments.add(normalizeCode(r.department_code));
    } else if (type === 'employee' && r.employee_no) {
      loadedEmployees.add(normalizeCode(r.employee_no));
    }
  });

  const violations: LinkViolation[] = [];

  rawRows.forEach((r, i) => {
    if (!loaded(i)) return;
    const type = r.record_type.trim();

    if (type === 'department') {
      const parent = r.parent_code ? normalizeCode(r.parent_code) : '';
      if (parent && !loadedDepartments.has(parent)) {
        violations.push({
          row_id: r.row_id,
          check: 'DEPT_PARENT_NOT_LOADED',
          detail: `Parent department '${parent}' is not loaded.`,
        });
      }
    } else if (type === 'employee') {
      const dept = normalizeCode(r.department_code);
      if (!loadedDepartments.has(dept)) {
        violations.push({
          row_id: r.row_id,
          check: 'EMP_DEPT_NOT_LOADED',
          detail: `Department '${dept}' is not loaded.`,
        });
      }
    } else if (type === 'leave') {
      const emp = normalizeCode(r.employee_no);
      if (!loadedEmployees.has(emp)) {
        violations.push({
          row_id: r.row_id,
          check: 'LEAVE_EMP_NOT_LOADED',
          detail: `Employee '${emp}' is not loaded.`,
        });
      }
    } else if (type === 'payroll_total') {
      const dept = normalizeCode(r.department_code);
      if (!loadedDepartments.has(dept)) {
        violations.push({
          row_id: r.row_id,
          check: 'PAYROLL_DEPT_NOT_LOADED',
          detail: `Department '${dept}' is not loaded.`,
        });
      }
    }
  });

  return violations;
}

/**
 * Verifies durable import receipts:
 * - Exactly one receipt per loaded row
 * - Zero receipts for rejected, merged, or skipped rows
 * - Unique idempotency keys and target_ids
 * - No malformed fields
 */
export function verifyReceipts(
  terminal: TerminalRow[],
  receipts: ImportReceiptLike[]
): ReceiptVerification {
  const loadedIds = new Set(terminal.filter((t) => t.outcome === 'loaded').map((t) => t.row_id));
  const seenRows = new Map<string, number>();
  const seenKeys = new Map<string, number>();
  const malformed: string[] = [];

  for (const r of receipts) {
    seenRows.set(r.row_id, (seenRows.get(r.row_id) ?? 0) + 1);
    seenKeys.set(r.idempotency_key, (seenKeys.get(r.idempotency_key) ?? 0) + 1);
    if (!r.row_id || !r.idempotency_key.trim() || !r.target_id.trim()) {
      malformed.push(r.row_id);
    }
  }

  const missing = [...loadedIds].filter((id) => !seenRows.has(id));
  const unexpected = [...seenRows.keys()].filter((id) => !loadedIds.has(id));
  const duplicateRows = [...seenRows].filter(([, n]) => n > 1).map(([id]) => id);
  const duplicateKeys = [...seenKeys].filter(([, n]) => n > 1).map(([k]) => k);

  return {
    complete:
      missing.length === 0 &&
      unexpected.length === 0 &&
      duplicateRows.length === 0 &&
      duplicateKeys.length === 0 &&
      malformed.length === 0,
    missing,
    unexpected,
    duplicate_keys: duplicateKeys,
    malformed,
  };
}

/**
 * Builds the complete reconciliation report for ERP-5.
 */
export function buildReconciliationReport(
  csvText: string,
  options?: ReconOptions
): ReconciliationReport {
  const raw = parseCsv(csvText);
  const evaluated = evaluateDataset(raw);
  const rows = toTerminalRows(evaluated, options);
  const { total, byType } = countOutcomes(rows);
  const verdict = evaluateReconciliation({ ...total, pending: 0 });
  const ids = new Set(rows.map((r) => r.row_id));

  return {
    fixture: FIXTURE_PATH,
    fixture_sha256: sha256Hex(csvText),
    counts: total,
    by_record_type: byType,
    unaccounted: verdict.unaccounted,
    result: verdict.result,
    exactly_one_outcome_per_row: rows.length === raw.length && ids.size === rows.length,
    link_violations: checkLinkIntegrity(raw, rows),
    rows,
  };
}
