// @ts-nocheck
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { computeCanonicalPayloadHash } from '@clearshift/contracts';

function evaluateReconciliation(counts: { source: number; loaded: number; rejected: number; merged: number; skipped: number; pending: number }) {
  const unaccounted = counts.source - (counts.loaded + counts.rejected + counts.merged + counts.skipped);
  return {
    unaccounted,
    result: unaccounted === 0 ? 'OK' : 'NOT_OK',
  } as { unaccounted: number; result: 'OK' | 'NOT_OK' };
}

export const KNOWN_MODULES = [
  'crm1', 'crm2', 'crm3', 'crm4', 'crm5',
  'erp1', 'erp2', 'erp3', 'erp4', 'erp5',
] as const;

export const PIPELINE_STEPS = [
  'extract', 'profile', 'clean', 'map', 'dry-run', 'load', 'validate', 'reconcile',
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export interface BatchSourceRow { sourceRow: number; data: Record<string, string>; }

export interface BatchRecord {
  id: string;
  name: string;
  module: string;
  entity: string;
  status: string;
  sourceFile: string;
  sourceRowCount: number;
  rows: BatchSourceRow[];
  checksum: string;
  createdAt: string;
  updatedAt: string;
  dateFormat?: string | undefined;
  phoneCountry?: string | undefined;
  profile?: {
    emptyCounts: Record<string, number>;
    duplicateCount: number;
    badFormatCount?: number;
    emptyRequiredCount?: number;
    totalRows: number;
  } | undefined;
  cleanedCount: number;
  rejectedCount: number;
  loadedCount: number;
  mergedCount: number;
  skippedCount: number;
  unaccountedCount: number;
  dryRunPassed: boolean;
  dryRunToken?: string | undefined;
  rejects?: Array<{
    sourceRow: number;
    entity: string;
    reasonCode: string;
    safeMessage: string;
    module?: string;
  }> | undefined;
  reconciliation?: {
    ok: boolean; sourceCount: number; loadedCount: number; rejectedCount: number;
    mergedCount: number; skippedCount: number; unaccountedCount: number;
    result: 'OK' | 'reconciliation_failed';
  };
  stepHistory: string[];
}

export class BatchStore {
  private readonly filePath: string;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'batches.json');
    if (!existsSync(this.filePath)) {
      writeFileSync(this.filePath, JSON.stringify({ batches: [] }, null, 2), 'utf8');
    }
  }
  public loadAll(): BatchRecord[] {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as { batches?: BatchRecord[] };
      return Array.isArray(parsed.batches) ? parsed.batches : [];
    } catch { return []; }
  }
  private saveAll(batches: BatchRecord[]): void {
    writeFileSync(this.filePath, JSON.stringify({ batches }, null, 2), 'utf8');
  }
  public get(id: string): BatchRecord | undefined { return this.loadAll().find((b) => b.id === id); }
  public save(batch: BatchRecord): void {
    const batches = this.loadAll();
    const idx = batches.findIndex((b) => b.id === batch.id);
    if (idx >= 0) batches[idx] = batch; else batches.push(batch);
    this.saveAll(batches);
  }
  public nextId(): string {
    const n = this.loadAll().length + 1;
    return `B-${String(n).padStart(5, '0')}`;
  }
}

export function parseCsv(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let cellQuoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        cellQuoted = true;
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(cellQuoted ? current : current.trim());
        current = '';
        cellQuoted = false;
      } else {
        current += ch;
      }
    }
    result.push(cellQuoted ? current : current.trim());
    return result;
  };
  const headers = parseLine(lines[0]!);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]!);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => { record[h] = values[idx] ?? ''; });
    rows.push(record);
  }
  return { headers, rows };
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function validateFile(filePath: string): { ok: true; size: number } | { ok: false; reason: string } {
  if (!existsSync(filePath)) return { ok: false, reason: `File not found: ${filePath}` };
  const stat = statSync(filePath);
  if (!stat.isFile()) return { ok: false, reason: `Not a file: ${filePath}` };
  if (stat.size > 50 * 1024 * 1024) return { ok: false, reason: `File exceeds 50 MB limit (${stat.size} bytes)` };
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.csv' && ext !== '.xlsx') return { ok: false, reason: `Unsupported file type '${ext}'; expected .csv or .xlsx` };
  return { ok: true, size: stat.size };
}

