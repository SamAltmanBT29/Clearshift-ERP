/**
 * ERP2-28: Mapping / value-translation configuration for ERP-2
 * (Vendors, Purchase Orders, PO Lines).
 *
 * Pure, deterministic helpers. No I/O, no fuzzy matching, no auto-merge.
 * Sensitive values (bank details) are never echoed in errors or results meta.
 */
import { createHash } from 'node:crypto';

export type Erp2Entity = 'vendors' | 'purchase_orders' | 'po_lines';
export type FieldType = 'string' | 'integer' | 'decimal' | 'date' | 'boolean' | 'enum';
export type DateFormat = 'iso' | 'dmy';

export interface FieldMapping {
  /** Source file column header (exact, case-sensitive). */
  source: string;
  /** Target schema attribute. */
  target: string;
  type: FieldType;
  required: boolean;
  /** Key into MappingTemplate.enumTranslations (type === 'enum'). */
  enumTable?: string;
  /** Decimal places for type === 'decimal' (half-up rounding). Default 2. */
  decimalScale?: number;
  /** Date format for type === 'date'. Default 'iso'. */
  dateFormat?: DateFormat;
  /** Sensitive targets (e.g. bank details): values never appear in errors. */
  sensitive?: boolean;
}

export interface EnumTable {
  /** Allowlist of target values. */
  allowed: readonly string[];
  /** Source value (matched case-insensitively after trim) -> target value. */
  map: Readonly<Record<string, string>>;
}

export interface MappingTemplate {
  name: string;
  /** Semantic version, e.g. 1.0.0 */
  version: string;
  entity: Erp2Entity;
  fields: readonly FieldMapping[];
  enumTranslations: Readonly<Record<string, EnumTable>>;
}

export interface ErrorEnvelope {
  code: string;
  message: string;
  details: unknown;
}

export interface MappingIssue {
  code:
    | 'UNMAPPED_REQUIRED_TARGET'
    | 'DUPLICATE_TARGET'
    | 'DUPLICATE_SOURCE'
    | 'MISSING_SOURCE_COLUMN'
    | 'UNKNOWN_ENUM_TABLE'
    | 'ENUM_TARGET_NOT_ALLOWED'
    | 'INVALID_TEMPLATE_META'
    | 'INVALID_FIELD_CONFIG';
  target?: string;
  source?: string;
  message: string;
}

export class MappingValidationError extends Error {
  readonly httpStatus = 400;
  readonly code = 'MAPPING_VALIDATION_FAILED';
  readonly issues: readonly MappingIssue[];
  constructor(issues: readonly MappingIssue[]) {
    super(`Mapping template failed validation with ${issues.length} issue(s)`);
    this.name = 'MappingValidationError';
    this.issues = issues;
  }
  toEnvelope(): ErrorEnvelope {
    return { code: this.code, message: this.message, details: { issues: this.issues } };
  }
}

/**
 * Required target columns per entity (enforcement guard).
 * ASSUMPTION: names follow the ERP-2 schema attributes; verify against erp2_* tables.
 */
export const REQUIRED_TARGETS: Readonly<Record<Erp2Entity, readonly string[]>> = {
  vendors: ['vendor_code', 'name', 'status'],
  purchase_orders: ['po_number', 'vendor_code', 'status', 'order_date'],
  po_lines: ['po_number', 'line_no', 'product_sku', 'quantity', 'unit_price'],
};

/** Module enum allowlists. PO transitions: draft -> sent -> received -> closed. */
export const PO_STATUS_VALUES = ['draft', 'sent', 'received', 'closed'] as const;
export const VENDOR_STATUS_VALUES = ['active', 'inactive'] as const;

const SEMVER = /^\d+\.\d+\.\d+$/;

