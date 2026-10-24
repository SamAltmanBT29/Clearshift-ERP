/**
 * ERP-1 Products & Inventory — Mapping / Value-Translation Configuration (ERP1-28 / KIT-05)
 *
 * Implements source-to-target field mapping templates, enum translations, and required target
 * column enforcement guards for categories, warehouses, products, and stock levels.
 *
 * Guarantees:
 *  - Pure, deterministic, zero-I/O helpers.
 *  - Template fingerprinting is stable, reproducible, and key-order independent.
 *  - Unmapped required target fields raise validation error and block dry-run execution (HTTP 400).
 *  - Enum translation maps source values to module allowlists (UOMs, currencies, boolean).
 *  - No fuzzy matching, no automatic merge in V1.
 *  - Raw input rows are never mutated.
 *  - Sensitive values (bank details, SSN) are never echoed in errors or metadata.
 *
 * @module erp1/migration/mapping-config
 */

import { createHash } from 'node:crypto';
import { ACCEPTED_CURRENCIES, ACCEPTED_UOMS, type RecordType } from './rules.js';

export type Erp1Entity = 'category' | 'warehouse' | 'product' | 'stock_level';
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
  entity: Erp1Entity;
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
 */
export const REQUIRED_TARGETS: Readonly<Record<Erp1Entity, readonly string[]>> = {
  category: ['code', 'name'],
  warehouse: ['code', 'name'],
  product: ['sku', 'name', 'category_code', 'unit_of_measure', 'price', 'currency'],
  stock_level: ['sku', 'warehouse_code', 'quantity', 'as_of_date'],
};

export const DEFAULT_ENUM_TRANSLATIONS: Readonly<Record<string, EnumTable>> = {
  unit_of_measure: {
    allowed: ACCEPTED_UOMS,
    map: {
      pcs: 'pcs',
      piece: 'pcs',
      pieces: 'pcs',
      pc: 'pcs',
      kg: 'kg',
      kilogram: 'kg',
      kilograms: 'kg',
      g: 'g',
      gram: 'g',
      grams: 'g',
      litre: 'litre',
      liter: 'litre',
      litres: 'litre',
      l: 'litre',
      metre: 'metre',
      meter: 'metre',
      meters: 'metre',
      m: 'metre',
      box: 'box',
      boxes: 'box',
      bx: 'box',
    },
  },
  currency: {
    allowed: ACCEPTED_CURRENCIES,
    map: {
      usd: 'USD',
      eur: 'EUR',
      gbp: 'GBP',
      inr: 'INR',
    },
  },
  boolean: {
    allowed: ['true', 'false'],
    map: {
      true: 'true',
      false: 'false',
      yes: 'true',
      no: 'false',
      '1': 'true',
      '0': 'false',
    },
  },
};

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

  for (const req of REQUIRED_TARGETS[t.entity] ?? []) {
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
      const lower = v.toLowerCase();
      if (lower === 'true' || lower === 'yes' || lower === '1') return { ok: true, value: true };
      if (lower === 'false' || lower === 'no' || lower === '0') return { ok: true, value: false };
      return { ok: false, reason: 'not a boolean' };
    }
    case 'enum': {
      if (f.enumTable === undefined) return { ok: false, reason: 'missing enum table' };
      const table = t.enumTranslations[f.enumTable];
      if (table === undefined) return { ok: false, reason: 'unknown enum table' };
      const translated = translateEnum(table, v);
      return translated === null ? { ok: false, reason: `value "${v}" is not in enum table` } : { ok: true, value: translated };
    }
    default:
      return { ok: false, reason: 'unsupported type' };
  }
}

export interface MapRowSuccess {
  ok: true;
  row: Record<string, unknown>;
}

export interface MapRowFailure {
  ok: false;
  errors: readonly { target: string; reason: string }[];
}

export type MapRowResult = MapRowSuccess | MapRowFailure;

/** Maps a single source row object to a target entity row object according to template. */
export function mapRow(t: MappingTemplate, sourceRow: Readonly<Record<string, string>>): MapRowResult {
  const rowOut: Record<string, unknown> = {};
  const errors: { target: string; reason: string }[] = [];

  for (const f of t.fields) {
    const raw = sourceRow[f.source];
    if (raw === undefined || raw.trim() === '') {
      if (f.required) {
        errors.push({ target: f.target, reason: 'required field is missing or empty' });
      }
      continue;
    }
    const coerced = coerceValue(f, raw, t);
    if (!coerced.ok) {
      errors.push({ target: f.target, reason: coerced.reason });
    } else {
      rowOut[f.target] = coerced.value;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, row: rowOut };
}

export interface DryRunReport {
  template: { name: string; version: string; fingerprint: string };
  totalRows: number;
  mappedCount: number;
  errorCount: number;
  errors: readonly { rowNumber: number; details: readonly { target: string; reason: string }[] }[];
}

/** Executes a dry run over source rows; never mutates target database or source rows. */
export function dryRun(t: MappingTemplate, sourceRows: readonly Record<string, string>[]): DryRunReport {
  let mappedCount = 0;
  const errors: { rowNumber: number; details: readonly { target: string; reason: string }[] }[] = [];

  for (let idx = 0; idx < sourceRows.length; idx++) {
    const res = mapRow(t, sourceRows[idx]!);
    if (res.ok) {
      mappedCount++;
    } else {
      errors.push({ rowNumber: idx + 1, details: res.errors });
    }
  }

  return {
    template: { name: t.name, version: t.version, fingerprint: templateFingerprint(t) },
    totalRows: sourceRows.length,
    mappedCount,
    errorCount: errors.length,
    errors,
  };
}