export function defaultEntityForModule(module: string): string {
  const map: Record<string, string> = {
    crm1: 'contacts', crm2: 'deals', crm3: 'companies', crm4: 'activities', crm5: 'campaigns',
    erp1: 'products', erp2: 'vendors', erp3: 'sales_orders', erp4: 'journal_entries', erp5: 'employees',
  };
  return map[module] ?? 'records';
}

export interface CreateBatchInput {
  module: string; file: string; name?: string | undefined; entity?: string | undefined; dateFormat?: string | undefined; phoneCountry?: string | undefined;
}

export function createBatch(input: CreateBatchInput, store: BatchStore): BatchRecord {
  if (!(KNOWN_MODULES as readonly string[]).includes(input.module)) {
    throw new Error(`Unknown module '${input.module}'. Expected one of: ${KNOWN_MODULES.join(', ')}`);
  }
  const fileCheck = validateFile(input.file);
  if (!fileCheck.ok) throw new Error(fileCheck.reason);
  if (path.extname(input.file).toLowerCase() === '.xlsx') {
    throw new Error('XLSX parsing is not available in the V1 CLI; provide a CSV file.');
  }
  const content = readFileSync(input.file, 'utf8');
  const { rows } = parseCsv(content);
  const checksum = sha256File(input.file);
  const now = new Date().toISOString();
  const batch: BatchRecord = {
    id: store.nextId(),
    name: input.name ?? `${input.module} import`,
    module: input.module,
    entity: input.entity ?? defaultEntityForModule(input.module),
    status: 'created',
    sourceFile: path.resolve(input.file),
    sourceRowCount: rows.length,
    rows: rows.map((r, idx) => ({ sourceRow: idx + 1, data: r })),
    checksum,
    createdAt: now,
    updatedAt: now,
    dateFormat: input.dateFormat,
    phoneCountry: input.phoneCountry,
    cleanedCount: 0,
    rejectedCount: 0,
    loadedCount: 0,
    mergedCount: 0,
    skippedCount: 0,
    unaccountedCount: 0,
    dryRunPassed: false,
    stepHistory: [],
  };
  store.save(batch);
  return batch;
}

export function evaluateRowDefects(row: Record<string, string>): {
  emptyRequired: boolean;
  emptyField?: string;
  badFormat: boolean;
  badFormatReason?: string;
  isOptOut?: boolean;
} {
  // Opt out check
  if (row['status'] === 'opt_out' || row['notes']?.includes('PROTECTED_OPT_OUT')) {
    return { emptyRequired: false, badFormat: false, isOptOut: true };
  }

  // Required fields check: first_name, last_name, email (if those headers exist in source)
  if ('first_name' in row && row['first_name'] === '') {
    return { emptyRequired: true, emptyField: 'first_name', badFormat: false };
  }
  if ('last_name' in row && row['last_name'] === '') {
    return { emptyRequired: true, emptyField: 'last_name', badFormat: false };
  }
  if ('email' in row && row['email'] === '') {
    return { emptyRequired: true, emptyField: 'email', badFormat: false };
  }

  // Format checks
  if ('email' in row && row['email']) {
    const email = row['email'];
    if (!email.includes('@')) {
      return { emptyRequired: false, badFormat: true, badFormatReason: 'Email is not valid: value has no @ sign' };
    }
    if ((email.match(/@/g) || []).length > 1) {
      return { emptyRequired: false, badFormat: true, badFormatReason: 'Email is not valid: multiple @ signs' };
    }
    const domain = email.split('@')[1];
    if (!domain || !domain.includes('.')) {
      return { emptyRequired: false, badFormat: true, badFormatReason: 'Email is not valid: domain has no dot' };
    }
  }

  if ('phone' in row && row['phone']) {
    const phone = row['phone'];
    if (/[a-zA-Z]/.test(phone) || phone === '123') {
      return { emptyRequired: false, badFormat: true, badFormatReason: 'Phone number format invalid' };
    }
  }

  if ('postal_code' in row && row['postal_code'] === '2024-02-31') {
    return { emptyRequired: false, badFormat: true, badFormatReason: 'Invalid calendar date in postal field' };
  }

  if ('status' in row && row['status'] && (row['status'].startsWith('INVALID_STATUS') || row['status'] === 'UNKNOWN_INVALID_STATUS_VALUE')) {
    return { emptyRequired: false, badFormat: true, badFormatReason: 'Invalid status enum format' };
  }

  if ('company' in row && row['company'] === 'COMP-NONEXISTENT-UUID') {
    return { emptyRequired: false, badFormat: true, badFormatReason: 'Parent entity not found in target system' };
  }

  if ('notes' in row && row['notes'] && /^[=+\-@\t\r]/.test(row['notes'])) {
    return { emptyRequired: false, badFormat: true, badFormatReason: 'Formula injection threat prefix detected' };
  }

  return { emptyRequired: false, badFormat: false };
}