export function templateId(t: Pick<MappingTemplate, 'name' | 'version'>): string {
  return `${t.name}@${t.version}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Stable SHA-256 over canonical JSON: same template => same fingerprint on every run. */
export function templateFingerprint(t: MappingTemplate): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(t))).digest('hex');
}

/** Structural validation of a template (independent of any source file). */
export function validateTemplate(t: MappingTemplate): MappingIssue[] {
  const issues: MappingIssue[] = [];

  if (t.name.trim() === '' || !SEMVER.test(t.version)) {
    issues.push({
      code: 'INVALID_TEMPLATE_META',
      message: 'Template must have a non-empty name and a semantic version (x.y.z)',
    });
  }

  const targets = new Set<string>();
  const sources = new Set<string>();
  for (const f of t.fields) {
    if (targets.has(f.target)) {
      issues.push({ code: 'DUPLICATE_TARGET', target: f.target, message: `Target "${f.target}" is mapped more than once` });
    }
    targets.add(f.target);
    if (sources.has(f.source)) {
      issues.push({ code: 'DUPLICATE_SOURCE', source: f.source, message: `Source column "${f.source}" is mapped more than once` });
    }
    sources.add(f.source);

    if (f.type === 'enum') {
      const table = f.enumTable === undefined ? undefined : t.enumTranslations[f.enumTable];
      if (table === undefined) {
        issues.push({ code: 'UNKNOWN_ENUM_TABLE', target: f.target, message: `Enum table for "${f.target}" is not defined` });
      } else {
        for (const v of Object.values(table.map)) {
          if (!table.allowed.includes(v)) {
            issues.push({ code: 'ENUM_TARGET_NOT_ALLOWED', target: f.target, message: `Enum table "${f.enumTable}" maps to a value outside its allowlist` });
            break;
          }
        }
      }
    }
    if (f.type === 'decimal' && f.decimalScale !== undefined && (!Number.isInteger(f.decimalScale) || f.decimalScale < 0 || f.decimalScale > 8)) {
      issues.push({ code: 'INVALID_FIELD_CONFIG', target: f.target, message: 'decimalScale must be an integer between 0 and 8' });
    }
  }

  for (const req of REQUIRED_TARGETS[t.entity]) {
    const f = t.fields.find((x) => x.target === req);
    if (f === undefined || !f.required) {
      issues.push({
        code: 'UNMAPPED_REQUIRED_TARGET',
        target: req,
        message: `Required target "${req}" for ${t.entity} is not mapped as a required field`,
      });
    }
  }
  return issues;
}

/** Template validity plus presence of every mapped source column in the file header. */
export function validateAgainstHeaders(t: MappingTemplate, headers: readonly string[]): MappingIssue[] {
  const issues = validateTemplate(t);
  const present = new Set(headers);
  for (const f of t.fields) {
    if (f.required && !present.has(f.source)) {
      issues.push({
        code: 'MISSING_SOURCE_COLUMN',
        target: f.target,
        source: f.source,
        message: `Source column "${f.source}" for required target "${f.target}" is missing from the file`,
      });
    }
  }
  return issues;
}

/** Dry-run guard: throws MappingValidationError (HTTP 400) and blocks execution. */
export function assertDryRunReady(t: MappingTemplate, headers: readonly string[]): void {
  const issues = validateAgainstHeaders(t, headers);
  if (issues.length > 0) throw new MappingValidationError(issues);
}

// ---------- Type coercion ----------

export type CoerceResult = { ok: true; value: string | number | boolean } | { ok: false; reason: string };

/** Half-up decimal rounding on strings (no floating point). Returns normalized string. */
export function roundDecimalHalfUp(input: string, scale: number): string | null {
  const cleaned = input.trim().replace(/,/g, '');
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (m === null) return null;
  const sign = m[1] ?? '';
  const intPart = m[2] ?? '0';
  const frac = m[3] ?? '';
  const padded = (frac + '0'.repeat(scale)).slice(0, scale);
  let digits = BigInt(intPart + padded);
  const nextDigit = frac.charAt(scale);
  if (nextDigit !== '' && nextDigit >= '5') digits += 1n;
  const s = digits.toString().padStart(scale + 1, '0');
  const whole = scale === 0 ? s : s.slice(0, s.length - scale);
  const fracOut = scale === 0 ? '' : '.' + s.slice(s.length - scale);
  const isZero = /^0*$/.test(whole + fracOut.replace('.', ''));
  return `${isZero ? '' : sign}${whole}${fracOut}`;
}

function coerceDate(raw: string, fmt: DateFormat): string | null {
  const re = fmt === 'iso' ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const m = re.exec(raw);
  if (m === null) return null;
  const [y, mo, d] = fmt === 'iso' ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) return null;
  return `${y}-${mo}-${d}`;
}

export function translateEnum(table: EnumTable, raw: string): string | null {
  const key = raw.trim().toLowerCase();
  for (const [src, tgt] of Object.entries(table.map)) {
    if (src.trim().toLowerCase() === key) return tgt;
  }
  return null;
}

export function coerceValue(f: FieldMapping, raw: string, t: MappingTemplate): CoerceResult {
  const v = raw.trim();
  switch (f.type) {
    case 'string':
      return { ok: true, value: v };
    case 'integer':
      return /^-?\d+$/.test(v) ? { ok: true, value: Number(v) } : { ok: false, reason: 'not an integer' };
    case 'decimal': {
      const r = roundDecimalHalfUp(v, f.decimalScale ?? 2);
      return r === null ? { ok: false, reason: 'not a decimal' } : { ok: true, value: r };
    }
    case 'date': {
      const d = coerceDate(v, f.dateFormat ?? 'iso');
      return d === null ? { ok: false, reason: 'not a valid date' } : { ok: true, value: d };
    }
    case 'boolean': {
      const l = v.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(l)) return { ok: true, value: true };
      if (['false', 'no', 'n', '0'].includes(l)) return { ok: true, value: false };
      return { ok: false, reason: 'not a boolean' };
    }
    case 'enum': {
      const table = f.enumTable === undefined ? undefined : t.enumTranslations[f.enumTable];
      if (table === undefined) return { ok: false, reason: 'enum table missing' };
      const out = translateEnum(table, v);
      return out === null ? { ok: false, reason: 'value not in enum translation table' } : { ok: true, value: out };
    }
  }
}

export interface RowError {
  rowIndex: number;
  target: string;
  source: string;
  reason: string;
}

export interface MappedRow {
  rowIndex: number;
  values: Record<string, string | number | boolean | null>;
  errors: RowError[];
}

/** Map one source row to target attributes. Never includes raw values of sensitive fields in errors. */
export function mapRow(t: MappingTemplate, row: Readonly<Record<string, string>>, rowIndex: number): MappedRow {
  const values: Record<string, string | number | boolean | null> = {};
  const errors: RowError[] = [];
  for (const f of t.fields) {
    const raw = row[f.source];
    if (raw === undefined || raw.trim() === '') {
      values[f.target] = null;
      if (f.required) errors.push({ rowIndex, target: f.target, source: f.source, reason: 'required value is empty' });
      continue;
    }
    const res = coerceValue(f, raw, t);
    if (res.ok) {
      values[f.target] = res.value;
    } else {
      values[f.target] = null;
      errors.push({ rowIndex, target: f.target, source: f.source, reason: res.reason });
    }
  }
  return { rowIndex, values, errors };
}

export interface DryRunResult {
  templateId: string;
  fingerprint: string;
  rows: MappedRow[];
  validRows: number;
  invalidRows: number;
}

/** Dry-run: guard first (throws on unmapped required fields), then map every row. */
export function dryRun(
  t: MappingTemplate,
  headers: readonly string[],
  rows: readonly Readonly<Record<string, string>>[],
): DryRunResult {
  assertDryRunReady(t, headers);
  const mapped = rows.map((r, i) => mapRow(t, r, i + 1));
  const invalidRows = mapped.filter((m) => m.errors.length > 0).length;
  return {
    templateId: templateId(t),
    fingerprint: templateFingerprint(t),
    rows: mapped,
    validRows: mapped.length - invalidRows,
    invalidRows,
  };
}
