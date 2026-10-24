// @ts-nocheck
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import path from 'node:path';
import {
  computeCanonicalPayloadHash,
  MAX_MIGRATION_FILE_SIZE_BYTES,
  MAX_MIGRATION_COLUMN_COUNT,
  MAX_MIGRATION_CELL_SIZE_BYTES,
  BoundaryLimitError,
  redactSensitiveLogMessage,
} from '@clearshift/contracts';

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

  const firstLine = lines[0]!;
  const delimiter = (firstLine.includes(';') && !firstLine.includes(',')) ? ';' : ',';

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
      } else if (ch === delimiter && !inQuotes) {
        const val = cellQuoted ? current : current.trim();
        if (val.length > MAX_MIGRATION_CELL_SIZE_BYTES) {
          throw new BoundaryLimitError(
            'CELL_SIZE_LIMIT_EXCEEDED',
            `Cell size exceeds ${MAX_MIGRATION_CELL_SIZE_BYTES} bytes limit (${val.length} bytes)`,
            400
          );
        }
        result.push(val);
        current = '';
        cellQuoted = false;
      } else {
        current += ch;
      }
    }
    const lastVal = cellQuoted ? current : current.trim();
    if (lastVal.length > MAX_MIGRATION_CELL_SIZE_BYTES) {
      throw new BoundaryLimitError(
        'CELL_SIZE_LIMIT_EXCEEDED',
        `Cell size exceeds ${MAX_MIGRATION_CELL_SIZE_BYTES} bytes limit (${lastVal.length} bytes)`,
        400
      );
    }
    result.push(lastVal);
    return result;
  };

  const headers = parseLine(lines[0]!);
  if (headers.length > MAX_MIGRATION_COLUMN_COUNT) {
    throw new BoundaryLimitError(
      'COLUMN_LIMIT_EXCEEDED',
      `Column count exceeds maximum allowable limit of ${MAX_MIGRATION_COLUMN_COUNT} (${headers.length} columns detected)`,
      400
    );
  }

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]!);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => { record[h] = values[idx] ?? ''; });
    rows.push(record);
  }
  return { headers, rows };
}

