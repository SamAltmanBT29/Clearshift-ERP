/**
 * ERP-2 Vendors & Purchasing — Reconciliation Proof (ERP2-30 / Gate G4).
 *
 * Runs the committed dirty-data pack through the existing deterministic evaluator and proves:
 *   - every source row receives exactly ONE terminal outcome: loaded | rejected | merged | skipped
 *   - source = loaded + rejected + merged + skipped, unaccounted = 0 (via the shared kit equation)
 *   - parent/child link integrity (PO -> vendor, line -> PO, line -> ERP-1 SKU) across loaded rows
 *   - durable import receipts are complete and uncorrupted (one per loaded row, none for others)
 *
 * No fuzzy matching and no automatic merge: `review` rows are held (skipped) unless an explicit,
 * audited merge decision names the row AND its reasons are exact-duplicate reasons only.
 *
 * @module erp2/migration/reconciliation
 */

import { evaluateReconciliation } from '@cs/kit';
import {
  ERP1_REFERENCE_SKUS,
  FIXTURE_PATH,
  evaluateDataset,
  normalizeCode,
  normalizePoNumber,
  normalizeSku,
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

export interface LinkViolation {
  row_id: string;
  check: 'PO_VENDOR_NOT_LOADED' | 'LINE_PO_NOT_LOADED' | 'LINE_SKU_UNKNOWN';
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
    const bucket = (byType[row.record_type] ??= emptyCounts());
    for (const c of [total, bucket]) {
      c.source += 1;
      c[row.outcome] += 1;
    }
  }
  return { total, byType };
}

/** Link integrity over LOADED rows only. `rawRows` and `terminal` are index-aligned. */
export function checkLinkIntegrity(rawRows: RawRow[], terminal: TerminalRow[]): LinkViolation[] {
  const loaded = (i: number): boolean => terminal[i]?.outcome === 'loaded';
  const vendors = new Set<string>();
  const orders = new Set<string>();
  rawRows.forEach((r, i) => {
    if (!loaded(i)) return;
    if (r.record_type.trim() === 'vendor') vendors.add(normalizeCode(r.vendor_code));
    if (r.record_type.trim() === 'purchase_order') orders.add(normalizePoNumber(r.po_number));
  });

  const skus = new Set<string>(ERP1_REFERENCE_SKUS);
  const violations: LinkViolation[] = [];
  rawRows.forEach((r, i) => {
    if (!loaded(i)) return;
    const type = r.record_type.trim();
    if (type === 'purchase_order') {
      const code = normalizeCode(r.po_vendor_code);
      if (!vendors.has(code)) {
        violations.push({ row_id: r.row_id, check: 'PO_VENDOR_NOT_LOADED', detail: code });
      }
    } else if (type === 'po_line') {
      const po = normalizePoNumber(r.po_number);
      const sku = normalizeSku(r.product_sku);
      if (!orders.has(po)) {
        violations.push({ row_id: r.row_id, check: 'LINE_PO_NOT_LOADED', detail: po });
      }
      if (!skus.has(sku)) {
        violations.push({ row_id: r.row_id, check: 'LINE_SKU_UNKNOWN', detail: sku });
      }
    }
  });
  return violations;
}

/** One receipt per loaded row, none for any other outcome, unique keys, non-empty fields. */
export function verifyReceipts(
  terminal: TerminalRow[],
  receipts: ImportReceiptLike[],
): ReceiptVerification {
  const loadedIds = new Set(terminal.filter((t) => t.outcome === 'loaded').map((t) => t.row_id));
  const seenRows = new Map<string, number>();
  const seenKeys = new Map<string, number>();
  const malformed: string[] = [];

  for (const r of receipts) {
    seenRows.set(r.row_id, (seenRows.get(r.row_id) ?? 0) + 1);
    seenKeys.set(r.idempotency_key, (seenKeys.get(r.idempotency_key) ?? 0) + 1);
    if (!r.row_id || !r.idempotency_key.trim() || !r.target_id.trim()) malformed.push(r.row_id);
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