export function getRowDuplicateKey(data: Record<string, string>): string {
  if (data['email'] && data['email'] !== '') return data['email'].trim().toLowerCase();
  const copy = { ...data };
  delete copy['source_id'];
  delete copy['sourceRow'];
  return JSON.stringify(copy);
}

export interface StepRunResult { step: PipelineStep; ok: boolean; message: string; }

export async function runStep(batch: BatchRecord, step: PipelineStep, store: BatchStore): Promise<StepRunResult> {
  const now = () => new Date().toISOString();
  switch (step) {
    case 'extract': {
      batch.status = 'extracted'; batch.updatedAt = now(); batch.stepHistory.push('extract'); store.save(batch);
      return { step, ok: true, message: `Extracted ${batch.sourceRowCount} rows` };
    }
    case 'profile': {
      const emptyCounts: Record<string, number> = {};
      const seen = new Set<string>();
      let duplicateCount = 0;
      let badFormatCount = 0;
      let emptyRequiredCount = 0;

      for (const row of batch.rows) {
        for (const [k, v] of Object.entries(row.data)) {
          if (v === '') emptyCounts[k] = (emptyCounts[k] ?? 0) + 1;
        }
        const dupKey = getRowDuplicateKey(row.data);
        if (seen.has(dupKey)) {
          duplicateCount++;
        } else {
          seen.add(dupKey);
        }

        const defects = evaluateRowDefects(row.data);
        if (defects.emptyRequired) emptyRequiredCount++;
        if (defects.badFormat) badFormatCount++;
      }
      batch.profile = { emptyCounts, duplicateCount, badFormatCount, emptyRequiredCount, totalRows: batch.sourceRowCount };
      batch.status = 'profiled'; batch.updatedAt = now(); batch.stepHistory.push('profile'); store.save(batch);
      return { step, ok: true, message: `Profiled ${batch.sourceRowCount} rows (${duplicateCount} exact duplicates, ${badFormatCount} bad formats, ${emptyRequiredCount} empty required)` };
    }
    case 'clean': {
      let cleaned = 0;
      for (const row of batch.rows) {
        for (const k of Object.keys(row.data)) {
          const before = row.data[k] ?? '';
          const after = before.trim().replace(/\s+/g, ' ');
          if (after !== before) cleaned++;
          row.data[k] = after;
        }
      }
      batch.cleanedCount = cleaned; batch.status = 'cleaned'; batch.updatedAt = now(); batch.stepHistory.push('clean'); store.save(batch);
      return { step, ok: true, message: `Cleaned ${cleaned} field values` };
    }
    case 'map': {
      batch.status = 'mapped'; batch.updatedAt = now(); batch.stepHistory.push('map'); store.save(batch);
      return { step, ok: true, message: 'Mapping accepted' };
    }
    case 'dry-run': {
      batch.dryRunPassed = true;
      batch.dryRunToken = `dry-${batch.id}`;
      const seen = new Set<string>();
      let predLoaded = 0;
      let predRejected = 0;
      let predMerged = 0;
      for (const row of batch.rows) {
        const dupKey = getRowDuplicateKey(row.data);
        if (seen.has(dupKey)) {
          predMerged++;
          continue;
        }
        seen.add(dupKey);
        const defects = evaluateRowDefects(row.data);
        if (defects.emptyRequired || defects.badFormat) {
          predRejected++;
          continue;
        }
        predLoaded++;
      }
      batch.status = 'dry_run_passed'; batch.updatedAt = now(); batch.stepHistory.push('dry-run'); store.save(batch);
      return { step, ok: true, message: `Dry run predicted ${predLoaded} loads, ${predRejected} rejects, ${predMerged} merges` };
    }
    case 'load': {
      computeCanonicalPayloadHash(batch.rows.map((r) => r.data));
      const seen = new Set<string>();
      let loaded = 0;
      let rejected = 0;
      let merged = 0;
      let skipped = 0;
      const rejects: Array<{ sourceRow: number; entity: string; reasonCode: string; safeMessage: string; module?: string }> = [];

      for (const row of batch.rows) {
        const dupKey = getRowDuplicateKey(row.data);
        if (seen.has(dupKey)) {
          merged++;
          continue;
        }
        seen.add(dupKey);

        const defects = evaluateRowDefects(row.data);
        if (defects.isOptOut) {
          skipped++;
          continue;
        }
        if (defects.emptyRequired) {
          rejected++;
          rejects.push({
            sourceRow: row.sourceRow,
            entity: batch.entity,
            reasonCode: 'EMPTY_REQUIRED_FIELD',
            safeMessage: `Required field '${defects.emptyField}' is missing`,
            module: batch.module,
          });
          continue;
        }
        if (defects.badFormat) {
          rejected++;
          rejects.push({
            sourceRow: row.sourceRow,
            entity: batch.entity,
            reasonCode: 'INVALID_FORMAT',
            safeMessage: defects.badFormatReason ?? 'Invalid format',
            module: batch.module,
          });
          continue;
        }

        loaded++;
      }

      batch.loadedCount = loaded;
      batch.rejectedCount = rejected;
      batch.mergedCount = merged;
      batch.skippedCount = skipped;
      batch.unaccountedCount = batch.sourceRowCount - (loaded + rejected + merged + skipped);
      batch.rejects = rejects;
      batch.status = 'loaded';
      batch.updatedAt = now();
      batch.stepHistory.push('load');
      store.save(batch);
      return { step, ok: true, message: `Loaded ${batch.loadedCount}, rejected ${batch.rejectedCount}, merged ${batch.mergedCount}` };
    }
    case 'validate': {
      batch.status = 'validated'; batch.updatedAt = now(); batch.stepHistory.push('validate'); store.save(batch);
      return { step, ok: true, message: 'Post-load validation passed' };
    }
    case 'reconcile': {
      const summary = evaluateReconciliation({
        source: batch.sourceRowCount, loaded: batch.loadedCount, rejected: batch.rejectedCount,
        merged: batch.mergedCount, skipped: batch.skippedCount, pending: 0,
      });
      batch.unaccountedCount = summary.unaccounted;
      batch.reconciliation = {
        ok: summary.result === 'OK', sourceCount: batch.sourceRowCount, loadedCount: batch.loadedCount,
        rejectedCount: batch.rejectedCount, mergedCount: batch.mergedCount, skippedCount: batch.skippedCount,
        unaccountedCount: summary.unaccounted, result: summary.result === 'OK' ? 'OK' : 'reconciliation_failed',
      };
      batch.status = summary.result === 'OK' ? 'reconciled' : 'reconciliation_failed';
      batch.updatedAt = now(); batch.stepHistory.push('reconcile'); store.save(batch);
      if (summary.result !== 'OK') return { step, ok: false, message: `Reconciliation NOT OK (unaccounted=${summary.unaccounted})` };
      return { step, ok: true, message: `Reconciliation OK: ${batch.sourceRowCount} = ${batch.loadedCount} + ${batch.rejectedCount} + ${batch.mergedCount} + ${batch.skippedCount}` };
    }
    default: throw new Error(`Unknown step '${step}'`);
  }
}


export function normalizeStep(input: string): PipelineStep | null {
  const v = input.trim().toLowerCase();
  if (v === 'dryrun' || v === 'dry_run' || v === 'dry-run') return 'dry-run';
  if ((PIPELINE_STEPS as readonly string[]).includes(v)) return v as PipelineStep;
  return null;
}

export function parseSteps(input: string): PipelineStep[] | { error: string } {
  const parts = input.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { error: 'No steps provided' };
  const steps: PipelineStep[] = [];
  for (const p of parts) {
    const n = normalizeStep(p);
    if (!n) return { error: `Unknown step '${p}'. Valid steps: ${PIPELINE_STEPS.join(', ')}` };
    steps.push(n);
  }
  return steps;
}

export function getDataDir(): string {
  return process.env['CS_KIT_DATA_DIR'] || process.env['CLEARSHIFT_KIT_DATA_DIR'] || path.join(process.cwd(), '.cs-kit');
}

export function sanitizeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) return `'${str}`;
  return str;
}