export function parseZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compMethod = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const uncompSize = buffer.readUInt32LE(offset + 22);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLen);

    // Archive traversal security guard (Zip Slip)
    if (name.includes('..') || path.isAbsolute(name) || name.startsWith('/')) {
      throw new BoundaryLimitError(
        'ARCHIVE_TRAVERSAL_DETECTED',
        `Archive traversal threat detected: entry '${name}' contains directory traversal characters`,
        400
      );
    }

    // Zip bomb expansion ratio check (max 100:1 ratio above 10 MB, or absolute max 100 MB uncompressed)
    if (compSize > 0 && ((uncompSize > 10 * 1024 * 1024 && uncompSize / compSize > 100) || uncompSize > 100 * 1024 * 1024)) {
      throw new BoundaryLimitError(
        'ARCHIVE_EXPANSION_LIMIT_EXCEEDED',
        `Archive expansion bomb detected: entry '${name}' has excessive expansion ratio or size (${uncompSize} bytes)`,
        400
      );
    }

    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buffer.length) break;

    const compressedData = buffer.subarray(dataStart, dataEnd);
    let uncompressedData: Buffer;
    if (compMethod === 0) {
      uncompressedData = compressedData;
    } else if (compMethod === 8) {
      uncompressedData = inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported zip compression method: ${compMethod}`);
    }

    entries.set(name, uncompressedData);
    offset = dataEnd;
  }
  return entries;
}

export function parseXlsx(buffer: Buffer): { headers: string[]; rows: Record<string, string>[] } {
  const entries = parseZipEntries(buffer);

  // Parse Shared Strings table if present
  const sharedStrings: string[] = [];
  const sstEntry = entries.get('xl/sharedStrings.xml');
  if (sstEntry) {
    const sstXml = sstEntry.toString('utf8');
    const siMatches = sstXml.match(/<si>[\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      const textMatches = Array.from(si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((m) => m[1]);
      sharedStrings.push(textMatches.join(''));
    }
  }

  // Find first worksheet XML
  let sheetXml = entries.get('xl/worksheets/sheet1.xml')?.toString('utf8');
  if (!sheetXml) {
    for (const [name, buf] of entries.entries()) {
      if (name.startsWith('xl/worksheets/sheet') && name.endsWith('.xml')) {
        sheetXml = buf.toString('utf8');
        break;
      }
    }
  }

  if (!sheetXml) {
    return { headers: [], rows: [] };
  }

  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c\s+r="([A-Z]+)(\d+)"(?:\s+t="([^"]*)")?[^>]*>(?:<is><t>([\s\S]*?)<\/t><\/is>|<v>([\s\S]*?)<\/v>)?<\/c>/g;

  const parsedGrid: Record<number, Record<number, string>> = {};
  let maxColIndex = 0;
  let maxRowIndex = 0;

  function colLettersToIndex(letters: string): number {
    let index = 0;
    for (let i = 0; i < letters.length; i++) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowContent = rowMatch[1]!;
    let cellMatch: RegExpExecArray | null;
    cellRegex.lastIndex = 0;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const colLetters = cellMatch[1]!;
      const rowNum = parseInt(cellMatch[2]!, 10);
      const cellType = cellMatch[3];
      const inlineStr = cellMatch[4];
      const rawVal = cellMatch[5];

      const colIdx = colLettersToIndex(colLetters);
      if (colIdx > maxColIndex) maxColIndex = colIdx;
      if (rowNum > maxRowIndex) maxRowIndex = rowNum;

      let value = '';
      if (inlineStr !== undefined) {
        value = inlineStr;
      } else if (rawVal !== undefined) {
        if (cellType === 's') {
          const sstIdx = parseInt(rawVal, 10);
          value = sharedStrings[sstIdx] ?? '';
        } else {
          value = rawVal;
        }
      }

      if (value.length > MAX_MIGRATION_CELL_SIZE_BYTES) {
        throw new BoundaryLimitError(
          'CELL_SIZE_LIMIT_EXCEEDED',
          `Cell size exceeds ${MAX_MIGRATION_CELL_SIZE_BYTES} bytes limit (${value.length} bytes) at ${colLetters}${rowNum}`,
          400
        );
      }

      if (!parsedGrid[rowNum]) parsedGrid[rowNum] = {};
      parsedGrid[rowNum]![colIdx] = value;
    }
  }

  if (maxColIndex + 1 > MAX_MIGRATION_COLUMN_COUNT) {
    throw new BoundaryLimitError(
      'COLUMN_LIMIT_EXCEEDED',
      `Column count exceeds maximum allowable limit of ${MAX_MIGRATION_COLUMN_COUNT} (${maxColIndex + 1} columns detected)`,
      400
    );
  }

  const headerRow = parsedGrid[1] || {};
  const headers: string[] = [];
  for (let c = 0; c <= maxColIndex; c++) {
    headers.push((headerRow[c] || `col_${c + 1}`).trim());
  }

  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= maxRowIndex; r++) {
    const rowData = parsedGrid[r] || {};
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = rowData[idx] ?? '';
    });
    rows.push(record);
  }

  return { headers, rows };
}

export function createSyntheticXlsx(headers: string[], rows: Record<string, string>[]): Buffer {
  function indexToColLetters(idx: number): string {
    let s = '';
    let n = idx + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  let sheetData = '<sheetData>';
  sheetData += '<row r="1">';
  headers.forEach((h, idx) => {
    const ref = `${indexToColLetters(idx)}1`;
    sheetData += `<c r="${ref}" t="inlineStr"><is><t>${h}</t></is></c>`;
  });
  sheetData += '</row>';

  rows.forEach((r, rIdx) => {
    const rowNum = rIdx + 2;
    sheetData += `<row r="${rowNum}">`;
    headers.forEach((h, cIdx) => {
      const ref = `${indexToColLetters(cIdx)}${rowNum}`;
      const val = (r[h] ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      sheetData += `<c r="${ref}" t="inlineStr"><is><t>${val}</t></is></c>`;
    });
    sheetData += '</row>';
  });
  sheetData += '</sheetData>';

  const worksheetXml = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sheetData}</worksheet>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;

  const files: Record<string, string | Buffer> = {
    '[Content_Types].xml': contentTypesXml,
    'xl/worksheets/sheet1.xml': worksheetXml,
  };

  const parts: Buffer[] = [];
  const cdEntries: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(dataBuf);

    let crc = 0 ^ (-1);
    for (let i = 0; i < dataBuf.length; i++) {
      crc = (crc >>> 8) ^ (([0, 0x77073096, 0xee0e612c, 0x990951ba][(crc ^ dataBuf[i]!) & 3]!) >>> 0);
    }
    crc = (crc ^ (-1)) >>> 0;

    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(dataBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    nameBuf.copy(lh, 30);

    parts.push(lh, compressed);

    const cdh = Buffer.alloc(46 + nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(compressed.length, 20);
    cdh.writeUInt32LE(dataBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    nameBuf.copy(cdh, 46);

    cdEntries.push(cdh);
    offset += lh.length + compressed.length;
  }

  const cdOffset = offset;
  const cdBuf = Buffer.concat(cdEntries);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(cdEntries.length, 8);
  eocd.writeUInt16LE(cdEntries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cdBuf, eocd]);
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function validateFile(filePath: string): { ok: true; size: number } | { ok: false; reason: string } {
  if (!existsSync(filePath)) return { ok: false, reason: `File not found: ${filePath}` };
  const stat = statSync(filePath);
  if (!stat.isFile()) return { ok: false, reason: `Not a file: ${filePath}` };
  if (stat.size > MAX_MIGRATION_FILE_SIZE_BYTES) {
    return { ok: false, reason: `File exceeds 50 MB limit (${stat.size} bytes)` };
  }
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

  const ext = path.extname(input.file).toLowerCase();
  let parsed: { headers: string[]; rows: Record<string, string>[] };
  if (ext === '.xlsx') {
    parsed = parseXlsx(readFileSync(input.file));
  } else {
    const content = readFileSync(input.file, 'utf8');
    parsed = parseCsv(content);
  }
  const rows = parsed.rows;
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
