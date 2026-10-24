export type BatchStatus =
  | 'created'
  | 'profiled'
  | 'cleaned'
  | 'mapped'
  | 'dry_run_passed'
  | 'loaded'
  | 'validated'
  | 'reconciled'
  | 'failed'
  | 'stopped';

export interface MigrationBatch {
  id: string;
  name: string;
  module: string;
  entity: string;
  status: BatchStatus;
  sourceRowCount: number;
  createdAt: string;
  dryRunPassed: boolean;
  dryRunStale: boolean;
}

export interface ProfileReport {
  readonly batchId: string;
  readonly totalRows: number;
  readonly emptyCounts: Record<string, number>;
  readonly duplicateCount: number;
  readonly columns: readonly { name: string; inferredType: string; emptyCount: number }[];
}

export interface MappingRule {
  readonly targetField: string;
  readonly sourceColumn: string | null;
  readonly required: boolean;
  readonly compatible: boolean;
}

export interface DuplicateCandidate {
  readonly id: string;
  readonly sourceRow: number;
  readonly key: string;
  readonly existingId: string;
}

export interface RunResult {
  readonly batchId: string;
  readonly loaded: number;
  readonly rejected: number;
  readonly merged: number;
  readonly skipped: number;
  readonly source: number;
  readonly unaccounted: number;
}

export interface ReconciliationReport extends RunResult {
  readonly ok: boolean;
}

export interface RejectRow {
  readonly sourceRow: number;
  readonly reason: string;
  readonly ruleId: string;
}

