/**
 * ERP-3 Sales Orders & Invoices — Reconciliation Proof (ERP3-30 / Gate G4).
 *
 * Runs the committed dirty-data pack through the existing deterministic evaluator and proves:
 *   - every source row receives exactly ONE terminal outcome: loaded | rejected | merged | skipped
 *   - source = loaded + rejected + merged + skipped, unaccounted = 0 (via the shared kit equation)
 *   - parent/child link integrity across loaded rows:
 *       • sales_order -> customer (Golden ID)
 *       • so_line -> sales_order (loaded) & product (ERP-1 catalog)
 *       • invoice -> sales_order (loaded) & customer (Golden ID)
 *       • invoice_line -> invoice (loaded) & product (ERP-1 catalog)
 *       • payment -> invoice (loaded)
 *   - durable import receipts are complete and uncorrupted (one per loaded row, none for others)
 *
 * No fuzzy matching and no automatic merge: `review` rows are held (skipped) unless an explicit,
 * audited merge decision names the row AND its reasons are exact-duplicate reasons only.
 *
 * @module erp3/migration/reconciliation
 */

import { evaluateReconciliation } from '@cs/kit';
import {
  FIXTURE_PATH,
  KNOWN_CUSTOMERS,
  KNOWN_PRODUCTS,
  evaluateDataset,
  readRawRows,
  sha256Hex,
  type RawRow,
  type RowEvaluation,
} from './rules.js';

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

export interface LinkViolation {
  row_id: string;
  check:
    | 'SO_CUSTOMER_UNKNOWN'
    | 'LINE_SO_NOT_LOADED'
    | 'LINE_PRODUCT_UNKNOWN'
    | 'INVOICE_SO_NOT_LOADED'
    | 'INVOICE_CUSTOMER_UNKNOWN'
    | 'INVOICE_LINE_INV_NOT_LOADED'
    | 'INVOICE_LINE_PRODUCT_UNKNOWN'
    | 'PAYMENT_INV_NOT_LOADED';
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

const emptyCounts = (): Counts => ({ source: 0, loaded: 0, rejected: 0, merged: 0, skipped: 0 });

/** Maps the evaluator outcome to the kit's terminal vocabulary. */
export function toTerminal(row: RowEvaluation, options?: ReconOptions): ReconTerminalOutcome {
  switch (row.outcome) {
    case 'accepted':
      return 'loaded';
    case 'rejected':
      return 'rejected';
    case 'skipped':
      return 'skipped';
    case 'review': {
      const onlyDuplicates =
        row.reasons.length > 0 && row.reasons.every((r) => r.startsWith('DUPLICATE_'));
      return onlyDuplicates && options?.mergeDecisions?.has(row.row_id) ? 'merged' : 'skipped';
    }
  }
}

export function toTerminalRows(
  evaluated: readonly RowEvaluation[],
  options?: ReconOptions,
): TerminalRow[] {
  return evaluated.map((row) => ({
    row_id: row.row_id,
    record_type: row.record_type,
    outcome: toTerminal(row, options),
    reasons: [...row.reasons],
  }));
}

export function countOutcomes(rows: readonly TerminalRow[]): {
  total: Counts;
  byType: Record<string, Counts>;
} {
  const total = emptyCounts();
  const byType: Record<string, Counts> = {};
  for (const row of rows) {
    const bucket = (byType[row.record_type] ??= emptyCounts());
    for (const c of [total, bucket]) {
      c.source += 1;
      c[row.outcome] += 1;
    }
  }
  return { total, byType };
}

/** Link integrity over LOADED rows only. `rawRows` and `terminal` are index-aligned. */
export function checkLinkIntegrity(
  rawRows: readonly RawRow[],
  terminal: readonly TerminalRow[],
): LinkViolation[] {
  const loaded = (i: number): boolean => terminal[i]?.outcome === 'loaded';
  const orders = new Set<string>();
  const invoices = new Set<string>();

  rawRows.forEach((r, i) => {
    if (!loaded(i)) return;
    const type = r.record_type.trim();
    if (type === 'sales_order' && r.source_id.trim()) {
      orders.add(r.source_id.trim());
    } else if (type === 'invoice' && r.source_id.trim()) {
      invoices.add(r.source_id.trim());
    }
  });

  const validCustomers = new Set<string>(KNOWN_CUSTOMERS);
  const validProducts = new Set<string>(KNOWN_PRODUCTS);
  const violations: LinkViolation[] = [];

  rawRows.forEach((r, i) => {
    if (!loaded(i)) return;
    const type = r.record_type.trim();

    if (type === 'sales_order') {
      const cust = r.customer_golden_id.trim();
      if (!validCustomers.has(cust)) {
        violations.push({ row_id: r.row_id, check: 'SO_CUSTOMER_UNKNOWN', detail: cust });
      }
    } else if (type === 'so_line') {
      const parentSo = r.parent_source_id.trim();
      const prod = r.product_id.trim();
      if (!orders.has(parentSo)) {
        violations.push({ row_id: r.row_id, check: 'LINE_SO_NOT_LOADED', detail: parentSo });
      }
      if (!validProducts.has(prod)) {
        violations.push({ row_id: r.row_id, check: 'LINE_PRODUCT_UNKNOWN', detail: prod });
      }
    } else if (type === 'invoice') {
      const parentSo = r.parent_source_id.trim();
      const cust = r.customer_golden_id.trim();
      if (parentSo && !orders.has(parentSo)) {
        violations.push({ row_id: r.row_id, check: 'INVOICE_SO_NOT_LOADED', detail: parentSo });
      }
      if (cust && !validCustomers.has(cust)) {
        violations.push({ row_id: r.row_id, check: 'INVOICE_CUSTOMER_UNKNOWN', detail: cust });
      }
    } else if (type === 'invoice_line') {
      const parentInv = r.parent_source_id.trim();
      const prod = r.product_id.trim();
      if (!invoices.has(parentInv)) {
        violations.push({
          row_id: r.row_id,
          check: 'INVOICE_LINE_INV_NOT_LOADED',
          detail: parentInv,
        });
      }
      if (prod && !validProducts.has(prod)) {
        violations.push({
          row_id: r.row_id,
          check: 'INVOICE_LINE_PRODUCT_UNKNOWN',
          detail: prod,
        });
      }
    } else if (type === 'payment') {
      const parentInv = r.parent_source_id.trim();
      if (!invoices.has(parentInv)) {
        violations.push({
          row_id: r.row_id,
          check: 'PAYMENT_INV_NOT_LOADED',
          detail: parentInv,
        });
      }
    }
  });

  return violations;
}

/** One receipt per loaded row, none for any other outcome, unique keys, non-empty fields. */
export function verifyReceipts(
  terminal: readonly TerminalRow[],
  receipts: readonly ImportReceiptLike[],
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

export function buildReconciliationReport(
  csvText: string,
  options?: ReconOptions,
): ReconciliationReport {
  const raw = readRawRows(csvText);
  const evaluated = evaluateDataset(raw);
  const rows = toTerminalRows(evaluated.rowResults, options);
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