export interface RejectListPageResult {
  readonly rows: readonly RejectRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

const batches: MigrationBatch[] = [
  {
    id: 'batch-001',
    name: 'ERP-1 Products Import',
    module: 'erp1',
    entity: 'products',
    status: 'created',
    sourceRowCount: 100,
    createdAt: '2026-01-01T00:00:00Z',
    dryRunPassed: false,
    dryRunStale: false,
  },
];

let currentDryRun: { batchId: string; passed: boolean; timestamp: number } | null = null;

export async function fetchBatches(): Promise<MigrationBatch[]> {
  return batches;
}

export async function fetchBatch(id: string): Promise<MigrationBatch | null> {
  return batches.find((b) => b.id === id) ?? null;
}

export async function createBatch(input: { name: string; module: string; entity: string }): Promise<MigrationBatch> {
  const b: MigrationBatch = {
    id: `batch-${batches.length + 1}`,
    name: input.name,
    module: input.module,
    entity: input.entity,
    status: 'created',
    sourceRowCount: 0,
    createdAt: new Date().toISOString(),
    dryRunPassed: false,
    dryRunStale: false,
  };
  batches.push(b);
  return b;
}

export async function fetchProfile(batchId: string): Promise<ProfileReport> {
  return {
    batchId,
    totalRows: 100,
    emptyCounts: { sku: 2 },
    duplicateCount: 5,
    columns: [
      { name: 'sku', inferredType: 'string', emptyCount: 0 },
      { name: 'name', inferredType: 'string', emptyCount: 1 },
    ],
  };
}

export async function fetchMapping(batchId: string): Promise<readonly MappingRule[]> {
  return [
    { targetField: 'sku', sourceColumn: 'sku_code', required: true, compatible: true },
    { targetField: 'name', sourceColumn: 'product_name', required: true, compatible: true },
  ];
}

export async function saveMapping(batchId: string, rules: readonly MappingRule[]): Promise<void> {
  void batchId;
  void rules;
}

export async function fetchDuplicates(batchId: string): Promise<readonly DuplicateCandidate[]> {
  return [
    { id: 'dup-1', sourceRow: 5, key: 'SKU-001', existingId: 'prod-1' },
  ];
}

export async function resolveDuplicate(id: string, decision: 'merge' | 'skip' | 'create'): Promise<void> {
  void id;
  void decision;
}

export async function runDryRun(batchId: string): Promise<{ validCount: number; rejectCount: number; passed: boolean }> {
  currentDryRun = { batchId, passed: true, timestamp: Date.now() };
  const b = batches.find((x) => x.id === batchId);
  if (b) {
    b.dryRunPassed = true;
    b.dryRunStale = false;
    b.status = 'dry_run_passed';
  }
  return { validCount: 95, rejectCount: 5, passed: true };
}

export function isDryRunStale(batchId: string): boolean {
  // stale if mapping changed after dry run; for mock always false unless marked
  const b = batches.find((x) => x.id === batchId);
  return b?.dryRunStale ?? false;
}

export async function runLoad(batchId: string): Promise<RunResult> {
  const b = batches.find((x) => x.id === batchId);
  if (!b?.dryRunPassed || b.dryRunStale) {
    throw new Error('Dry run required or stale');
  }
  const result: RunResult = {
    batchId,
    source: 100,
    loaded: 90,
    rejected: 5,
    merged: 3,
    skipped: 2,
    unaccounted: 0,
  };
  if (b) b.status = 'loaded';
  return result;
}

export async function fetchRunResult(batchId: string): Promise<RunResult> {
  return {
    batchId,
    source: 100,
    loaded: 90,
    rejected: 5,
    merged: 3,
    skipped: 2,
    unaccounted: 0,
  };
}

export async function fetchReconciliation(batchId: string): Promise<ReconciliationReport> {
  const r = await fetchRunResult(batchId);
  return { ...r, ok: r.source === r.loaded + r.rejected + r.merged + r.skipped && r.unaccounted === 0 };
}

export async function fetchRejects(batchId: string, page = 1, pageSize = 25): Promise<RejectListPageResult> {
  const rows: RejectRow[] = Array.from({ length: 5 }, (_, i) => ({
    sourceRow: i + 1,
    reason: 'Missing required field',
    ruleId: 'REQ-001',
  }));
  return { rows, total: rows.length, page, pageSize };
}

import {
  exportProfileReportCsv,
  exportRejectReportCsv,
  exportReconciliationReportCsv,
} from '../../../src/reports/index.js';

export async function exportProfileCsv(batchId: string): Promise<string> {
  const profile = await fetchProfile(batchId);
  const recon = await fetchReconciliation(batchId);
  return exportProfileReportCsv({
    batchId: profile.batchId,
    module: 'erp1',
    entity: 'products',
    totalRows: profile.totalRows,
    duplicateCount: profile.duplicateCount,
    columns: profile.columns,
    counts: {
      sourceCount: recon.source,
      loadedCount: recon.loaded,
      rejectedCount: recon.rejected,
      mergedCount: recon.merged,
      skippedCount: recon.skipped,
      unaccountedCount: recon.unaccounted,
      formulaHolds: recon.ok,
    },
  });
}

export const exportProfileReportCsvExport = exportProfileCsv;

export async function exportReconciliationCsv(batchId: string): Promise<string> {
  const recon = await fetchReconciliation(batchId);
  return exportReconciliationReportCsv({
    batchId: recon.batchId,
    sourceCount: recon.source,
    loadedCount: recon.loaded,
    rejectedCount: recon.rejected,
    mergedCount: recon.merged,
    skippedCount: recon.skipped,
    unaccountedCount: recon.unaccounted,
    formulaHolds: recon.ok,
    result: recon.ok ? 'OK' : 'reconciliation_failed',
    signoffAllowed: recon.ok,
  });
}

export const exportReconciliationReportCsvExport = exportReconciliationCsv;

export async function exportRejectsCsv(batchId: string): Promise<string> {
  const res = await fetchRejects(batchId, 1, 1000);
  const recon = await fetchReconciliation(batchId);
  return exportRejectReportCsv({
    batchId,
    module: 'erp1',
    entity: 'products',
    rows: res.rows.map((r) => ({
      sourceRow: r.sourceRow,
      reasonCode: r.ruleId,
      safeMessage: r.reason,
      ruleId: r.ruleId,
    })),
    counts: {
      sourceCount: recon.source,
      loadedCount: recon.loaded,
      rejectedCount: recon.rejected,
      mergedCount: recon.merged,
      skippedCount: recon.skipped,
      unaccountedCount: recon.unaccounted,
      formulaHolds: recon.ok,
    },
    pagination: {
      page: res.page,
      pageSize: res.pageSize,
      total: res.total,
    },
  });
}

export const exportRejectReportCsvExport = exportRejectsCsv;

export function canPerformTransition(status: BatchStatus, action: string, roles: string[]): boolean {
  const isAdmin = roles.includes('admin') || roles.includes('operator') || roles.includes('migration_operator');
  if (!isAdmin) return false;
  if (action === 'load') return status === 'dry_run_passed';
  if (action === 'dry_run') return status === 'mapped' || status === 'cleaned' || status === 'profiled' || status === 'created';
  return true;
}